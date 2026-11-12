/**
 * What an upload flag *does*: the auto-hide the media-scan worker applies
 * when a score clears the quarantine threshold, and the restore / purge the
 * `/admin` queue resolves it with. Shared between the worker and the app in
 * the `notify-core.ts` shape — relative imports, schema + drizzle only, the
 * caller's own drizzle handle, and the object store injected — so the DB
 * tests in the root suite run the same code the worker does.
 *
 * Quarantine is two moves. The key is detached from every row that
 * references it (pages stop rendering it within one render), and the object
 * is moved under `quarantine/`, a prefix the public `/images/` route refuses,
 * so the raw URL 404s at origin. Both are recorded on the scan row so a
 * dismiss can put everything back. Nothing here is deleted until a human
 * confirms.
 *
 * A hosted game's images are the exception: a blob or release file is
 * stored once per project by its hash and shared by every release and scene
 * that lists it, so it never moves. Quarantine stamps the object row and
 * hides every release of the project that lists the hash instead, and purges
 * from the edge each newly hidden release's shell and, in every release that
 * lists it, the image's own URLs; a dismiss clears both.
 * Every hide or unhide is also announced on `ENGINE_RELEASE_NOTICE_CHANNEL`,
 * so the web app's frame cache drops the release instead of serving it
 * from memory until its TTL runs out.
 */
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import {
  canvasAttachments,
  collabPostImages,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  forumPostImages,
  forumPosts,
  imageScans,
  type ImageScanStatus,
  profileProjects,
  projects,
  teamProjects,
  teams,
} from "../db/schema";
import { purgeReleaseFiles } from "./cloudflare-purge";
import { writeAudit } from "./engine/release-audit";
import {
  ENGINE_ASSETS_PREFIX,
  ENGINE_RELEASES_PREFIX,
  engineAssetKey,
  engineReleaseObjectKey,
} from "./engine/storage-keys";

// Same convention as notify-core: the caller's drizzle handle, whatever
// driver it was built on.
// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

export const QUARANTINE_PREFIX = "quarantine/";

export function quarantineKey(objectKey: string): string {
  return `${QUARANTINE_PREFIX}${objectKey}`;
}

/** The two bucket operations quarantine needs; each caller binds its own client. */
export interface ImageObjectStore {
  /** Copies `from` to `to` and removes `from`. A missing source is not an error. */
  move(from: string, to: string): Promise<void>;
  /** Removes an object. A missing object is not an error. */
  remove(key: string): Promise<void>;
}

/** Every row a key was attached to when it was detached. */
export type DetachedRefs = {
  teams: Array<{ id: string; field: "avatarKey" | "bannerKey"; url: string | null }>;
  collabPostImages: Array<{
    id: number;
    postId: number;
    url: string;
    alt: string | null;
    sortOrder: number | null;
  }>;
  forumPostImages: Array<{
    id: number;
    postId: number;
    url: string;
    alt: string | null;
    sortOrder: number;
  }>;
  forumPostCovers: Array<{ postId: number; url: string | null }>;
  projects: string[];
  profileProjects: string[];
  teamProjects: string[];
  /** Attachment ids stamped quarantined; the key stays, the object moves. */
  canvasAttachments: string[];
  /** Hosted game releases this image hid; a dismiss unhides only these. */
  engineReleases: string[];
};

const EMPTY_REFS: DetachedRefs = {
  teams: [],
  collabPostImages: [],
  forumPostImages: [],
  forumPostCovers: [],
  projects: [],
  profileProjects: [],
  teamProjects: [],
  canvasAttachments: [],
  engineReleases: [],
};

function mergeRefs(a: DetachedRefs, b: DetachedRefs): DetachedRefs {
  return {
    teams: [
      ...a.teams,
      ...b.teams.filter((r) => !a.teams.some((x) => x.id === r.id && x.field === r.field)),
    ],
    collabPostImages: [
      ...a.collabPostImages,
      ...b.collabPostImages.filter((r) => !a.collabPostImages.some((x) => x.id === r.id)),
    ],
    forumPostImages: [
      ...a.forumPostImages,
      ...b.forumPostImages.filter((r) => !a.forumPostImages.some((x) => x.id === r.id)),
    ],
    forumPostCovers: [
      ...a.forumPostCovers,
      ...b.forumPostCovers.filter((r) => !a.forumPostCovers.some((x) => x.postId === r.postId)),
    ],
    projects: [...new Set([...a.projects, ...b.projects])],
    profileProjects: [...new Set([...a.profileProjects, ...b.profileProjects])],
    teamProjects: [...new Set([...a.teamProjects, ...b.teamProjects])],
    canvasAttachments: [...new Set([...a.canvasAttachments, ...b.canvasAttachments])],
    engineReleases: [...new Set([...a.engineReleases, ...b.engineReleases])],
  };
}

function refsFrom(value: unknown): DetachedRefs {
  if (!value || typeof value !== "object") return EMPTY_REFS;
  const v = value as Partial<DetachedRefs>;
  return {
    teams: Array.isArray(v.teams) ? v.teams : [],
    collabPostImages: Array.isArray(v.collabPostImages) ? v.collabPostImages : [],
    forumPostImages: Array.isArray(v.forumPostImages) ? v.forumPostImages : [],
    forumPostCovers: Array.isArray(v.forumPostCovers) ? v.forumPostCovers : [],
    projects: Array.isArray(v.projects) ? v.projects : [],
    profileProjects: Array.isArray(v.profileProjects) ? v.profileProjects : [],
    teamProjects: Array.isArray(v.teamProjects) ? v.teamProjects : [],
    canvasAttachments: Array.isArray(v.canvasAttachments) ? v.canvasAttachments : [],
    engineReleases: Array.isArray(v.engineReleases) ? v.engineReleases : [],
  };
}

/**
 * Nulls every reference to the key and returns what was cleared. Searches by
 * key across every place rather than trusting the scan row's owner: a
 * user-scoped key can be shared by a profile placement and an imported
 * showcase row, and a legacy post image can live in an uploader's namespace.
 */
export async function detachImageKey(db: DbHandle, objectKey: string): Promise<DetachedRefs> {
  const refs: DetachedRefs = { ...EMPTY_REFS };

  // Read before write: RETURNING would hand back the nulled url.
  const avatarTeams: Array<{ id: string; url: string | null }> = await db
    .select({ id: teams.id, url: teams.avatarUrl })
    .from(teams)
    .where(eq(teams.avatarKey, objectKey));
  const bannerTeams: Array<{ id: string; url: string | null }> = await db
    .select({ id: teams.id, url: teams.bannerUrl })
    .from(teams)
    .where(eq(teams.bannerKey, objectKey));
  await db
    .update(teams)
    .set({ avatarKey: null, avatarUrl: null, updatedAt: new Date() })
    .where(eq(teams.avatarKey, objectKey));
  await db
    .update(teams)
    .set({ bannerKey: null, bannerUrl: null, updatedAt: new Date() })
    .where(eq(teams.bannerKey, objectKey));
  refs.teams = [
    ...avatarTeams.map((t) => ({ id: t.id, field: "avatarKey" as const, url: t.url })),
    ...bannerTeams.map((t) => ({ id: t.id, field: "bannerKey" as const, url: t.url })),
  ];

  refs.collabPostImages = await db
    .delete(collabPostImages)
    .where(eq(collabPostImages.imageKey, objectKey))
    .returning({
      id: collabPostImages.id,
      postId: collabPostImages.postId,
      url: collabPostImages.url,
      alt: collabPostImages.alt,
      sortOrder: collabPostImages.sortOrder,
    });

  refs.forumPostImages = await db
    .delete(forumPostImages)
    .where(eq(forumPostImages.imageKey, objectKey))
    .returning({
      id: forumPostImages.id,
      postId: forumPostImages.postId,
      url: forumPostImages.url,
      alt: forumPostImages.alt,
      sortOrder: forumPostImages.sortOrder,
    });

  const coveredPosts: Array<{ postId: number; url: string | null }> = await db
    .select({ postId: forumPosts.id, url: forumPosts.coverImageUrl })
    .from(forumPosts)
    .where(eq(forumPosts.coverImageKey, objectKey));
  await db
    .update(forumPosts)
    .set({ coverImageKey: null, coverImageUrl: null })
    .where(eq(forumPosts.coverImageKey, objectKey));
  refs.forumPostCovers = coveredPosts;

  const cleared = async (table: typeof projects | typeof profileProjects | typeof teamProjects) => {
    const rows: Array<{ id: string }> = await db
      .update(table)
      .set({ imageKey: null })
      .where(eq(table.imageKey, objectKey))
      .returning({ id: table.id });
    return rows.map((r) => r.id);
  };
  refs.projects = await cleared(projects);
  refs.profileProjects = await cleared(profileProjects);
  refs.teamProjects = await cleared(teamProjects);

  const attachments: Array<{ id: string }> = await db
    .update(canvasAttachments)
    .set({ quarantinedAt: new Date() })
    .where(and(eq(canvasAttachments.imageKey, objectKey), isNull(canvasAttachments.quarantinedAt)))
    .returning({ id: canvasAttachments.id });
  refs.canvasAttachments = attachments.map((a) => a.id);

  return refs;
}

/**
 * Puts a detached key back — only where the slot is still empty. An owner
 * who uploaded a replacement while the image sat in review keeps it; the
 * restored object simply goes back to being unreferenced.
 */
export async function reattachImageKey(
  db: DbHandle,
  objectKey: string,
  refs: DetachedRefs,
): Promise<void> {
  for (const team of refs.teams) {
    const set =
      team.field === "avatarKey"
        ? { avatarKey: objectKey, avatarUrl: team.url }
        : { bannerKey: objectKey, bannerUrl: team.url };
    const column = team.field === "avatarKey" ? teams.avatarKey : teams.bannerKey;
    await db
      .update(teams)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(teams.id, team.id), isNull(column)));
  }
  for (const image of refs.collabPostImages) {
    await db
      .insert(collabPostImages)
      .values({
        id: image.id,
        postId: image.postId,
        imageKey: objectKey,
        url: image.url,
        alt: image.alt,
        sortOrder: image.sortOrder,
      })
      // The post may have been deleted meanwhile; the FK failing is not a
      // restore failure worth surfacing, and a row already back is fine.
      .onConflictDoNothing()
      .catch(() => {});
  }
  for (const image of refs.forumPostImages) {
    await db
      .insert(forumPostImages)
      .values({ ...image, imageKey: objectKey })
      .onConflictDoNothing()
      .catch(() => {});
  }
  for (const cover of refs.forumPostCovers) {
    await db
      .update(forumPosts)
      .set({ coverImageKey: objectKey, coverImageUrl: cover.url })
      .where(and(eq(forumPosts.id, cover.postId), isNull(forumPosts.coverImageKey)));
  }
  const fill = async (
    table: typeof projects | typeof profileProjects | typeof teamProjects,
    ids: string[],
  ) => {
    for (const id of ids) {
      await db
        .update(table)
        .set({ imageKey: objectKey })
        .where(and(eq(table.id, id), isNull(table.imageKey)));
    }
  };
  await fill(projects, refs.projects);
  await fill(profileProjects, refs.profileProjects);
  await fill(teamProjects, refs.teamProjects);
  // By key, not the recorded ids: a canvas attachment is only ever quarantined
  // through its key, and a row copied while quarantined (a move into a team)
  // has an id the scan never recorded.
  await db
    .update(canvasAttachments)
    .set({ quarantinedAt: null })
    .where(
      and(eq(canvasAttachments.imageKey, objectKey), isNotNull(canvasAttachments.quarantinedAt)),
    );
}

/** The Redis channel a hosted release's hide or unhide is announced on, for every web process's frame cache. */
export const ENGINE_RELEASE_NOTICE_CHANNEL = "engine:release-changes";

/** Releases, or whole projects, whose hidden state changed and which a frame cache must read again. */
export type EngineReleaseNotice = { releaseIds: string[]; projectIds: string[] };

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/** The notice a channel message carries, or null for anything else. */
export function parseEngineReleaseNotice(message: string): EngineReleaseNotice | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { releaseIds = [], projectIds = [] } = value as Record<string, unknown>;
  if (!isStringArray(releaseIds) || !isStringArray(projectIds)) return null;
  return { releaseIds, projectIds };
}

export function formatEngineReleaseNotice(notice: EngineReleaseNotice): string {
  return JSON.stringify({ releaseIds: notice.releaseIds, projectIds: notice.projectIds });
}

/**
 * How a takedown reaches the edge and the site's frame caches. `purge`
 * takes a release's shell and the listed `files` (release paths) off the
 * edge, by default through Cloudflare, which logs when it isn't configured;
 * `announce` defaults to nothing, since each process binds its own Redis.
 */
export type TakedownDeps = {
  purge?: (releaseId: string, files?: readonly string[]) => Promise<unknown>;
  announce?: (notice: EngineReleaseNotice) => Promise<unknown>;
};

/** Best effort both: the release rows already carry the new state. */
async function announceChanged(deps: TakedownDeps, releaseIds: readonly string[]): Promise<void> {
  if (releaseIds.length === 0 || !deps.announce) return;
  try {
    await deps.announce({ releaseIds: [...releaseIds], projectIds: [] });
  } catch (error) {
    console.warn("[image-quarantine] release notice failed", { releaseIds, error });
  }
}

/**
 * The origin answers 410 for a hidden release once its cache hears; the
 * edge copies go here. An image is viewable on its own URL whether or not
 * its release boots, so every release in `files` loses the image's paths
 * there, not only the ones this takedown hid.
 */
async function purgeHidden(
  deps: TakedownDeps,
  hidden: readonly string[],
  files: ReadonlyMap<string, readonly string[]>,
): Promise<void> {
  await announceChanged(deps, hidden);
  const purge =
    deps.purge ??
    ((releaseId: string, paths?: readonly string[]) => purgeReleaseFiles(releaseId, paths ?? []));
  for (const releaseId of new Set([...hidden, ...files.keys()])) {
    try {
      await purge(releaseId, files.get(releaseId) ?? []);
    } catch (error) {
      console.warn("[image-quarantine] edge purge failed", { releaseId, error });
    }
  }
}

/** The paths each release in `releaseIds` lists the image under, for the edge purge. */
const filesOf = (
  listing: ReadonlyMap<string, readonly string[]>,
  releaseIds: Iterable<string>,
): Map<string, readonly string[]> =>
  new Map([...releaseIds].map((id) => [id, listing.get(id) ?? []] as const));

/** What publishers are told while a flagged image keeps their release hidden. */
export const ENGINE_QUARANTINE_REASON = "An image in this release is waiting for review.";

const SHA256 = /^[0-9a-f]{64}$/;
/** A scan in either state keeps the releases listing its image hidden: under review, or confirmed. */
const HELD: ImageScanStatus[] = ["quarantined", "purged"];

/** A hosted game's stored object: a project blob or a release file, by hash. */
export type EngineObjectRef = {
  projectId: string;
  sha256: string;
  source: "blob" | "release";
};

/** The project and hash an engine key names, or null for every other key. */
export function engineObjectOf(objectKey: string): EngineObjectRef | null {
  const [prefix, projectId, sha256, ...rest] = objectKey.split("/");
  if (rest.length > 0 || !projectId || !sha256 || !SHA256.test(sha256)) return null;
  if (prefix === ENGINE_ASSETS_PREFIX) return { projectId, sha256, source: "blob" };
  if (prefix === ENGINE_RELEASES_PREFIX) return { projectId, sha256, source: "release" };
  return null;
}

const keyOf = (projectId: string, sha256: string, source: string) =>
  source === "blob" ? engineAssetKey(projectId, sha256) : engineReleaseObjectKey(projectId, sha256);

/**
 * Hides every kept release of the project that lists the hash and isn't
 * hidden already, each audited as the site's own hide. Returns the ids the
 * image now holds hidden, those this call hid, and the paths every release
 * listing the hash names it under. A release staff hid for
 * another reason keeps that reason, and isn't the image's to unhide later.
 */
async function hideReleasesListing(
  db: DbHandle,
  ref: EngineObjectRef,
  objectKey: string,
): Promise<{ held: string[]; hidden: string[]; listing: Map<string, string[]> }> {
  const now = new Date();
  if (ref.source === "release") {
    await db
      .update(engineReleaseObjects)
      .set({ quarantinedAt: now })
      .where(
        and(
          eq(engineReleaseObjects.projectId, ref.projectId),
          eq(engineReleaseObjects.sha256, ref.sha256),
          isNull(engineReleaseObjects.quarantinedAt),
        ),
      );
  }
  const rows: Array<{ releaseId: string; path: string }> = await db
    .select({ releaseId: engineReleaseFiles.releaseId, path: engineReleaseFiles.path })
    .from(engineReleaseFiles)
    .where(
      and(
        eq(engineReleaseFiles.projectId, ref.projectId),
        eq(engineReleaseFiles.sha256, ref.sha256),
      ),
    );
  const paths = new Map<string, string[]>();
  for (const { releaseId, path } of rows)
    paths.set(releaseId, [...(paths.get(releaseId) ?? []), path]);
  const listing = [...paths.keys()].map((releaseId) => ({ releaseId }));
  if (listing.length === 0) return { held: [], hidden: [], listing: paths };
  const hidden: Array<{ id: string }> = await db
    .update(engineReleases)
    .set({ hiddenAt: now, hiddenById: null, hiddenReason: ENGINE_QUARANTINE_REASON })
    .where(
      and(
        inArray(
          engineReleases.id,
          listing.map((r) => r.releaseId),
        ),
        isNull(engineReleases.hiddenAt),
        isNull(engineReleases.collectedAt),
      ),
    )
    .returning({ id: engineReleases.id });
  for (const { id } of hidden) {
    await writeAudit(db, {
      projectId: ref.projectId,
      actor: { kind: "system" },
      action: "hide",
      releaseId: id,
      at: now,
      detail: { reason: ENGINE_QUARANTINE_REASON, objectKey },
    });
  }
  // Releases another image already holds are this one's too, so the last
  // dismiss of the two is the one that shows them.
  const held: Array<{ id: string }> = await db
    .select({ id: engineReleases.id })
    .from(engineReleases)
    .where(
      and(
        inArray(
          engineReleases.id,
          listing.map((r) => r.releaseId),
        ),
        eq(engineReleases.hiddenReason, ENGINE_QUARANTINE_REASON),
        isNull(engineReleases.hiddenById),
      ),
    );
  return {
    held: [...new Set([...hidden.map((r) => r.id), ...held.map((r) => r.id)])],
    hidden: hidden.map((r) => r.id),
    listing: paths,
  };
}

/**
 * Unhides the releases this image hid, unless staff have since hidden one
 * for another reason or it still lists another image under review.
 */
async function showReleasesHiddenBy(
  db: DbHandle,
  ref: EngineObjectRef,
  objectKey: string,
  releaseIds: readonly string[],
): Promise<string[]> {
  if (ref.source === "release") {
    await db
      .update(engineReleaseObjects)
      .set({ quarantinedAt: null })
      .where(
        and(
          eq(engineReleaseObjects.projectId, ref.projectId),
          eq(engineReleaseObjects.sha256, ref.sha256),
        ),
      );
  }
  if (releaseIds.length === 0) return [];

  const files: Array<{ releaseId: string; sha256: string; source: string }> = await db
    .select({
      releaseId: engineReleaseFiles.releaseId,
      sha256: engineReleaseFiles.sha256,
      source: engineReleaseFiles.source,
    })
    .from(engineReleaseFiles)
    .where(inArray(engineReleaseFiles.releaseId, [...releaseIds]));
  const keysOf = new Map<string, string[]>();
  for (const f of files) {
    const keys = keysOf.get(f.releaseId) ?? [];
    keys.push(keyOf(ref.projectId, f.sha256, f.source));
    keysOf.set(f.releaseId, keys);
  }
  const allKeys = [...new Set([...keysOf.values()].flat())];
  const underReview: Array<{ objectKey: string }> =
    allKeys.length === 0
      ? []
      : await db
          .select({ objectKey: imageScans.objectKey })
          .from(imageScans)
          .where(
            and(
              inArray(imageScans.objectKey, allKeys),
              inArray(imageScans.status, HELD),
              ne(imageScans.objectKey, objectKey),
            ),
          );
  const stillHeld = new Set(underReview.map((r) => r.objectKey));
  const free = releaseIds.filter((id) => !(keysOf.get(id) ?? []).some((key) => stillHeld.has(key)));
  if (free.length === 0) return [];

  const now = new Date();
  const shown: Array<{ id: string }> = await db
    .update(engineReleases)
    .set({ hiddenAt: null, hiddenById: null, hiddenReason: null })
    .where(
      and(
        inArray(engineReleases.id, free),
        eq(engineReleases.hiddenReason, ENGINE_QUARANTINE_REASON),
        isNull(engineReleases.hiddenById),
      ),
    )
    .returning({ id: engineReleases.id });
  for (const { id } of shown) {
    await writeAudit(db, {
      projectId: ref.projectId,
      actor: { kind: "system" },
      action: "unhide",
      releaseId: id,
      at: now,
      detail: { objectKey },
    });
  }
  return shown.map((r) => r.id);
}

/**
 * Which of `hashes` a project holds back: a release file stamped
 * quarantined, or a blob whose scan is quarantined or confirmed. A release
 * that lists one should be hidden from the start.
 */
export async function engineHashesUnderReview(
  db: DbHandle,
  projectId: string,
  hashes: readonly string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const objects: Array<{ sha256: string }> = await db
    .select({ sha256: engineReleaseObjects.sha256 })
    .from(engineReleaseObjects)
    .where(
      and(
        eq(engineReleaseObjects.projectId, projectId),
        inArray(engineReleaseObjects.sha256, [...hashes]),
        isNotNull(engineReleaseObjects.quarantinedAt),
      ),
    );
  const blobs: Array<{ objectKey: string }> = await db
    .select({ objectKey: imageScans.objectKey })
    .from(imageScans)
    .where(
      and(
        inArray(
          imageScans.objectKey,
          hashes.map((h) => engineAssetKey(projectId, h)),
        ),
        inArray(imageScans.status, HELD),
      ),
    );
  const held = new Set(objects.map((o) => o.sha256));
  for (const b of blobs) {
    const sha256 = engineObjectOf(b.objectKey)?.sha256;
    if (sha256) held.add(sha256);
  }
  return held;
}

/**
 * A release committed while it lists hashes under review starts hidden
 * with `ENGINE_QUARANTINE_REASON`; this records it on each holding scan, so
 * the last dismiss shows it like the releases the quarantine hid, and
 * audits the hide as the site's own. The caller writes the release row
 * hidden, in the same transaction.
 */
export async function holdNewRelease(
  db: DbHandle,
  input: { projectId: string; releaseId: string; hashes: ReadonlySet<string>; at: Date },
): Promise<void> {
  const { projectId, releaseId, at } = input;
  const keys = [...input.hashes].flatMap((h) => [
    engineAssetKey(projectId, h),
    engineReleaseObjectKey(projectId, h),
  ]);
  const scans: Array<{ objectKey: string; detached: unknown }> =
    keys.length === 0
      ? []
      : await db
          .select({ objectKey: imageScans.objectKey, detached: imageScans.detached })
          .from(imageScans)
          .where(and(inArray(imageScans.objectKey, keys), inArray(imageScans.status, HELD)));
  for (const scan of scans) {
    await db
      .update(imageScans)
      .set({
        detached: mergeRefs(refsFrom(scan.detached), {
          ...EMPTY_REFS,
          engineReleases: [releaseId],
        }),
      })
      .where(eq(imageScans.objectKey, scan.objectKey));
  }
  await writeAudit(db, {
    projectId,
    actor: { kind: "system" },
    action: "hide",
    releaseId,
    at,
    detail: {
      reason: ENGINE_QUARANTINE_REASON,
      objectKeys: scans.map((s) => s.objectKey).sort(),
    },
  });
}

type ScanRow = { status: string; detached: unknown };

async function readScan(db: DbHandle, objectKey: string): Promise<ScanRow | null> {
  const [row] = await db
    .select({ status: imageScans.status, detached: imageScans.detached })
    .from(imageScans)
    .where(eq(imageScans.objectKey, objectKey))
    .limit(1);
  return row ?? null;
}

/**
 * The auto-hide. Idempotent: a retried job finds the key already detached
 * (nothing more to clear) and the object already moved (a no-op move), and
 * merges rather than overwrites what it recorded. Returns the references
 * cleared, or null when the row is missing or the image was already ruled
 * on — a cleared or purged image is never re-quarantined by a detector.
 */
export async function quarantineImage(
  db: DbHandle,
  store: ImageObjectStore,
  objectKey: string,
  takedown: TakedownDeps = {},
): Promise<DetachedRefs | null> {
  const scan = await readScan(db, objectKey);
  if (!scan || scan.status === "cleared" || scan.status === "purged") return null;

  const engine = engineObjectOf(objectKey);
  if (engine) {
    const before = new Set(refsFrom(scan.detached).engineReleases);
    const { held, hidden, listing } = await hideReleasesListing(db, engine, objectKey);
    const refs = mergeRefs(refsFrom(scan.detached), { ...EMPTY_REFS, engineReleases: held });
    await db
      .update(imageScans)
      .set({ status: "quarantined", detached: refs })
      .where(eq(imageScans.objectKey, objectKey));
    // A retried job finds the releases it held already purged.
    const fresh = [...listing.keys()].filter((id) => !before.has(id));
    await purgeHidden(takedown, hidden, filesOf(listing, fresh));
    return refs;
  }

  const refs = mergeRefs(refsFrom(scan.detached), await detachImageKey(db, objectKey));
  // Recorded before the move: if the move fails and the job retries, the
  // references are already safe and the retry only has the move left.
  await db
    .update(imageScans)
    .set({ status: "quarantined", detached: refs })
    .where(eq(imageScans.objectKey, objectKey));
  await store.move(objectKey, quarantineKey(objectKey));
  return refs;
}

/** A dismiss: object back, references back, and the row remembers the ruling. */
export async function restoreImage(
  db: DbHandle,
  store: ImageObjectStore,
  objectKey: string,
  takedown: TakedownDeps = {},
): Promise<boolean> {
  const scan = await readScan(db, objectKey);
  if (!scan) return false;
  const engine = engineObjectOf(objectKey);
  let shown: string[] = [];
  if (engine) {
    if (scan.status === "quarantined") {
      shown = await showReleasesHiddenBy(
        db,
        engine,
        objectKey,
        refsFrom(scan.detached).engineReleases,
      );
    }
  } else if (scan.status === "quarantined") {
    await store.move(quarantineKey(objectKey), objectKey);
    await reattachImageKey(db, objectKey, refsFrom(scan.detached));
  }
  await db
    .update(imageScans)
    .set({ status: "cleared", detached: null })
    .where(eq(imageScans.objectKey, objectKey));
  await announceChanged(takedown, shown);
  return true;
}

/**
 * A confirm on a hosted game's image: the detection stands, the object
 * stays (other releases and the project's scenes may list the same hash,
 * and the collector removes objects nothing lists), and every release
 * listing it stays hidden, for good. The scan reads `purged`, the confirmed
 * state the release checks hold back. False for any other key, or a
 * missing scan.
 */
export async function confirmKeepHidden(
  db: DbHandle,
  objectKey: string,
  takedown: TakedownDeps = {},
): Promise<boolean> {
  const engine = engineObjectOf(objectKey);
  if (!engine) return false;
  const scan = await readScan(db, objectKey);
  if (!scan) return false;
  const hid =
    scan.status === "quarantined" || scan.status === "purged"
      ? null
      : await hideReleasesListing(db, engine, objectKey);
  const refs = hid
    ? mergeRefs(refsFrom(scan.detached), { ...EMPTY_REFS, engineReleases: hid.held })
    : refsFrom(scan.detached);
  await db
    .update(imageScans)
    .set({ status: "purged", detached: refs })
    .where(eq(imageScans.objectKey, objectKey));
  if (hid) await purgeHidden(takedown, hid.hidden, filesOf(hid.listing, hid.listing.keys()));
  return true;
}

/** A confirm: the object is gone from both locations; the row stays as the record. A hosted game's image is kept hidden instead. */
export async function purgeImage(
  db: DbHandle,
  store: ImageObjectStore,
  objectKey: string,
  takedown: TakedownDeps = {},
): Promise<boolean> {
  if (engineObjectOf(objectKey)) return confirmKeepHidden(db, objectKey, takedown);
  const scan = await readScan(db, objectKey);
  if (!scan) return false;
  if (scan.status !== "quarantined") {
    // A confirm on an image that was only flagged (below the quarantine
    // threshold) still takes it down — that is what confirming means.
    const refs = mergeRefs(refsFrom(scan.detached), await detachImageKey(db, objectKey));
    await db.update(imageScans).set({ detached: refs }).where(eq(imageScans.objectKey, objectKey));
  }
  await store.remove(objectKey);
  await store.remove(quarantineKey(objectKey));
  await db.update(imageScans).set({ status: "purged" }).where(eq(imageScans.objectKey, objectKey));
  return true;
}

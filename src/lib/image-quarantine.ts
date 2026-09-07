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
 */
import { and, eq, isNull } from "drizzle-orm";

import {
  collabPostImages,
  imageScans,
  profileProjects,
  projects,
  teamProjects,
  teams,
} from "../db/schema";

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
  projects: string[];
  profileProjects: string[];
  teamProjects: string[];
};

const EMPTY_REFS: DetachedRefs = {
  teams: [],
  collabPostImages: [],
  projects: [],
  profileProjects: [],
  teamProjects: [],
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
    projects: [...new Set([...a.projects, ...b.projects])],
    profileProjects: [...new Set([...a.profileProjects, ...b.profileProjects])],
    teamProjects: [...new Set([...a.teamProjects, ...b.teamProjects])],
  };
}

function refsFrom(value: unknown): DetachedRefs {
  if (!value || typeof value !== "object") return EMPTY_REFS;
  const v = value as Partial<DetachedRefs>;
  return {
    teams: Array.isArray(v.teams) ? v.teams : [],
    collabPostImages: Array.isArray(v.collabPostImages) ? v.collabPostImages : [],
    projects: Array.isArray(v.projects) ? v.projects : [],
    profileProjects: Array.isArray(v.profileProjects) ? v.profileProjects : [],
    teamProjects: Array.isArray(v.teamProjects) ? v.teamProjects : [],
  };
}

/**
 * Nulls every reference to the key and returns what was cleared. Searches by
 * key across all six places rather than trusting the scan row's owner: a
 * user-scoped key can be shared by a profile placement and an imported
 * showcase row, and a legacy post image can live in an uploader's namespace.
 */
export async function detachImageKey(db: DbHandle, objectKey: string): Promise<DetachedRefs> {
  const refs: DetachedRefs = { ...EMPTY_REFS, teams: [], collabPostImages: [] };

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
): Promise<DetachedRefs | null> {
  const scan = await readScan(db, objectKey);
  if (!scan || scan.status === "cleared" || scan.status === "purged") return null;

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
): Promise<boolean> {
  const scan = await readScan(db, objectKey);
  if (!scan) return false;
  if (scan.status === "quarantined") {
    await store.move(quarantineKey(objectKey), objectKey);
    await reattachImageKey(db, objectKey, refsFrom(scan.detached));
  }
  await db
    .update(imageScans)
    .set({ status: "cleared", detached: null })
    .where(eq(imageScans.objectKey, objectKey));
  return true;
}

/** A confirm: the object is gone from both locations; the row stays as the record. */
export async function purgeImage(
  db: DbHandle,
  store: ImageObjectStore,
  objectKey: string,
): Promise<boolean> {
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

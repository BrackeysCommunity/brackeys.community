import { measureBudget } from "@jams/engine/export";
import {
  checkReleaseManifest,
  formatReleaseManifest,
  parseReleaseManifest,
  releaseId as releaseIdOf,
  sha256 as sha256Of,
  RELEASE_FILE,
  type ReleaseFile,
  type ReleaseManifest,
  type Sha256,
} from "@jams/engine/project";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

import { db as siteDb } from "@/db";
import {
  engineBlobs,
  engineProjects,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  engineReleaseUploads,
  teamMembers,
} from "@/db/schema";
import { siteUrl } from "@/env";
import { formatBytes } from "@/lib/format-bytes";
import { SITE } from "@/lib/legal-meta";
import { requestUploadScan } from "@/lib/media-scan";
import { bestEffort } from "@/lib/posthog-server";
import { checkRateLimit } from "@/lib/rate-limit";

import {
  MIN_HOSTED_ENGINE,
  RELEASE_BEGINS_PER_HOUR,
  RELEASE_FILE_PUTS_PER_HOUR,
  RELEASE_MANIFEST_MAX_BYTES,
  UPLOAD_SESSION_HOURS,
} from "./limits";
import { isEngineStaff } from "./projects";
import { checkReleaseQuota, type SiteQuotaRefusal } from "./quota";
import { canDo, roleOf, type GameRole, type Viewer } from "./release-access";
import { writeAudit, type Actor, type ReleaseDb } from "./release-audit";
import { movePointer } from "./release-channels";
import {
  issueError,
  releaseEngineOld,
  releaseFilesMissing,
  releaseFileType,
  releaseForbidden,
  releaseNotCanonical,
  releaseProjectMismatch,
  releaseRateLimited,
  releaseRemoved,
  releaseUnchangeable,
  releaseUploadExpired,
  ReleaseError,
  type ReleaseApiError,
} from "./release-errors";
import { checkLeadingBytes, contentTypeFor, type ReleaseObjectStore } from "./release-storage";
import { engineReleaseObjectKey } from "./storage-keys";
import { releaseUsageReport, storedUsage, type StoredUsage, type UsageReport } from "./usage";

/** Who uploads or moves a release: a person, an agent token acting for its creator, or staff. */
export type { Actor };

/** The database, with transactions: the app's node-postgres or the tests' pglite. */
export type ReleaseTxDb = Pick<
  PgAsyncDatabase<any, any>,
  "select" | "insert" | "update" | "delete" | "transaction"
>;

/** What the upload protocol runs over; every field but `store` defaults to the site's own. */
export type ReleaseDeps = {
  store: ReleaseObjectStore;
  db?: ReleaseTxDb;
  now?: () => Date;
  /** A fixed-window limiter: true while `key` has made fewer than `limit` calls in the window. */
  rateLimit?: (
    bucket: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<boolean>;
  /** Sends a stored image to the media scan; default the site's queue. */
  scan?: (input: { objectKey: string; projectId: string; uploaderId: string }) => Promise<void>;
  /** The caller as the access rules see them; default read from the project, its team and the caller's roles. */
  viewer?: (userId: string, project: ProjectRow) => Promise<Viewer>;
};

/** A file the site doesn't hold yet, which the uploader sends with `putReleaseFile`. */
export type MissingFile = { path: string; sha256: Sha256; bytes: number };

export type BeginResult = {
  uploadId: string;
  releaseId: Sha256;
  /** The existing version when this release is already stored. */
  version: number | null;
  missing: MissingFile[];
  /** Usage before and after this release, per quota. */
  usage: UsageReport;
};

export type CommitResult = {
  releaseId: Sha256;
  version: number;
  created: boolean;
  playUrl: string;
};

/** The hosted project row the checks read. */
export type ProjectRow = {
  projectId: string;
  game: string | null;
  teamId: string | null;
  createdById: string | null;
};

const HOUR_MS = 3_600_000;
const FILE_ROWS_PER_INSERT = 500;

const resolved = (deps: ReleaseDeps) => ({
  db: deps.db ?? (siteDb as unknown as ReleaseTxDb),
  now: deps.now ?? (() => new Date()),
  rateLimit: deps.rateLimit ?? checkRateLimit,
  scan:
    deps.scan ??
    (async ({ objectKey, uploaderId }) => {
      await bestEffort("media_scan.request", { object_key: objectKey }, () =>
        requestUploadScan(objectKey, uploaderId),
      );
    }),
});

function refuse(body: ReleaseApiError, status?: number): never {
  throw new ReleaseError(body, status);
}

function notFound(message: string): never {
  return refuse({ code: "not-found", message }, 404);
}

function quotaRefusal(verdict: SiteQuotaRefusal): never {
  return refuse({
    code: "quota-exceeded",
    message: verdict.message,
    hint: verdict.hint,
    limit: verdict.limit,
    used: verdict.used,
    max: verdict.max,
  });
}

export const playUrlOf = (projectId: string, version: number): string =>
  siteUrl(`/games/${encodeURIComponent(projectId)}/play/${version}`);

/** Whether `version` is `min` or newer; a prerelease sorts before its release. */
export function engineAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/.exec(v);
    return match
      ? {
          parts: [Number(match[1]), Number(match[2]), Number(match[3])],
          pre: match[4] !== undefined,
        }
      : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const x = a.parts[i] ?? 0;
    const y = b.parts[i] ?? 0;
    if (x !== y) return x > y;
  }
  return !a.pre || b.pre;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

const attribute = (attrs: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(
    ` ${attrs}`,
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
};

const hrefPath = (href: string): string | null => {
  try {
    return href
      .replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => HTML_ENTITIES[e] ?? e)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
  } catch {
    return null;
  }
};

/**
 * `index.html` as the site serves it: no inline script, and one script, a
 * module, loading the build's entry. The frame's CSP refuses inline
 * scripts anyway; this refuses the build before it is published.
 */
export function indexHtmlLoadsEntry(html: string, entry: string): boolean {
  const opened = html.match(/<script\b/gi)?.length ?? 0;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (opened !== 1 || scripts.length !== 1) return false;
  const [, attrs = "", body = ""] = scripts[0] ?? [];
  if (body.trim() !== "") return false;
  if (attribute(attrs, "type")?.toLowerCase() !== "module") return false;
  const src = attribute(attrs, "src");
  return src !== null && hrefPath(src) === entry;
}

const ROLES: readonly ReleaseFile["role"][] = [
  "shell",
  "worker",
  "code",
  "style",
  "wasm",
  "icon",
  "data",
  "asset",
];

/** The type a path is served with under whichever role takes it; each path fits one role at most. */
const contentTypeOfPath = (path: string): string | null => {
  for (const role of ROLES) {
    const type = contentTypeFor(path, role);
    if (type !== null) return type;
  }
  return null;
};

/** `data/<sha256>.json` and `assets/<sha256><ext>` are named by their content. */
const nameHashOf = (file: ReleaseFile): string | null => {
  if (file.role !== "data" && file.role !== "asset") return null;
  const name = file.path.slice(file.path.indexOf("/") + 1);
  return name.slice(0, 64);
};

async function liveProject(db: ReleaseDb, projectId: string): Promise<ProjectRow> {
  const [row] = await db
    .select({
      projectId: engineProjects.projectId,
      game: engineProjects.game,
      teamId: engineProjects.teamId,
      createdById: engineProjects.createdById,
    })
    .from(engineProjects)
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)));
  return row ?? notFound(`There is no hosted project "${projectId}".`);
}

/** The caller as the access rules see them: staff by their roles, publisher or editor by the project and its team. */
export async function releaseViewer(
  db: ReleaseDb,
  userId: string,
  project: ProjectRow,
): Promise<Viewer> {
  const [staff, membership] = await Promise.all([
    isEngineStaff(userId),
    project.teamId === null
      ? Promise.resolve([])
      : db
          .select({ role: teamMembers.role })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, userId)))
          .limit(1),
  ]);
  const role = membership[0]?.role;
  return {
    userId,
    staff,
    teamRole: role === "owner" ? "owner" : role === undefined ? null : "member",
    isCreator: project.createdById === userId,
  };
}

async function assertMayUpload(
  deps: ReleaseDeps,
  db: ReleaseDb,
  actor: Actor,
  project: ProjectRow,
): Promise<void> {
  let role: GameRole | "agent";
  if (actor.kind === "agent") role = "agent";
  else if (actor.kind === "staff") role = "staff";
  else {
    const viewer = await (deps.viewer ?? ((id, p) => releaseViewer(db, id, p)))(
      actor.userId,
      project,
    );
    role = roleOf(viewer, project);
  }
  if (!canDo(role, "upload")) refuse(releaseForbidden("role"));
}

const actorColumns = (actor: Actor) => ({
  actorKind: actor.kind,
  actorId: actor.userId,
  agentTokenId: actor.kind === "agent" ? (actor.agentTokenId ?? null) : null,
});

/** Every `build.files` entry plus `release.json`, and the largest file. */
function releaseSize(manifest: ReleaseManifest, manifestBytes: number) {
  let total = manifestBytes;
  let largest = { path: RELEASE_FILE, bytes: 0 };
  for (const file of manifest.build.files) {
    total += file.bytes;
    if (file.bytes > largest.bytes) largest = { path: file.path, bytes: file.bytes };
  }
  return { totalBytes: total, largestFile: largest };
}

/** The hashes the project already holds, as release objects and as blobs. */
async function heldHashes(db: ReleaseDb, projectId: string, hashes: readonly string[]) {
  const unique = [...new Set(hashes)];
  const objects = new Set<string>();
  const blobs = new Set<string>();
  for (let i = 0; i < unique.length; i += FILE_ROWS_PER_INSERT) {
    const chunk = unique.slice(i, i + FILE_ROWS_PER_INSERT);
    const [o, b] = await Promise.all([
      db
        .select({ sha256: engineReleaseObjects.sha256 })
        .from(engineReleaseObjects)
        .where(
          and(
            eq(engineReleaseObjects.projectId, projectId),
            inArray(engineReleaseObjects.sha256, chunk),
          ),
        ),
      db
        .select({ sha256: engineBlobs.sha256 })
        .from(engineBlobs)
        .where(and(eq(engineBlobs.projectId, projectId), inArray(engineBlobs.sha256, chunk))),
    ]);
    for (const row of o) objects.add(row.sha256);
    for (const row of b) blobs.add(row.sha256);
  }
  return { objects, blobs };
}

/** Each file the project holds neither as a release object nor as a blob, once per hash. */
function missingFiles(
  files: readonly ReleaseFile[],
  held: { objects: ReadonlySet<string>; blobs: ReadonlySet<string> },
): MissingFile[] {
  const seen = new Set<string>();
  const out: MissingFile[] = [];
  for (const { path, sha256, bytes } of files) {
    if (held.objects.has(sha256) || held.blobs.has(sha256) || seen.has(sha256)) continue;
    seen.add(sha256);
    out.push({ path, sha256, bytes });
  }
  return out;
}

const parsedManifest = (text: string): ReleaseManifest => {
  const parsed = parseReleaseManifest(text);
  if (!parsed.ok) {
    const [issue] = parsed.issues;
    return refuse(
      issue
        ? issueError(issue)
        : { code: "schema", message: "This release.json isn't a release manifest." },
    );
  }
  return parsed.manifest;
};

async function existingRelease(db: ReleaseDb, projectId: string, id: string) {
  const [row] = await db
    .select({ version: engineReleases.version, collectedAt: engineReleases.collectedAt })
    .from(engineReleases)
    .where(and(eq(engineReleases.id, id), eq(engineReleases.projectId, projectId)));
  return row ?? null;
}

/**
 * Validates the manifest and every quota before any byte is sent, and opens
 * an upload. In order: the caller may upload, the hourly begin limit and
 * the day's releases; the manifest's size, parse, canonical text and id;
 * the engine version, target, project and game; the manifest's own checks
 * without files; the site's file rules; the release size and storage
 * quotas; then what the project already holds. The caller has checked the
 * production guard and `engine-games-enabled`.
 */
export async function beginRelease(
  deps: ReleaseDeps,
  input: { projectId: string; manifest: string; actor: Actor; channel?: "preview" | "none" },
): Promise<BeginResult> {
  const { db, now, rateLimit } = resolved(deps);
  const { projectId, actor } = input;
  const at = now();

  const project = await liveProject(db, projectId);
  await assertMayUpload(deps, db, actor, project);
  if (!(await rateLimit("engine-release-begin", actor.userId, RELEASE_BEGINS_PER_HOUR, 3600)))
    refuse(releaseRateLimited("begins"));
  const stored: StoredUsage = await storedUsage(db, projectId, at);
  const today = checkReleaseQuota(stored, {
    totalBytes: 0,
    files: 0,
    largestFile: { path: "release.json", bytes: 0 },
    addsBytes: 0,
    today: stored.releasesToday,
  });
  if (!today.ok) quotaRefusal(today);

  const manifestBytes = new TextEncoder().encode(input.manifest).byteLength;
  if (manifestBytes > RELEASE_MANIFEST_MAX_BYTES)
    refuse(
      {
        code: "asset-too-large",
        message: `This release.json is ${formatBytes(manifestBytes)}; ${SITE.name} reads one of at most ${formatBytes(RELEASE_MANIFEST_MAX_BYTES)}.`,
        hint: "Upload the build's own release.json unchanged.",
      },
      413,
    );
  const manifest = parsedManifest(input.manifest);
  if (formatReleaseManifest(manifest) !== input.manifest) refuse(releaseNotCanonical());
  const releaseId = await releaseIdOf(manifest);

  if (!engineAtLeast(manifest.engine.version, MIN_HOSTED_ENGINE))
    refuse(releaseEngineOld(manifest.engine.version));
  const target = manifest.build.target;
  if (target !== "web" && target !== "itch")
    refuse({
      code: "export-target-unsupported",
      message: `This is a ${target} build; ${SITE.name} plays web and itch builds.`,
      hint: "Build for the web target: vp run scene game release create <project> --target web",
    });
  if (manifest.project.id !== projectId)
    refuse(releaseProjectMismatch("project", projectId, manifest.project.id));
  if (project.game !== null && manifest.game.id !== project.game)
    refuse(releaseProjectMismatch("game", projectId, manifest.game.id));

  const issues = await checkReleaseManifest(manifest, undefined, { measureBudget });
  const error = issues.find((i) => i.severity === "error");
  if (error) refuse(issueError(error));

  const seenPaths = new Set<string>();
  for (const file of manifest.build.files) {
    const folded = file.path.toLowerCase();
    const named = nameHashOf(file);
    if (
      contentTypeFor(file.path, file.role) === null ||
      seenPaths.has(folded) ||
      (named !== null && named !== file.sha256)
    )
      refuse(releaseFileType(file.path));
    seenPaths.add(folded);
  }

  const held = await heldHashes(
    db,
    projectId,
    manifest.build.files.map((f) => f.sha256),
  );
  const missing = missingFiles(manifest.build.files, held);
  const addsBytes = missing.reduce((n, f) => n + f.bytes, 0);
  const size = releaseSize(manifest, manifestBytes);
  const quota = checkReleaseQuota(stored, {
    ...size,
    files: manifest.build.files.length,
    addsBytes,
    today: stored.releasesToday,
    project: projectId,
  });
  if (!quota.ok) quotaRefusal(quota);

  const existing = await existingRelease(db, projectId, releaseId);
  if (existing?.collectedAt) refuse(releaseRemoved(existing.version, existing.collectedAt));

  const [upload] = await db
    .insert(engineReleaseUploads)
    .values({
      projectId,
      manifest: input.manifest,
      releaseId,
      missing: existing ? [] : missing,
      channel: input.channel ?? "preview",
      ...actorColumns(actor),
      createdAt: at,
      expiresAt: new Date(at.getTime() + UPLOAD_SESSION_HOURS * HOUR_MS),
    })
    .returning({ id: engineReleaseUploads.id });
  if (!upload) throw new Error("the upload row wasn't written");

  return {
    uploadId: upload.id,
    releaseId,
    version: existing?.version ?? null,
    missing: existing ? [] : missing,
    usage: existing
      ? releaseUsageReport(stored, { version: existing.version, totalBytes: 0, addsBytes: 0 })
      : releaseUsageReport(stored, {
          version: stored.releases + 1,
          totalBytes: size.totalBytes,
          addsBytes,
        }),
  };
}

async function openUpload(
  deps: ReleaseDeps,
  db: ReleaseDb,
  uploadId: string,
  actor: Actor,
): Promise<typeof engineReleaseUploads.$inferSelect & { project: ProjectRow }> {
  const [upload] = await db
    .select()
    .from(engineReleaseUploads)
    .where(eq(engineReleaseUploads.id, uploadId));
  if (!upload) return notFound("There is no upload with this id.");
  const project = await liveProject(db, upload.projectId);
  await assertMayUpload(deps, db, actor, project);
  return { ...upload, project };
}

/**
 * Stores one of the upload's missing files: its hash is one the upload
 * waits for, its length the manifest's, its SHA-256 the one named, its
 * first bytes what its extension says; then it is stored at
 * `engine-releases/<project>/<sha256>` and images go to the media scan.
 */
export async function putReleaseFile(
  deps: ReleaseDeps,
  input: { uploadId: string; sha256: Sha256; body: Uint8Array; actor: Actor },
): Promise<void> {
  const { db, now, rateLimit, scan } = resolved(deps);
  const upload = await openUpload(deps, db, input.uploadId, input.actor);
  if (upload.committedAt) refuse(releaseUnchangeable());
  if (upload.expiresAt.getTime() <= now().getTime()) refuse(releaseUploadExpired());

  const file = upload.missing.find((f) => f.sha256 === input.sha256);
  if (!file)
    refuse({
      code: "hash-mismatch",
      message: `${input.sha256} isn't a file this upload is waiting for.`,
      hint: "Send only the files begin listed as missing, each under its own SHA-256.",
    });
  const { path, bytes } = file;
  if (input.body.byteLength !== bytes)
    refuse({
      code: "hash-mismatch",
      message: `${path} is ${input.body.byteLength} bytes; the manifest lists ${bytes}.`,
      hint: "Upload the build's own files unchanged.",
    });
  const actual = await sha256Of(input.body);
  if (actual !== input.sha256)
    refuse({
      code: "hash-mismatch",
      message: `${path}'s SHA-256 is ${actual}, not ${input.sha256}.`,
      hint: "Upload the build's own files unchanged.",
    });
  const contentType = contentTypeOfPath(path);
  if (contentType === null || !checkLeadingBytes(path, input.body)) refuse(releaseFileType(path));
  if (path === "index.html") {
    const { build } = parsedManifest(upload.manifest);
    if (!indexHtmlLoadsEntry(new TextDecoder().decode(input.body), build.entry))
      refuse({
        ...releaseFileType(path),
        hint: "index.html may hold one script: a module loading the build's entry, with no inline script.",
      });
  }
  if (
    !(await rateLimit("engine-release-file", input.actor.userId, RELEASE_FILE_PUTS_PER_HOUR, 3600))
  )
    refuse(releaseRateLimited("files"));

  const storageKey = engineReleaseObjectKey(upload.projectId, input.sha256);
  await deps.store.put(storageKey, input.body, contentType);
  await db
    .insert(engineReleaseObjects)
    .values({
      projectId: upload.projectId,
      sha256: input.sha256,
      bytes,
      contentType,
      storageKey,
    })
    .onConflictDoNothing();
  if (contentType.startsWith("image/"))
    await scan({
      objectKey: storageKey,
      projectId: upload.projectId,
      uploaderId: input.actor.userId,
    });
}

/**
 * Records the release once every file has arrived. Under a lock on the
 * project row: the next version, the release and its file rows, the
 * preview pointer (unless the upload said `none`), the audit rows, and the
 * upload marked committed. The same release committed again answers its
 * existing version with `created: false`.
 */
export async function commitRelease(
  deps: ReleaseDeps,
  input: { uploadId: string; actor: Actor },
): Promise<CommitResult> {
  const { db, now } = resolved(deps);
  const { actor } = input;
  const upload = await openUpload(deps, db, input.uploadId, actor);
  const projectId = upload.projectId;
  const id = upload.releaseId;
  const answer = (version: number, created: boolean): CommitResult => ({
    releaseId: id,
    version,
    created,
    playUrl: playUrlOf(projectId, version),
  });

  if (upload.committedAt) {
    const existing = await existingRelease(db, projectId, id);
    if (existing) return answer(existing.version, false);
  }
  const at = now();
  if (upload.expiresAt.getTime() <= at.getTime()) refuse(releaseUploadExpired());

  const manifest = parsedManifest(upload.manifest);
  const held = await heldHashes(
    db,
    projectId,
    manifest.build.files.map((f) => f.sha256),
  );
  const absent = upload.missing.filter((f) => !held.objects.has(f.sha256)).length;
  if (absent > 0) refuse(releaseFilesMissing(absent));

  const files = new Map<string, Sha256>();
  for (const f of manifest.build.files)
    if (held.objects.has(f.sha256) || held.blobs.has(f.sha256)) files.set(f.path, f.sha256);
  const issues = await checkReleaseManifest(manifest, files, { measureBudget });
  const error = issues.find((i) => i.severity === "error");
  if (error) refuse(issueError(error));

  const manifestBytes = new TextEncoder().encode(upload.manifest).byteLength;
  const size = releaseSize(manifest, manifestBytes);

  return db.transaction(async (tx) => {
    await tx
      .select({ projectId: engineProjects.projectId })
      .from(engineProjects)
      .where(eq(engineProjects.projectId, projectId))
      .for("update");

    const existing = await existingRelease(tx, projectId, id);
    if (existing) {
      await tx
        .update(engineReleaseUploads)
        .set({ committedAt: at })
        .where(eq(engineReleaseUploads.id, upload.id));
      return answer(existing.version, false);
    }

    const stored = await storedUsage(tx, projectId, at);
    const quota = checkReleaseQuota(stored, {
      ...size,
      files: manifest.build.files.length,
      addsBytes: 0,
      today: stored.releasesToday,
      project: projectId,
    });
    if (!quota.ok) quotaRefusal(quota);

    const [top] = await tx
      .select({ version: max(engineReleases.version) })
      .from(engineReleases)
      .where(eq(engineReleases.projectId, projectId));
    const version = (top?.version ?? 0) + 1;

    await tx.insert(engineReleases).values({
      id,
      projectId,
      version,
      manifest: upload.manifest,
      manifestBytes,
      totalBytes: size.totalBytes,
      fileCount: manifest.build.files.length,
      engineVersion: manifest.engine.version,
      gameId: manifest.game.id,
      snapshot: manifest.project.snapshot,
      buildHash: manifest.build.hash,
      target: manifest.build.target,
      createdById: actor.userId,
      agentTokenId: actor.kind === "agent" ? (actor.agentTokenId ?? null) : null,
      createdAt: at,
    });
    const rows = manifest.build.files.map((f) => ({
      releaseId: id,
      projectId,
      path: f.path,
      sha256: f.sha256,
      bytes: f.bytes,
      role: f.role,
      source: held.blobs.has(f.sha256) ? "blob" : "release",
    }));
    for (let i = 0; i < rows.length; i += FILE_ROWS_PER_INSERT)
      await tx.insert(engineReleaseFiles).values(rows.slice(i, i + FILE_ROWS_PER_INSERT));

    await writeAudit(tx, {
      projectId,
      actor,
      action: "create",
      releaseId: id,
      detail: { version },
      at,
    });
    if (upload.channel === "preview")
      await movePointer(tx, {
        project: projectId,
        channel: "preview",
        release: id,
        actor,
        action: "promote",
      });
    await tx
      .update(engineReleaseUploads)
      .set({ committedAt: at })
      .where(eq(engineReleaseUploads.id, upload.id));
    return answer(version, true);
  });
}

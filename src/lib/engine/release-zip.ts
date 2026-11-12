import { checkItchLayout, zipFiles } from "@jams/engine/export";
import { parseReleaseManifest, RELEASE_FILE } from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";
import { and, eq, isNull } from "drizzle-orm";

import { db as siteDb } from "@/db";
import { engineProjects, engineReleases } from "@/db/schema";

import { loadRelease } from "./frame-route";
import { canDo, roleOf, type GameRole, type Viewer } from "./release-access";
import type { ReleaseDb } from "./release-audit";
import {
  apiErrorResponse,
  releaseForbidden,
  releaseHidden,
  releaseRemoved,
  ReleaseError,
} from "./release-errors";
import { minioReleaseStore, type ReleaseObjectStore } from "./release-storage";
import { releaseViewer, type Actor, type ProjectRow } from "./release-upload";
import { ITCH_ISSUES_HEADER, itchIssuesHeader } from "./release-zip-header";

export type ReleaseZipDeps = {
  /** Default the site's bucket. */
  store?: ReleaseObjectStore;
  db?: ReleaseDb;
  now?: () => Date;
  /** The caller as the access rules see them; default read from the project, its team and the caller's roles. */
  viewer?: (userId: string, project: ProjectRow) => Promise<Viewer>;
};

export type ReleaseZip = {
  /** The download's file name: `<project>-v<version>.zip`. */
  name: string;
  bytes: Uint8Array;
  /** itch.io's layout over the zip's files; the page shows them before the publisher uploads it. */
  issues: SceneIssue[];
};

export { ITCH_ISSUES_HEADER, itchIssuesHeader, readItchIssuesHeader } from "./release-zip-header";

/** Files read from storage at once. */
const READ_CONCURRENCY = 16;

/** The zip's files: a release lists at most a few thousand, so they're read in small batches. */
async function readFiles(
  store: ReleaseObjectStore,
  entries: readonly { path: string; storageKey: string; bytes: number }[],
): Promise<{ path: string; bytes: Uint8Array }[]> {
  const out: { path: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < entries.length; i += READ_CONCURRENCY) {
    const batch = entries.slice(i, i + READ_CONCURRENCY);
    out.push(
      ...(await Promise.all(
        batch.map(async (entry) => {
          const stream = await store.stream(entry.storageKey);
          if (!stream) throw new Error(`release file "${entry.path}" is missing from storage`);
          const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
          if (bytes.byteLength !== entry.bytes)
            throw new Error(
              `release file "${entry.path}" is ${bytes.byteLength} bytes in storage, not ${entry.bytes}`,
            );
          return { path: entry.path, bytes };
        }),
      )),
    );
  }
  return out;
}

async function roleOfActor(
  deps: ReleaseZipDeps,
  db: ReleaseDb,
  actor: Actor,
  project: ProjectRow,
): Promise<GameRole | "agent"> {
  if (actor.kind === "agent") return "agent";
  if (actor.kind === "staff") return "staff";
  const viewer = await (deps.viewer ?? ((id, p) => releaseViewer(db, id, p)))(
    actor.userId,
    project,
  );
  return roleOf(viewer, project);
}

/**
 * A kept release as the itch.io zip: its files from storage plus
 * `release.json`, through `zipFiles` (stored, sorted, fixed times), so it's
 * byte for byte what `game export --zip` writes for the same build. For the
 * project's publishers, editors and staff; a collected release is a 410, a
 * hidden one is staff's only.
 */
export async function releaseZip(
  input: { releaseId: string; actor: Actor },
  deps: ReleaseZipDeps = {},
): Promise<ReleaseZip> {
  const db = deps.db ?? (siteDb as unknown as ReleaseDb);
  const notFound = () =>
    new ReleaseError({ code: "not-found", message: "There is no release with this id." }, 404);

  const [row] = await db
    .select({
      projectId: engineReleases.projectId,
      version: engineReleases.version,
      manifest: engineReleases.manifest,
      collectedAt: engineReleases.collectedAt,
      game: engineProjects.game,
      teamId: engineProjects.teamId,
      createdById: engineProjects.createdById,
    })
    .from(engineReleases)
    .innerJoin(engineProjects, eq(engineProjects.projectId, engineReleases.projectId))
    .where(and(eq(engineReleases.id, input.releaseId), isNull(engineProjects.deletedAt)))
    .limit(1);
  if (!row) throw notFound();

  const project: ProjectRow = {
    projectId: row.projectId,
    game: row.game,
    teamId: row.teamId,
    createdById: row.createdById,
  };
  const role = await roleOfActor(deps, db, input.actor, project);
  if (!canDo(role, "download-zip")) throw new ReleaseError(releaseForbidden("role"));

  if (row.collectedAt !== null || row.manifest === null)
    throw new ReleaseError(releaseRemoved(row.version, row.collectedAt ?? new Date(0)), 410);

  const release = await loadRelease(input.releaseId, {
    db,
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!release) throw notFound();
  if (release.hidden && role !== "staff")
    throw new ReleaseError(releaseHidden(row.version, release.hiddenReason));

  const parsed = parseReleaseManifest(row.manifest);
  if (!parsed.ok) throw new Error(`release ${input.releaseId} holds a manifest that doesn't parse`);
  const entries = parsed.manifest.build.files.map((file) => {
    const stored = release.files.get(file.path);
    if (!stored || stored.sha256 !== file.sha256)
      throw new Error(`release ${input.releaseId} has no stored file for "${file.path}"`);
    return { path: file.path, storageKey: stored.storageKey, bytes: file.bytes };
  });

  const files = [
    ...(await readFiles(deps.store ?? minioReleaseStore, entries)),
    { path: RELEASE_FILE, bytes: new TextEncoder().encode(row.manifest) },
  ];
  return {
    name: `${row.projectId}-v${row.version}.zip`,
    bytes: zipFiles(files),
    issues: checkItchLayout(files.map((f) => ({ path: f.path, bytes: f.bytes.byteLength }))),
  };
}

/**
 * The zip download's HTTP answer for a caller the route has already gated:
 * the archive as an attachment, `ITCH_ISSUES_HEADER` when itch.io's layout
 * has issues, and refusals as the release API's JSON error.
 */
export async function releaseZipResponse(
  request: Request,
  releaseId: string,
  deps: ReleaseZipDeps & { actor: Actor },
): Promise<Response> {
  let zip: ReleaseZip;
  try {
    zip = await releaseZip({ releaseId, actor: deps.actor }, deps);
  } catch (error) {
    if (error instanceof ReleaseError) return apiErrorResponse(error);
    throw error;
  }
  const headers = new Headers({
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${zip.name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"`,
    "content-length": String(zip.bytes.byteLength),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  if (zip.issues.length > 0) headers.set(ITCH_ISSUES_HEADER, itchIssuesHeader(zip.issues));
  return new Response(request.method === "HEAD" ? null : new Uint8Array(zip.bytes), { headers });
}

// The collector's plan, pure, so the root suite tests it and canvas-sync
// copies it. It imports `limits.ts` and the engine's project entry by
// relative path, both of which the image copies too.

import { byCodeUnit } from "../../../packages/engine/project/index.ts";
import {
  BLOB_GRACE_DAYS,
  LIVE_LIMITS,
  LIVE_REPORT_RETENTION_DAYS,
  PROJECT_QUOTA,
  RELEASE_GRACE_DAYS,
  SITE_SAVE_EXPIRY_DAYS,
} from "./limits.ts";

export type ReleaseRow = { id: string; version: number; createdAt: Date; collectedAt: Date | null };
/** One published version of a scene; `scene` is the scene's asset id. */
export type SceneVersionRow = {
  id: string;
  scene: string;
  number: number;
  createdAt: Date;
  collectedAt: Date | null;
};
/** The release ids a channel pointer or a jam version names. */
export type Pins = { channels: readonly string[]; jams: readonly string[] };

const DAY_MS = 86_400_000;

/** The collector's daily run, in UTC. */
export const COLLECTOR_RUN_UTC = { hour: 3, minute: 30 } as const;

/** The first collector run at or after `at`. */
export function nextCollectorRun(at: Date): Date {
  const run = new Date(
    Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      COLLECTOR_RUN_UTC.hour,
      COLLECTOR_RUN_UTC.minute,
    ),
  );
  return run.getTime() >= at.getTime() ? run : new Date(run.getTime() + DAY_MS);
}

type Collectable = { id: string; createdAt: Date; collectedAt: Date | null };

/**
 * The rows not yet collected beyond the `kept` newest by `rank` (higher is
 * newer) and not pinned, oldest first, each with when its grace ends.
 * Pinned rows count among the newest.
 */
function beyondKept<R extends Collectable>(
  rows: readonly R[],
  kept: number,
  pinned: ReadonlySet<string>,
  rank: (row: R) => number,
): { row: R; dueAt: Date }[] {
  return rows
    .filter((r) => r.collectedAt === null)
    .sort((a, b) => rank(b) - rank(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(kept)
    .filter((r) => !pinned.has(r.id))
    .reverse()
    .map((row) => ({
      row,
      dueAt: new Date(row.createdAt.getTime() + RELEASE_GRACE_DAYS * DAY_MS),
    }));
}

const releasesBeyondKept = (releases: readonly ReleaseRow[], pins: Pins) =>
  beyondKept(
    releases,
    PROJECT_QUOTA.releasesKept,
    new Set([...pins.channels, ...pins.jams]),
    (r) => r.version,
  );

/** The first collector run at or after a grace's end, or the next run once it has passed. */
const runAfter = (dueAt: Date, now: Date) =>
  nextCollectorRun(dueAt.getTime() > now.getTime() ? dueAt : now);

/** The releases to collect now: not among the newest kept, not pinned, past the grace. */
export function releasesToCollect(
  releases: readonly ReleaseRow[],
  pins: Pins,
  now: Date,
): string[] {
  return releasesBeyondKept(releases, pins)
    .filter(({ dueAt }) => dueAt.getTime() <= now.getTime())
    .map(({ row }) => row.id);
}

/**
 * When each unpinned release outside the kept set will go, for the release
 * list and the Usage section: the first run after its grace ends, oldest first.
 * One inside the kept set has no date, since only newer releases push it out.
 */
export function collectionForecast(
  releases: readonly ReleaseRow[],
  pins: Pins,
  now: Date,
): { version: number; at: Date }[] {
  return releasesBeyondKept(releases, pins).map(({ row, dueAt }) => ({
    version: row.version,
    at: runAfter(dueAt, now),
  }));
}

/** Each scene's versions beyond its newest kept and not pointed at, scenes in id order. */
function versionsBeyondKept(rows: readonly SceneVersionRow[], pointed: readonly string[]) {
  const byScene = new Map<string, SceneVersionRow[]>();
  for (const row of rows) {
    const list = byScene.get(row.scene);
    if (list) list.push(row);
    else byScene.set(row.scene, [row]);
  }
  const pinned = new Set(pointed);
  return [...byScene.keys()]
    .sort(byCodeUnit)
    .flatMap((scene) =>
      beyondKept(byScene.get(scene)!, LIVE_LIMITS.keptPerScene, pinned, (r) => r.number),
    );
}

/** The scene versions to collect now: not among the newest of their scene, not pointed at by any channel, past the grace. */
export function sceneVersionsToCollect(
  rows: readonly SceneVersionRow[],
  pointed: readonly string[],
  now: Date,
): string[] {
  return versionsBeyondKept(rows, pointed)
    .filter(({ dueAt }) => dueAt.getTime() <= now.getTime())
    .map(({ row }) => row.id);
}

/**
 * When each scene version outside its scene's kept set and not pointed at
 * will go: the first run after its grace ends. One inside the kept set has
 * no date, since only newer versions of its scene push it out.
 */
export function sceneVersionForecast(
  rows: readonly SceneVersionRow[],
  pointed: readonly string[],
  now: Date,
): { scene: string; number: number; at: Date }[] {
  return versionsBeyondKept(rows, pointed).map(({ row, dueAt }) => ({
    scene: row.scene,
    number: row.number,
    at: runAfter(dueAt, now),
  }));
}

/** The unreferenced blobs quiet for the whole grace, by when they were last referenced, else stored. */
export function blobsDue(
  unreferenced: readonly string[],
  rows: readonly { sha256: string; createdAt: Date; lastReferencedAt: Date | null }[],
  now: Date,
): string[] {
  const candidates = new Set(unreferenced);
  const cutoff = now.getTime() - BLOB_GRACE_DAYS * DAY_MS;
  return rows
    .filter(
      (r) => candidates.has(r.sha256) && (r.lastReferencedAt ?? r.createdAt).getTime() <= cutoff,
    )
    .map((r) => r.sha256);
}

/** A save last used before this is expired. */
export function savesDue(now: Date): Date {
  return new Date(now.getTime() - SITE_SAVE_EXPIRY_DAYS * DAY_MS);
}

/** Signed-in reports older than 30 days. */
export function reportsDue(now: Date): Date {
  return new Date(now.getTime() - LIVE_REPORT_RETENTION_DAYS * DAY_MS);
}

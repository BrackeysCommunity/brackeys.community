import type { SwapTiming } from "@jams/engine/game";
import type { AssetId, Sha256 } from "@jams/engine/project";
import type { LiveSceneEntry, LiveSnapshot } from "@jams/engine/standalone";
import { and, eq, isNull, sql } from "drizzle-orm";

import { engineSceneVersionFiles, engineSceneVersions } from "../../db/schema.ts";
import type { ReleaseDb } from "./release-audit";

export {
  liveSceneEntrySchema,
  liveSnapshotSchema,
  type LiveSceneEntry,
  type LiveSnapshot,
} from "@jams/engine/standalone";

/** The channel's release as the live state reads it. */
export type LiveRelease = {
  id: Sha256;
  /** '' when the release can't take live scenes. */
  liveCompatKey: string;
  /** The scenes the release lists. */
  scenes: readonly AssetId[];
};

/** One `engine_scene_channels` row joined to its version. */
export type LivePointerRow = {
  scene: AssetId;
  versionId: Sha256;
  number: number;
  timing: SwapTiming;
  since: Date;
  compatKey: string;
  collectedAt: Date | null;
  hiddenAt: Date | null;
  blockedAt: Date | null;
};

/**
 * The one rule for which pointers apply: those whose version fits the
 * channel's release, names a scene it lists, and isn't collected, hidden
 * or blocked. Hidden versions a pointer still names go in `removed`.
 */
export function effectiveLive(
  release: LiveRelease,
  pointers: readonly LivePointerRow[],
  rev: number,
  channel: "preview" | "production",
): LiveSnapshot {
  const listed = new Set(release.scenes);
  const scenes: LiveSceneEntry[] = [];
  const removed = new Set<Sha256>();
  for (const p of pointers) {
    if (p.hiddenAt) removed.add(p.versionId);
    if (!pointerApplies(release, listed, p)) continue;
    scenes.push({
      scene: p.scene,
      version: p.versionId,
      number: p.number,
      timing: p.timing,
      since: p.since.toISOString(),
    });
  }
  scenes.sort((a, b) => (a.scene < b.scene ? -1 : a.scene > b.scene ? 1 : 0));
  return { channel, rev, release: release.id, scenes, removed: [...removed].sort() };
}

function pointerApplies(
  release: LiveRelease,
  listed: ReadonlySet<AssetId>,
  p: LivePointerRow,
): boolean {
  return (
    release.liveCompatKey !== "" &&
    p.compatKey === release.liveCompatKey &&
    listed.has(p.scene) &&
    !p.collectedAt &&
    !p.hiddenAt &&
    !p.blockedAt
  );
}

/**
 * Whether the overlay prefix serves a stored file: `ok` when a kept,
 * unhidden version with this compat key lists it, `hidden` when only hidden
 * versions do, `none` otherwise. A blocked version's files stay served:
 * blocking stops new loads through the pointer, not frames already running it.
 */
export async function liveFileVisible(
  db: Pick<ReleaseDb, "select">,
  input: { projectId: string; sha256: Sha256; ext: string; compatKey: string },
): Promise<"ok" | "hidden" | "none"> {
  if (input.compatKey === "") return "none";
  const [row] = await db
    .select({ hidden: sql<boolean>`${engineSceneVersions.hiddenAt} is not null` })
    .from(engineSceneVersionFiles)
    .innerJoin(engineSceneVersions, eq(engineSceneVersions.id, engineSceneVersionFiles.versionId))
    .where(
      and(
        eq(engineSceneVersionFiles.projectId, input.projectId),
        eq(engineSceneVersionFiles.sha256, input.sha256),
        eq(engineSceneVersionFiles.ext, input.ext),
        eq(engineSceneVersions.projectId, input.projectId),
        eq(engineSceneVersions.compatKey, input.compatKey),
        isNull(engineSceneVersions.collectedAt),
      ),
    )
    .orderBy(sql`${engineSceneVersions.hiddenAt} is not null`)
    .limit(1);
  if (!row) return "none";
  return row.hidden ? "hidden" : "ok";
}

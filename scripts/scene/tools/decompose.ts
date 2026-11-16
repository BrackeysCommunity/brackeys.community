import { pxPerMetreOf } from "@jams/engine/game";
import { decomposeBatch, type OpBatch, type SceneDefinition } from "@jams/engine/scene";

import { isFileArg, isToolResult, issueLine, openScene, usage, type Tool } from "../context";
import type { WriterFlags } from "./assets-apply";
import { liveSceneText, writeSceneBatch } from "./write-batch";

export const DECOMPOSE_USAGE = "decompose <scene> <id> [--group] [--live]";

export type DecomposeInput = WriterFlags & {
  scene?: string;
  /** The entity whose concave `poly` shape splits. */
  id?: string;
  /** Put the pieces under one group instead of side by side. */
  group?: boolean;
};

const addedIds = (batch: OpBatch) =>
  batch.ops.flatMap((op) =>
    op.op === "add" && typeof op.entity.id === "string" ? [op.entity.id] : [],
  );

/**
 * Replaces a concave `poly` with convex pieces: `decomposeBatch` built against
 * the scene as it is now (the dev server's doc with `--live`), written as one
 * batch the way `scene apply` writes it.
 */
export const decompose: Tool<DecomposeInput> = async (input, ctx) => {
  if (!input.scene || !input.id) return usage(DECOMPOSE_USAGE);
  if (input.live && (isFileArg(input.scene) || input.scene === "-"))
    return usage("scene decompose --live takes a scene name; file paths are read-only");

  const loaded = await openScene(ctx, input.scene, DECOMPOSE_USAGE);
  if (!loaded.ok) return loaded.result;
  let def = loaded.def;
  if (input.live) {
    const live = await liveSceneText(ctx, { ...input, scene: input.scene });
    if (isToolResult(live)) return live;
    def = JSON.parse(live.text) as SceneDefinition;
  }

  const built = decomposeBatch(def, input.id, loaded.registry, { group: input.group });
  if (!built.ok)
    return {
      exitCode: 1,
      data: { scene: input.scene, id: input.id, written: false, issue: built.issue },
      text: `${input.scene}: ${input.id} can't split\n${issueLine(built.issue)}`,
    };

  // A collider's split keeps its first piece on the entity itself.
  const kept = built.batch.ops.some((op) => op.op === "update" && op.ref === input.id);
  const pieces = [...(kept ? [input.id] : []), ...addedIds(built.batch)];
  const ppm = pxPerMetreOf(loaded.registry);
  const toM2 = (area2: number) => area2 / 2 / (ppm * ppm);
  const area = toM2(built.area2);
  const covered2 = built.pieceArea2.reduce((sum, a) => sum + Math.abs(a), 0);
  const piecesArea = toM2(covered2);
  const summary = { id: input.id, pieces, area, piecesArea, batch: built.batch };
  if (covered2 !== built.area2)
    return {
      exitCode: 1,
      data: { scene: input.scene, written: false, ...summary },
      text: `${input.scene}: ${input.id}'s pieces don't cover it (area ${area} → pieces ${piecesArea}); nothing written`,
    };

  const result = await writeSceneBatch({ ...input, scene: input.scene }, ctx, built.batch);
  return {
    ...result,
    data: { ...(result.data as Record<string, unknown>), ...summary },
    text: [
      result.text,
      `pieces: ${pieces.join(", ")}`,
      `area ${area} → pieces ${piecesArea} (preserved)`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

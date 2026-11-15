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

  const pieces = addedIds(built.batch);
  const ppm = pxPerMetreOf(loaded.registry);
  const toM2 = (area2: number) => area2 / 2 / (ppm * ppm);
  const area = toM2(built.area2);
  const piecesArea = toM2(built.pieceArea2.reduce((sum, a) => sum + Math.abs(a), 0));
  const result = await writeSceneBatch({ ...input, scene: input.scene }, ctx, built.batch);

  const areaLine = `area ${area} → pieces ${piecesArea} (${area === piecesArea ? "preserved" : "MISMATCH"})`;
  return {
    ...result,
    data: {
      ...(result.data as Record<string, unknown>),
      id: input.id,
      pieces,
      area,
      piecesArea,
      batch: built.batch,
    },
    text: [result.text, `pieces: ${pieces.join(", ")}`, areaLine].filter(Boolean).join("\n"),
  };
};

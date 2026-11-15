import { pxPerMetreOf } from "@jams/engine/game";
import {
  decomposeBatch,
  decomposePolygon,
  parseShape,
  type OpBatch,
  type Pt,
  type SceneDefinition,
} from "@jams/engine/scene";

import {
  failure,
  hostedOptions,
  isFileArg,
  issueLine,
  openScene,
  usage,
  type Tool,
  type ToolResult,
} from "../context";
import { ProjectClientError, readLiveScene } from "../project-client";
import { apply } from "./apply";
import { applyLive } from "./apply-live";
import type { WriterFlags } from "./assets-apply";

export const DECOMPOSE_USAGE = "decompose <scene> <id> [--group] [--live]";

export type DecomposeInput = WriterFlags & {
  scene?: string;
  /** The entity whose concave `poly` shape splits. */
  id?: string;
  /** Put the pieces under one group instead of side by side. */
  group?: boolean;
};

/** The entity's first `poly` field's points. */
function polyOf(def: SceneDefinition, id: string): readonly Pt[] | null {
  const entity = def.entities?.find((e) => e.id === id);
  for (const value of Object.values(entity ?? {})) {
    if (typeof value !== "object" || value === null) continue;
    const parsed = parseShape(value);
    if (parsed.ok && parsed.shape.type === "poly") return parsed.shape.pts;
  }
  return null;
}

/** The polygon's area and the pieces' summed, in m², from the decomposer's whole-px measure. */
function areaCheck(
  points: readonly Pt[] | null,
  pxPerMetre: number,
): { area: number; pieces: number } | null {
  if (!points) return null;
  const whole = decomposePolygon(points, { pxPerMetre });
  if (!whole.ok) return null;
  let pieces2 = 0;
  for (const piece of whole.pieces) {
    const part = decomposePolygon(piece, { pxPerMetre });
    if (part.ok) pieces2 += Math.abs(part.area2);
  }
  const toM2 = (area2: number) => area2 / 2 / (pxPerMetre * pxPerMetre);
  return { area: toM2(Math.abs(whole.area2)), pieces: toM2(pieces2) };
}

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
    try {
      const live = await readLiveScene({
        projects: ctx.projects,
        url: input.url,
        project: ctx.project,
        scene: input.scene,
        timeoutMs: input.timeoutMs,
        ...hostedOptions(ctx, input.token),
      });
      def = JSON.parse(live.text) as SceneDefinition;
    } catch (e) {
      if (e instanceof ProjectClientError)
        return e.exitCode === 2 ? usage(e.message) : failure(e.message, { scene: input.scene });
      throw e;
    }
  }

  const built = decomposeBatch(def, input.id, loaded.registry, { group: input.group });
  if (!built.ok)
    return {
      exitCode: 1,
      data: { scene: input.scene, id: input.id, written: false, issue: built.issue },
      text: `${input.scene}: ${input.id} can't split\n${issueLine(built.issue)}`,
    };

  const pieces = addedIds(built.batch);
  const area = areaCheck(polyOf(def, input.id), pxPerMetreOf(loaded.registry));
  const text = JSON.stringify(built.batch);
  const via = { ...ctx, readStdin: async () => text };
  const result: ToolResult = input.live
    ? await applyLive(
        {
          scene: input.scene,
          ops: "-",
          url: input.url,
          agent: input.agent,
          onBehalfOf: input.onBehalfOf,
          token: input.token,
          dryRun: input.dryRun,
          base: input.base,
          timeoutMs: input.timeoutMs,
        },
        via,
      )
    : await apply({ scene: input.scene, ops: "-", dryRun: input.dryRun, base: input.base }, via);

  const areaLine = area
    ? `area ${area.area} → pieces ${area.pieces} (${area.area === area.pieces ? "preserved" : "MISMATCH"})`
    : "";
  return {
    ...result,
    data: {
      ...(result.data as Record<string, unknown>),
      id: input.id,
      pieces,
      ...(area ? { area: area.area, piecesArea: area.pieces } : {}),
      batch: built.batch,
    },
    text: [result.text, `pieces: ${pieces.join(", ")}`, areaLine].filter(Boolean).join("\n"),
  };
};

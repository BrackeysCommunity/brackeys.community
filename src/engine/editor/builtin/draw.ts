import type { Registry } from "../../game/types";
import { bulkEntries, bulkId } from "../../scene/expand";
import { geometryFields } from "../../scene/schema";
import { shapeToTuple } from "../../scene/shapes";
import type { OpBatch, Pt, Ref, SceneDefinition, ShapeObj } from "../../scene/types";
import { nextFreeId } from "../clipboard";
import { roundShape } from "../gizmos/batch";
import { readShapeSize } from "../gizmos/readout";
import { snapPoint } from "../snap";
import { defineEditorTool, type EditorToolDef, type ToolOverlay } from "../tools";

/** The type the draw tools add unless told otherwise. */
export const DEFAULT_DRAW_TYPE = "solid";

/**
 * The one `add` that puts a drawn shape in the document: an entry of the
 * type's own shape bulk key when the registry has one, else an entity of
 * `type` with a fresh id and the shape in its first shape field. `select`
 * names what it adds. `null` when `type` has no shape field.
 */
export function drawBatch(
  def: SceneDefinition,
  registry: Registry,
  type: string,
  shape: ShapeObj,
  label = `Draw ${shape.type}`,
): { batch: OpBatch; select: Ref } | null {
  const tuple = shapeToTuple(roundShape(shape));
  const bulk = registry.bulkKey(type);
  if (bulk?.form === "shape" && bulk.type === type) {
    return {
      batch: { label, ops: [{ op: "addBulk", key: bulk.key, shapes: [tuple] }] },
      select: bulkId(bulk.key, bulkEntries(def, bulk.key).length),
    };
  }
  const t = registry.types.get(type);
  const field = t && geometryFields(t).find((f) => f.kind === "shape")?.field;
  if (!field) return null;
  const id = nextFreeId(type, new Set((def.entities ?? []).map((e) => e.id)));
  return {
    batch: { label, ops: [{ op: "add", entity: { id, type, [field]: tuple } }] },
    select: id,
  };
}

export type DrawToolOptions = {
  id: string;
  label: string;
  description: string;
  shape: "box" | "circle";
  /** The type drawn shapes become; default `solid`. */
  type?: string;
};

/**
 * The drawn shape from a press at `a` to the pointer at `b`, both snapped: a
 * box between the corners (Shift: a square, Alt: from the centre), or a
 * circle centred on `a` through `b`. `null` while it is too small to keep.
 */
export function drawnShape(
  kind: "box" | "circle",
  a: Pt,
  b: Pt,
  mods: { shift: boolean; alt: boolean },
): ShapeObj | null {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (kind === "circle") {
    const r = Math.round(Math.hypot(dx, dy));
    return r >= 1 ? { type: "circle", cx: a[0], cy: a[1], r } : null;
  }
  if (mods.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  const box: ShapeObj = mods.alt
    ? { type: "box", cx: a[0], cy: a[1], hw: Math.abs(dx), hh: Math.abs(dy), rotDeg: 0 }
    : {
        type: "box",
        cx: a[0] + dx / 2,
        cy: a[1] + dy / 2,
        hw: Math.abs(dx) / 2,
        hh: Math.abs(dy) / 2,
        rotDeg: 0,
      };
  return box.hw >= 1 && box.hh >= 1 ? roundShape(box) : null;
}

/**
 * A tool that draws one shape per drag, snapped (Ctrl/Cmd bypasses), and
 * commits it as one `add` on release; Escape mid-drag drops it.
 */
export function createDrawTool(opts: DrawToolOptions): EditorToolDef {
  const type = opts.type ?? DEFAULT_DRAW_TYPE;
  return defineEditorTool({
    id: opts.id,
    label: opts.label,
    description: opts.description,
    create(ctx) {
      let start: Pt | null = null;
      let shape: ShapeObj | null = null;
      let cursor: Pt = [0, 0];
      const drop = () => {
        start = null;
        shape = null;
        ctx.invalidate();
      };
      return {
        pointer(e) {
          const p = snapPoint(e.world, ctx.snap(), { bypass: e.mod });
          if (e.type === "down") {
            if (e.button !== 0) return false;
            start = p;
            shape = null;
            cursor = p;
            ctx.invalidate();
            return true;
          }
          if (!start) return false;
          if (e.type === "move") {
            cursor = p;
            shape = drawnShape(opts.shape, start, p, e);
            ctx.invalidate();
            return true;
          }
          if (e.type === "up") {
            const drawn = drawnShape(opts.shape, start, p, e);
            drop();
            const out = drawn && drawBatch(ctx.getDoc(), ctx.registry, type, drawn);
            if (out) ctx.commit(out.batch, { selectionAfter: [out.select] });
            return true;
          }
          return false;
        },
        cancel() {
          if (!start) return false;
          drop();
          return true;
        },
        gesture: () => start !== null,
        overlay(): ToolOverlay {
          if (!shape) return {};
          return {
            ghosts: [{ shape, valid: true }],
            readout: { at: cursor, text: readShapeSize(shape) },
          };
        },
        cursor: () => "crosshair",
      };
    },
  });
}

export const boxTool = createDrawTool({
  id: "box",
  label: "Box",
  description: "Drag to draw a box. Shift draws a square, Alt draws from the centre.",
  shape: "box",
});

export const circleTool = createDrawTool({
  id: "circle",
  label: "Circle",
  description: "Drag from the centre to draw a circle.",
  shape: "circle",
});

import { z } from "zod";

import type { Registry } from "../../game/types";
import type { PlacementCheck } from "../../placement";
import { bulkEntries, bulkId } from "../../scene/expand";
import { geometryFields } from "../../scene/schema";
import { aabb } from "../../scene/shape-geometry";
import { shapeToTuple } from "../../scene/shapes";
import type { OpBatch, Pt, Ref, SceneDefinition, ShapeObj, ShapeTuple } from "../../scene/types";
import { nextFreeId } from "../clipboard";
import { roundShape } from "../gizmos/batch";
import { readShapeSize } from "../gizmos/readout";
import { boundsCheck } from "../placement";
import { snapPoint } from "../snap";
import {
  defineEditorTool,
  type EditorToolContext,
  type EditorToolDef,
  type ToolOption,
  type ToolOverlay,
} from "../tools";

/** Screen px each arm of the crosshair before a press reaches from the snapped start. */
const CROSSHAIR_PX = 12;

/** A crosshair on `at`, `arm` world px each way, in the selection's tone so it reads over the scene. */
function crosshair([x, y]: Pt, arm: number): NonNullable<ToolOverlay["polylines"]> {
  const line = (from: Pt, to: Pt) => ({
    pts: [from, to],
    closed: false,
    tone: "selected" as const,
  });
  return [line([x - arm, y], [x + arm, y]), line([x, y - arm], [x, y + arm])];
}

/** The type the draw tools add unless told otherwise. */
export const DEFAULT_DRAW_TYPE = "solid";

/** The built-in tools that draw a shape for an entity to hold. */
export type DrawToolKind = "box" | "circle" | "pen";

/** A type a draw tool can add. */
export type DrawTypeOption = { type: string; label: string; description: string };

/** A small shape of each kind a tool draws, to ask a field whether it takes them. */
const SAMPLES: Record<DrawToolKind, readonly ShapeTuple[]> = {
  box: [["box", 0, 0, 8, 8]],
  circle: [["circle", 0, 0, 8]],
  pen: [
    ["poly", 0, 0, 16, 0, 0, 16],
    ["chain", 0, 0, 16, 0],
  ],
};

/** The field a drawn shape fills: the type's first shape field. */
export function drawField(
  registry: Registry,
  type: string,
): { field: string; schema: z.core.$ZodType } | undefined {
  const t = registry.types.get(type);
  const field = t && geometryFields(t).find((f) => f.kind === "shape")?.field;
  const schema = field ? t.shape[field] : undefined;
  return field && schema ? { field, schema } : undefined;
}

/** Whether a shape field takes `shape`. */
export const fieldTakes = (schema: z.core.$ZodType, shape: ShapeTuple): boolean =>
  z.safeParse(schema, shape).success;

/**
 * The types a draw tool can add, in registry order: those whose shape field
 * takes what the tool draws (a box, a circle, or a pen's poly or chain).
 */
export function drawTypeOptions(registry: Registry, kind: DrawToolKind): DrawTypeOption[] {
  const out: DrawTypeOption[] = [];
  for (const [type, t] of registry.types) {
    const target = drawField(registry, type);
    if (!target || !SAMPLES[kind].some((s) => fieldTakes(target.schema, s))) continue;
    out.push({ type, label: t.inspector?.label ?? type, description: t.description });
  }
  return out;
}

/** The command prefix that picks a draw tool's type: `type:nav`. */
export const DRAW_TYPE_COMMAND = "type:";

/** The type each host's draw tools last picked, one choice the box, circle and pen share. */
const picked = new WeakMap<EditorToolContext, string>();

/** A draw tool's type choice, kept per host so it survives switching tools. */
export type DrawTypeChoice = {
  /** The type the next shape becomes. */
  type(): string;
  /** The choice for the toolbar; absent when the tool can draw fewer than two types. */
  option(): ToolOption | undefined;
  /** Takes `type:<name>` for a type the tool can draw. */
  command(command: string): boolean;
};

/**
 * The type the host last picked when this tool can draw it, else `fallback`
 * when it can (or nothing can be drawn), else the first type it can draw.
 */
export function drawTypeChoice(
  ctx: EditorToolContext,
  kind: DrawToolKind,
  fallback: string = DEFAULT_DRAW_TYPE,
): DrawTypeChoice {
  const options = drawTypeOptions(ctx.registry, kind);
  const offered = (type: string) => options.some((o) => o.type === type);
  const choices = options.map((o) => ({
    value: o.type,
    label: o.label,
    description: o.description,
  }));
  let option: ToolOption | undefined;
  const type = (): string => {
    const last = picked.get(ctx);
    if (last !== undefined && offered(last)) return last;
    return offered(fallback) || options.length === 0 ? fallback : options[0]!.type;
  };
  return {
    type,
    option() {
      if (choices.length < 2) return undefined;
      const value = type();
      if (option?.value !== value)
        option = { label: "Draw type", value, choices, command: DRAW_TYPE_COMMAND };
      return option;
    },
    command(command) {
      if (!command.startsWith(DRAW_TYPE_COMMAND)) return false;
      const next = command.slice(DRAW_TYPE_COMMAND.length);
      if (!offered(next)) return false;
      picked.set(ctx, next);
      ctx.invalidate();
      return true;
    },
  };
}

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
  const field = drawField(registry, type)?.field;
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
  /** The type drawn shapes become until another is picked; default `solid`. */
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
 * commits it as one `add` on release; Escape mid-drag drops it. The shape
 * becomes the picked type (`type:<name>`), offered in the overlay's `option`.
 */
export function createDrawTool(opts: DrawToolOptions): EditorToolDef {
  return defineEditorTool({
    id: opts.id,
    label: opts.label,
    description: opts.description,
    create(ctx) {
      const choice = drawTypeChoice(ctx, opts.shape, opts.type);
      const withOption = (o: ToolOverlay): ToolOverlay => {
        const option = choice.option();
        return option ? { ...o, option } : o;
      };
      let start: Pt | null = null;
      let shape: ShapeObj | null = null;
      let cursor: Pt | null = null;
      const drop = () => {
        start = null;
        shape = null;
        ctx.invalidate();
      };
      const follow = (p: Pt) => {
        if (cursor && cursor[0] === p[0] && cursor[1] === p[1]) return;
        cursor = p;
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
          if (!start) {
            if (e.type === "move") follow(p);
            return false;
          }
          if (e.type === "move") {
            cursor = p;
            shape = drawnShape(opts.shape, start, p, e);
            ctx.invalidate();
            return true;
          }
          if (e.type === "up") {
            const drawn = drawnShape(opts.shape, start, p, e);
            drop();
            const out = drawn && drawBatch(ctx.getDoc(), ctx.registry, choice.type(), drawn);
            if (out) ctx.commit(out.batch, { selectionAfter: [out.select] });
            return true;
          }
          return false;
        },
        command: (command) => choice.command(command),
        cancel() {
          if (!start) return false;
          drop();
          return true;
        },
        gesture: () => start !== null,
        overlay(): ToolOverlay {
          // Before the press: where the drag will start, snapped.
          if (!start) {
            if (!cursor) return withOption({});
            return withOption({
              points: [{ at: cursor, tone: "ghost" }],
              polylines: crosshair(cursor, CROSSHAIR_PX / ctx.scale()),
            });
          }
          if (!shape) return withOption({ points: [{ at: start, tone: "ghost" }] });
          const def = ctx.getDoc();
          const type = choice.type();
          const check: PlacementCheck = drawBatch(def, ctx.registry, type, shape)
            ? boundsCheck(aabb(shape), def)
            : { valid: false, reason: `A ${type} has no shape to draw` };
          return withOption({
            ghosts: [
              { shape, valid: check.valid, ...(check.reason ? { reason: check.reason } : {}) },
            ],
            readout: { at: cursor ?? start, text: readShapeSize(shape) },
          });
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

import { isPolygonField } from "../../game/fields";
import type { Registry } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import { isConvex } from "../../scene/shape-geometry";
import type { Pt, ShapeObj } from "../../scene/types";
import { snapToPixel } from "../../scene/units";
import { pathBatch } from "../gizmos/batch";
import { readLength, readPoint } from "../gizmos/readout";
import { gizmoTarget, type GizmoTarget } from "../gizmos/target";
import { MIN_WAYPOINTS } from "../gizmos/waypoints";
import { pickAt } from "../picking";
import { roundPt, snapPoint } from "../snap";
import {
  defineEditorTool,
  type EditorTool,
  type EditorToolContext,
  type ToolModifiers,
  type ToolOverlay,
} from "../tools";
import { drawBatch, drawField, drawTypeChoice, fieldTakes } from "./draw";

/** Screen px from the first point that closes a pen stroke. */
export const CLOSE_PX = 8;
/** Screen px of slack when a click picks an entity. */
export const PICK_TOL_PX = 4;

/** Unit steps of the eight 45° directions, starting east and turning clockwise on screen. */
const OCTANTS: readonly Pt[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** `p` pulled onto the nearest 45° line through `from`, a whole number of world px along each axis. */
export function lock45(from: Pt, p: Pt, pxPerMetre: number): Pt {
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  const u = OCTANTS[octant]!;
  const t = snapToPixel((dx * u[0] + dy * u[1]) / (u[0] * u[0] + u[1] * u[1]), pxPerMetre);
  return roundPt([from[0] + t * u[0], from[1] + t * u[1]], pxPerMetre);
}

/** The next segment's readout: where it ends, and its length when it has one. */
function segmentText(from: Pt, to: Pt, pxPerMetre: number): string {
  const len = snapToPixel(Math.hypot(to[0] - from[0], to[1] - from[1]), pxPerMetre);
  const at = readPoint(to, pxPerMetre);
  return len > 0 ? `${at}  ${readLength(len, pxPerMetre)}` : at;
}

/** What the shape field a stroke fills takes. */
export type StrokeFit = {
  /** Chains, open or closed. */
  chain: boolean;
  /** Concave polys (a `polygonField`). */
  concavePoly: boolean;
};

const ANY_STROKE: StrokeFit = { chain: true, concavePoly: false };

/** What `type`'s shape field takes; nothing for a type with none. */
export function strokeFit(registry: Registry, type: string): StrokeFit {
  const target = drawField(registry, type);
  if (!target) return { chain: false, concavePoly: false };
  return {
    chain: fieldTakes(target.schema, ["chain", 0, 0, 16, 0]),
    concavePoly: isPolygonField(target.schema),
  };
}

/**
 * The shape a finished pen stroke makes: an open chain, or when closed on
 * its first point a poly if convex. A concave closed stroke stays a poly
 * where the field takes concave polys, else becomes a closed chain (its
 * first point repeated at the end) where it takes chains, else stays a
 * poly for validation to judge.
 */
export function strokeShape(
  pts: readonly Pt[],
  closed: boolean,
  fit: StrokeFit = ANY_STROKE,
): ShapeObj {
  if (!closed) return { type: "chain", pts: [...pts] };
  if (isConvex(pts) || fit.concavePoly || !fit.chain) return { type: "poly", pts: [...pts] };
  return { type: "chain", pts: [...pts, pts[0]!] };
}

type StrokeOptions = {
  /** Clicking the first point again closes the stroke. */
  closable: boolean;
  minPoints: number;
  numbered: boolean;
  finish(pts: Pt[], closed: boolean): void;
  /** Why finishing these points now would add nothing; the stroke then stays open and says so. */
  refuse?(pts: readonly Pt[], closed: boolean): string | undefined;
  /** Overlay drawn under the stroke. */
  under?(): ToolOverlay;
  /** A press when no stroke is open; true when it was used for something else (picking a target). */
  before?(world: Pt): boolean;
  /** A press now would start a stroke, so the snapped point under the pointer is shown; default true. */
  armed?(): boolean;
};

/**
 * Click-by-click point entry, the pen's and the waypoint tool's: each click
 * adds a snapped point (Shift locks it to 45° from the last), Backspace
 * removes the last, Enter or a double-click finishes, Escape cancels with
 * no batch. A finish the stroke can't make keeps it open, outlined as
 * invalid with the reason in the readout, until a point is added or removed.
 */
function strokeTool(ctx: EditorToolContext, opts: StrokeOptions): EditorTool {
  const ppm = pxPerMetreOf(ctx.registry);
  let pts: Pt[] = [];
  let hover: Pt | null = null;
  /** The finish last refused (open or closed), until the points change. */
  let refused: { closed: boolean } | null = null;

  const place = (world: Pt, mods: ToolModifiers): Pt => {
    const p = snapPoint(world, ctx.snap(), ppm, { bypass: mods.mod });
    const last = pts[pts.length - 1];
    return mods.shift && last ? lock45(last, p, ppm) : p;
  };
  const reset = () => {
    pts = [];
    refused = null;
    ctx.invalidate();
  };
  /** A click at `p` would close the stroke on its first point. */
  const closes = (p: Pt): boolean => {
    const first = pts[0];
    return (
      opts.closable &&
      first !== undefined &&
      pts.length >= 3 &&
      Math.hypot(p[0] - first[0], p[1] - first[1]) <= CLOSE_PX / ctx.scale()
    );
  };
  const finish = (closed: boolean) => {
    const reason = pts.length >= opts.minPoints ? opts.refuse?.(pts, closed) : undefined;
    if (reason) {
      refused = { closed };
      ctx.invalidate();
      return;
    }
    const stroke = pts;
    reset();
    if (stroke.length >= opts.minPoints) opts.finish(stroke, closed);
  };

  return {
    pointer(e) {
      if (e.type === "move") {
        hover = place(e.world, e);
        ctx.invalidate();
        return pts.length > 0;
      }
      if (e.type !== "down" || e.button !== 0) return e.type === "up" && pts.length > 0;
      if (pts.length === 0 && opts.before?.(e.world)) return true;
      if (e.clicks >= 2 && pts.length > 0) {
        finish(false);
        return true;
      }
      const p = place(e.world, e);
      if (closes(p)) {
        finish(true);
        return true;
      }
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) {
        pts.push(p);
        refused = null;
      }
      ctx.invalidate();
      return true;
    },
    key(e) {
      if (e.type !== "down" || pts.length === 0) return false;
      if (e.key === "Backspace") {
        pts.pop();
        refused = null;
        ctx.invalidate();
        return true;
      }
      if (e.key === "Enter") {
        finish(false);
        return true;
      }
      return false;
    },
    cancel() {
      if (pts.length === 0) return false;
      reset();
      return true;
    },
    gesture: () => pts.length > 0,
    overlay(): ToolOverlay {
      const base = opts.under?.() ?? {};
      const last = pts[pts.length - 1];
      if (!last) {
        const starts = hover !== null && (opts.armed?.() ?? true);
        return starts && hover ? { ...base, points: [{ at: hover, tone: "ghost" }] } : base;
      }
      const first = pts[0]!;
      const closing = hover !== null && closes(hover);
      // The next segment follows the pointer, or runs back to the first point when a click would close.
      const next = closing ? first : hover;
      const reason = refused ? opts.refuse?.(pts, refused.closed) : undefined;
      const polylines: NonNullable<ToolOverlay["polylines"]> = [
        ...(base.polylines ?? []),
        { pts, closed: false, numbered: opts.numbered, tone: reason ? "invalid" : "ghost" },
      ];
      if (next) polylines.push({ pts: [last, next], closed: false, dashed: true, tone: "ghost" });
      const readout = reason
        ? { at: hover ?? last, text: reason }
        : hover && next
          ? { at: hover, text: segmentText(last, next, ppm) }
          : null;
      return {
        ...base,
        polylines,
        points: pts.map((at, i) => ({
          at,
          tone: closing && i === 0 ? ("selected" as const) : ("ghost" as const),
        })),
        ...(readout ? { readout } : {}),
      };
    },
    cursor: () => "crosshair",
  };
}

/**
 * The pen (`P`): a stroke of clicks becomes one chain or poly of the picked
 * type (`type:<name>`, offered in the overlay's `option`; default `solid`).
 * For a type that takes no chain, an open stroke of three points or more
 * closes; finishing a shorter one keeps it open and says it needs three.
 */
export function createPenTool(opts: { type?: string } = {}) {
  return defineEditorTool({
    id: "pen",
    label: "Pen",
    description:
      "Click to add points; Shift locks to 45°, Backspace removes the last, Enter finishes, clicking the first point closes the shape.",
    create(ctx) {
      const choice = drawTypeChoice(ctx, "pen", opts.type);
      const tool = strokeTool(ctx, {
        closable: true,
        minPoints: 2,
        numbered: false,
        refuse(pts, closed) {
          const type = choice.type();
          return !closed && pts.length < 3 && !strokeFit(ctx.registry, type).chain
            ? `A ${type} needs 3 points`
            : undefined;
        },
        finish(pts, closed) {
          const type = choice.type();
          const fit = strokeFit(ctx.registry, type);
          if (!closed && !fit.chain) closed = true;
          const shape = strokeShape(pts, closed, fit);
          const out = drawBatch(ctx.getDoc(), ctx.registry, type, shape, "Pen");
          if (out) ctx.commit(out.batch, { selectionAfter: [out.select] });
        },
      });
      return {
        ...tool,
        command: (command) => choice.command(command),
        overlay(): ToolOverlay {
          const own = tool.overlay?.() ?? {};
          const option = choice.option();
          return option ? { ...own, option } : own;
        },
      };
    },
  });
}

export const penTool = createPenTool();

const pathTarget = (ctx: EditorToolContext, ref: string): GizmoTarget | undefined => {
  const t = gizmoTarget(ctx.getDoc(), ctx.registry, ref);
  return t?.path ? t : undefined;
};

/**
 * The waypoint tool (`W`): with one path-following entity selected, a stroke
 * of clicks replaces its path's waypoints in one batch. With none selected,
 * a click selects the topmost one under the pointer.
 */
export const waypointsTool = defineEditorTool({
  id: "waypoints",
  label: "Waypoints",
  description:
    "Click to lay out the selected path's waypoints; Shift locks to 45°, Backspace removes the last, Enter finishes.",
  create(ctx) {
    const target = () => {
      const sel = ctx.selection();
      return sel.length === 1 ? pathTarget(ctx, sel[0]!) : undefined;
    };
    return strokeTool(ctx, {
      closable: false,
      minPoints: MIN_WAYPOINTS,
      numbered: true,
      armed: () => target() !== undefined,
      before(world) {
        if (target()) return false;
        const hit = pickAt(ctx.index(), world, {
          tolPx: PICK_TOL_PX,
          scale: ctx.scale(),
          layers: ctx.layers(),
        }).find((h) => pathTarget(ctx, h.ref));
        if (hit) ctx.select([hit.ref]);
        return true;
      },
      under() {
        const t = target();
        return t?.path
          ? {
              polylines: [
                {
                  pts: t.path.pts,
                  closed: t.path.loop,
                  dashed: true,
                  numbered: true,
                  tone: "selected",
                },
              ],
            }
          : {};
      },
      finish(pts) {
        const t = target();
        const batch = t && pathBatch(t, pts, pxPerMetreOf(ctx.registry), `Lay out ${t.ref} path`);
        if (batch) ctx.commit(batch);
      },
    });
  },
});

import { isConvex } from "../../scene/shape-geometry";
import type { Pt, ShapeObj } from "../../scene/types";
import { pathBatch } from "../gizmos/batch";
import { readPoint } from "../gizmos/readout";
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
import { DEFAULT_DRAW_TYPE, drawBatch } from "./draw";

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

/** `p` pulled onto the nearest 45° line through `from`, whole px. */
export function lock45(from: Pt, p: Pt): Pt {
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  const u = OCTANTS[octant]!;
  const t = Math.round((dx * u[0] + dy * u[1]) / (u[0] * u[0] + u[1] * u[1]));
  return roundPt([from[0] + t * u[0], from[1] + t * u[1]]);
}

/**
 * The shape a finished pen stroke makes: an open chain, or when closed on
 * its first point a poly if convex and a closed chain (its first point
 * repeated at the end) if not.
 */
export function strokeShape(pts: readonly Pt[], closed: boolean): ShapeObj {
  if (!closed) return { type: "chain", pts: [...pts] };
  return isConvex(pts)
    ? { type: "poly", pts: [...pts] }
    : { type: "chain", pts: [...pts, pts[0]!] };
}

type StrokeOptions = {
  /** Clicking the first point again closes the stroke. */
  closable: boolean;
  minPoints: number;
  numbered: boolean;
  finish(pts: Pt[], closed: boolean): void;
  /** Overlay drawn under the stroke. */
  under?(): ToolOverlay;
  /** A press when no stroke is open; true when it was used for something else (picking a target). */
  before?(world: Pt): boolean;
};

/**
 * Click-by-click point entry, the pen's and the waypoint tool's: each click
 * adds a snapped point (Shift locks it to 45° from the last), Backspace
 * removes the last, Enter or a double-click finishes, Escape cancels with
 * no batch.
 */
function strokeTool(ctx: EditorToolContext, opts: StrokeOptions): EditorTool {
  let pts: Pt[] = [];
  let hover: Pt | null = null;

  const place = (world: Pt, mods: ToolModifiers): Pt => {
    const p = snapPoint(world, ctx.snap(), { bypass: mods.mod });
    const last = pts[pts.length - 1];
    return mods.shift && last ? lock45(last, p) : p;
  };
  const reset = () => {
    pts = [];
    ctx.invalidate();
  };
  const finish = (closed: boolean) => {
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
      const first = pts[0];
      const tol = CLOSE_PX / ctx.scale();
      if (
        opts.closable &&
        first &&
        pts.length >= 3 &&
        Math.hypot(p[0] - first[0], p[1] - first[1]) <= tol
      ) {
        finish(true);
        return true;
      }
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
      ctx.invalidate();
      return true;
    },
    key(e) {
      if (e.type !== "down" || pts.length === 0) return false;
      if (e.key === "Backspace") {
        pts.pop();
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
      if (pts.length === 0) return base;
      const line = hover ? [...pts, hover] : pts;
      return {
        ...base,
        polylines: [
          ...(base.polylines ?? []),
          { pts: line, closed: false, numbered: opts.numbered, tone: "ghost" },
        ],
        points: pts.map((at) => ({ at, tone: "ghost" as const })),
        ...(hover ? { readout: { at: hover, text: readPoint(hover) } } : {}),
      };
    },
    cursor: () => "crosshair",
  };
}

/** The pen (`P`): a stroke of clicks becomes one solid chain or poly. */
export function createPenTool(opts: { type?: string } = {}) {
  const type = opts.type ?? DEFAULT_DRAW_TYPE;
  return defineEditorTool({
    id: "pen",
    label: "Pen",
    description:
      "Click to add points; Shift locks to 45°, Backspace removes the last, Enter finishes, clicking the first point closes the shape.",
    create(ctx) {
      return strokeTool(ctx, {
        closable: true,
        minPoints: 2,
        numbered: false,
        finish(pts, closed) {
          const out = drawBatch(ctx.getDoc(), ctx.registry, type, strokeShape(pts, closed), "Pen");
          if (out) ctx.commit(out.batch, { selectionAfter: [out.select] });
        },
      });
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
        const batch = t && pathBatch(t, pts, `Lay out ${t.ref} path`);
        if (batch) ctx.commit(batch);
      },
    });
  },
});

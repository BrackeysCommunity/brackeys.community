import type { DebugDraw, DebugDrawCommand, DebugDrawSink, DebugStyle } from "../game/types";
import type { ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";

/** Draws past this many in one tick are dropped, so a runaway loop can't stall the frame. */
export const DEBUG_DRAW_MAX = 4096;

const pt = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });

function styleOf(opts: DebugStyle | undefined): DebugStyle {
  if (!opts) return {};
  const out: DebugStyle = {};
  if (opts.color !== undefined) out.color = opts.color;
  if (opts.alpha !== undefined) out.alpha = opts.alpha;
  if (opts.width !== undefined) out.width = opts.width;
  if (opts.layer !== undefined) out.layer = opts.layer;
  return out;
}

/**
 * A sink that keeps every draw of a tick for `take`; what headless
 * `collectDebugDraw` and the shell's debug-draw layer pass the runtime.
 * Each draw is copied into plain data, so game code may reuse its vectors.
 */
export function createDebugDrawSink(): DebugDrawSink {
  let draws: DebugDrawCommand[] = [];
  const push = (cmd: DebugDrawCommand) => {
    if (draws.length < DEBUG_DRAW_MAX) draws.push(cmd);
  };
  const draw: DebugDraw = Object.freeze({
    line: (a: Vec2, b: Vec2, opts?: DebugStyle) =>
      push({ kind: "line", a: pt(a), b: pt(b), style: styleOf(opts) }),
    box: (at: Vec2, size: [number, number], opts?: DebugStyle) =>
      push({ kind: "box", at: pt(at), size: [size[0], size[1]], style: styleOf(opts) }),
    circle: (at: Vec2, r: number, opts?: DebugStyle) =>
      push({ kind: "circle", at: pt(at), r, style: styleOf(opts) }),
    shape: (s: ShapeObj, opts?: DebugStyle) =>
      push({ kind: "shape", shape: structuredClone(s), style: styleOf(opts) }),
    path: (pts: readonly Vec2[], opts?: DebugStyle & { closed?: boolean }) =>
      push({ kind: "path", pts: pts.map(pt), closed: opts?.closed === true, style: styleOf(opts) }),
    text: (at: Vec2, text: string, opts?: DebugStyle & { size?: number }) =>
      push({
        kind: "text",
        at: pt(at),
        text: String(text),
        ...(opts?.size !== undefined ? { size: opts.size } : {}),
        style: styleOf(opts),
      }),
    active: true,
  });
  return {
    draw,
    take() {
      const out = draws;
      draws = [];
      return out;
    },
  };
}

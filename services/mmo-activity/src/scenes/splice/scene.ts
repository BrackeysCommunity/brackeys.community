import "./scene.css";
import {
  HIT,
  board,
  distance,
  pointers,
  say,
  set,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import { GOING, type Scene, type SceneHost } from "../../shell/kit.ts";
import { plural } from "../../units.ts";
import { DOWN, DRAG, LIFT, type SpliceModel } from "./model.ts";

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  /** The board's top left corner, a cell's size, and its columns and rows. */
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  /**
   * How far outside a cell a finger still counts as on it. Cells are
   * narrower than a thumb on a phone; with the slack the trace is a
   * thumb wide.
   */
  slack: number;
}

export function geometry(cols: number, rows: number, size: Size): Geometry {
  const pad = 6;
  const head = 30;
  const w = (size.width - pad * 2) / cols;
  const room = Math.max(1, size.height - head - pad);
  const h = Math.min(room / rows, w * 2, 64);
  const least = Math.min(w, h);
  return {
    x: pad,
    y: head + (room - h * rows) / 2,
    w,
    h,
    cols,
    rows,
    slack: Math.max(3, Math.min(HIT - least / 2, least / 3)),
  };
}

/** The middle of a cell. */
export function centre(geo: Geometry, cell: number): Point {
  return {
    x: geo.x + ((cell % geo.cols) + 0.5) * geo.w,
    y: geo.y + (Math.trunc(cell / geo.cols) + 0.5) * geo.h,
  };
}

/** The cell under a point; a point off the board is on the nearest cell of its edge. */
export function cellAt(geo: Geometry, p: Point): number {
  const col = Math.max(0, Math.min(geo.cols - 1, Math.floor((p.x - geo.x) / geo.w)));
  const row = Math.max(0, Math.min(geo.rows - 1, Math.floor((p.y - geo.y) / geo.h)));
  return row * geo.cols + col;
}

/** How far a point is outside a cell; 0 on it. */
export function outside(geo: Geometry, cell: number, p: Point): number {
  const c = centre(geo, cell);
  return Math.hypot(
    Math.max(0, Math.abs(p.x - c.x) - geo.w / 2),
    Math.max(0, Math.abs(p.y - c.y) - geo.h / 2),
  );
}

/** The cell an iron is set down on: the one of these under it, or the nearest within the slack. */
export function setDown(geo: Geometry, cells: number[], p: Point): number | undefined {
  let best: number | undefined;
  let least = Infinity;
  for (const cell of cells) {
    const d = outside(geo, cell, p);
    if (d <= geo.slack && d < least) [best, least] = [cell, d];
  }
  return best;
}

/**
 * The iron: a trace across the board is soldered by dragging along it,
 * cell by cell. The iron is lifted over a gap and set down past it, and
 * the part not yet soldered twitches a row at a time.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as SpliceModel;
  const cols = host.layout.size;
  const rows = host.layout.range ?? 0;
  const warn = host.layout.par?.[0] ?? 0;

  const view = board(
    host,
    `A circuit board with a trace of ${plural(host.layout.order?.length ?? 0, "cell")} from the left edge to the right. Drag along it to solder it, lift over each gap, and follow the loose end when it twitches.`,
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(cols, rows, { width: 1, height: 1 });
  let status: SVGTextElement | undefined;
  let loose: SVGPathElement | undefined;
  let holes: SVGPathElement | undefined;
  let done: SVGPathElement | undefined;
  let beads: SVGPathElement | undefined;
  let next: SVGCircleElement | undefined;
  let twitch: SVGPathElement | undefined;
  let iron: SVGCircleElement | undefined;
  let guide: SVGPathElement | undefined;
  let lit: SVGPathElement | undefined;
  let held: Point | undefined;
  let dead = false;
  /** The positions past a gap that a hint has marked. */
  const marked = new Set<number>();

  function build(): void {
    const least = Math.min(geo.w, geo.h);
    let dots = "";
    for (let c = 0; c < cols * rows; c++) {
      const p = centre(geo, c);
      dots += `M${p.x},${p.y}h0.01`;
    }
    status = svg("text", { class: "status", x: size.width / 2, y: 20 });
    loose = svg("path", { class: "loose", "stroke-width": least * 0.3 });
    holes = svg("path", { class: "holes" });
    done = svg("path", { class: "done", "stroke-width": least * 0.42 });
    beads = svg("path", { class: "beads", "stroke-width": least * 0.2 });
    next = svg("circle", { class: "next", r: least * 0.46 });
    twitch = svg("path", { class: "twitch" });
    iron = svg("circle", { class: "iron", r: Math.max(8, least * 0.3) });
    guide = svg("path", { class: "guide" });
    lit = svg("path", { class: "hint" });
    root.append(
      status,
      svg("rect", {
        class: "plate",
        x: geo.x,
        y: geo.y,
        width: geo.w * cols,
        height: geo.h * rows,
      }),
      svg("path", { class: "dots", d: dots }),
      loose,
      holes,
      done,
      beads,
      guide,
      lit,
      next,
      twitch,
      iron,
    );
  }

  function adjacent(a: number, b: number): boolean {
    const dc = Math.abs((a % cols) - (b % cols));
    const dr = Math.abs(Math.trunc(a / cols) - Math.trunc(b / cols));
    return dc + dr === 1;
  }

  // A line through the trace's cells from one position to another, broken
  // at its gaps and wherever a twitch has pulled two cells apart.
  function run(m: SpliceModel, from: number, to: number): string {
    let d = "";
    let last: number | undefined;
    for (let i = from; i < to; i++) {
      if (m.gapAt(i)) {
        last = undefined;
        continue;
      }
      const cell = m.cell(i);
      const p = centre(geo, cell);
      d += last !== undefined && adjacent(last, cell) ? `L${p.x},${p.y}` : `M${p.x},${p.y}h0.01`;
      last = cell;
    }
    return d;
  }

  function ring(cell: number | undefined): string {
    if (cell === undefined) return "";
    const p = centre(geo, cell);
    const r = Math.min(geo.w, geo.h) * 0.62;
    return `M${p.x - r},${p.y}a${r},${r} 0 1 0 ${r * 2},0a${r},${r} 0 1 0 ${-r * 2},0`;
  }

  function line(m: SpliceModel, coming: number): string {
    if (coming)
      return coming < 0
        ? "The loose end is about to twitch up."
        : "The loose end is about to twitch down.";
    if (m.k === 0) return "Trace from the left end. Lift over gaps.";
    return m.gapAt(m.k) ? "A gap: lift, and set down past it." : "Keep to the trace.";
  }

  function frame(): void {
    // A trace that twitches under an iron held still is soldered where it lands.
    follow();
    if (dead) return;
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(cols, rows, size);
      build();
    }
    const m = model();
    const tw = m.twitch();
    const coming = tw && tw.step - m.steps <= warn ? tw.rows : 0;
    say(status!, line(m, coming));
    set(status!, { class: coming ? "status warned" : "status" });
    set(loose!, { d: run(m, m.k, m.length), class: coming ? "loose warned" : "loose" });
    set(done!, { d: run(m, 0, m.k) });
    let bead = "";
    let hole = "";
    for (let i = 0; i < m.length; i++) {
      const p = centre(geo, m.cell(i));
      if (!m.gapAt(i)) {
        if (i < m.k) bead += `M${p.x},${p.y}h0.01`;
        continue;
      }
      if (i < m.k) continue;
      const w = Math.min(geo.w, geo.h) * 0.26;
      const h = w;
      hole += `M${p.x - w},${p.y - h}L${p.x + w},${p.y + h}M${p.x + w},${p.y - h}L${p.x - w},${p.y + h}`;
    }
    set(beads!, { d: bead });
    set(holes!, { d: hole });
    const across = m.across();
    const target = across < m.length ? centre(geo, m.cell(across)) : undefined;
    set(next!, {
      cx: target?.x ?? 0,
      cy: target?.y ?? 0,
      class: target ? (m.on && across === m.k ? "next flowing" : "next") : "next off",
    });
    // An arrowhead beside the loose end points the way it will jump.
    const tip = target && coming ? target.y + coming * geo.h * 0.9 : 0;
    set(twitch!, {
      d:
        target && coming
          ? `M${target.x - 8},${tip - coming * 8}L${target.x},${tip}L${target.x + 8},${tip - coming * 8}`
          : "",
    });
    set(iron!, {
      cx: held?.x ?? 0,
      cy: held?.y ?? 0,
      class: held ? (m.on ? "iron on" : "iron") : "iron off",
    });
    set(guide!, { d: host.guide && m.k === 0 ? ring(m.cell(0)) : "" });
    // A hint names the far side of a gap by its place along the trace, and
    // stays until the iron is past it; any other rings a cell.
    const hint = host.hinted();
    const gap = hint !== undefined && (hint.c ?? 0) === DOWN && (hint.b ?? 0) > 0;
    if (hint && gap) marked.add(hint.b!);
    let rings = hint && !gap ? ring(hint.a) : "";
    for (const i of marked) if (i >= m.k && i < m.length) rings += ring(m.cell(i));
    set(lit!, { d: rings });
  }

  function send(cell: number, how: number): void {
    if (host.move(cell, 0, how) !== GOING) held = undefined;
  }

  // The iron is down and has moved, or the trace has moved under it.
  function follow(): void {
    const m = model();
    if (!held || !m.on) return;
    const under = cellAt(geo, held);
    const ahead = m.k < m.length && !m.gapAt(m.k) ? m.cell(m.k) : undefined;
    if (under === ahead) return send(under, DRAG);
    if (under === m.cur) return;
    // A finger just over the edge of the trace has not left it.
    if (outside(geo, m.cur, held) <= geo.slack) return;
    if (ahead !== undefined && outside(geo, ahead, held) <= geo.slack) return;
    send(under, DRAG);
  }

  function lift(): void {
    if (!held) return;
    held = undefined;
    const m = model();
    if (m.on) host.move(m.cur, 0, LIFT);
  }

  const unbind = pointers(host.surface, {
    down(p, ev) {
      const m = model();
      const across = m.cell(m.across());
      const on = setDown(geo, m.cur < 0 ? [across] : [across, m.cur], p);
      const reach = Math.min(geo.w, geo.h) / 2 + geo.slack;
      host.dropped(distance(p, centre(geo, across)), reach, on !== undefined, ev);
      held = p;
      // An iron set down off the trace solders nothing.
      if (on !== undefined) send(on, DOWN);
      return true;
    },
    move(p) {
      if (!held) return;
      held = p;
      follow();
    },
    up: lift,
    cancel: lift,
  });

  return {
    frame,
    destroy() {
      dead = true;
      unbind();
      view.remove();
    },
  };
}

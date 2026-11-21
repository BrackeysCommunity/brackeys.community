import "./scene.css";
import { board, glyph, pointers, set, svg, type Point, type Size } from "../../shell/board.ts";
import { SIDES } from "../../shell/grid.ts";
import { within, type Scene, type SceneHost } from "../../shell/kit.ts";
import type { MazeModel } from "./model.ts";

// How long the box stays tipped after a tilt.
const TILT_MS = 220;
// The share of the way to its cell the bit rolls each frame.
const ROLL = 0.35;

const ACROSS = [1, 0, -1, 0];
const DOWN = [0, 1, 0, -1];

/** Where the maze sits, in CSS px of the surface. */
export interface Geometry {
  cell: number;
  origin: Point;
  /** How far a finger travels for one tilt. */
  swipe: number;
}

export function geometry(n: number, size: Size): Geometry {
  const pad = 8;
  const cell = Math.min((size.width - pad * 2) / n, (size.height - pad * 2) / n);
  return {
    cell,
    origin: { x: (size.width - cell * n) / 2, y: (size.height - cell * n) / 2 },
    swipe: Math.max(24, Math.min(48, cell * 0.5)),
  };
}

export function centre(geo: Geometry, n: number, cell: number): Point {
  return {
    x: geo.origin.x + ((cell % n) + 0.5) * geo.cell,
    y: geo.origin.y + (Math.trunc(cell / n) + 0.5) * geo.cell,
  };
}

/**
 * The tilts a finger makes travelling from an anchor to a point: one for
 * each swipe's length along the stronger axis. Returns them with the
 * anchor the rest of the drag is measured from.
 */
export function tilts(anchor: Point, to: Point, swipe: number): { dirs: number[]; anchor: Point } {
  const dirs: number[] = [];
  let at = anchor;
  for (;;) {
    const dx = to.x - at.x;
    const dy = to.y - at.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < swipe) return { dirs, anchor: at };
    // A tilt forgives the drift across it, so a long swipe does not end in a turn.
    if (Math.abs(dx) >= Math.abs(dy)) {
      dirs.push(dx > 0 ? 0 : 2);
      at = { x: at.x + Math.sign(dx) * swipe, y: to.y };
    } else {
      dirs.push(dy > 0 ? 1 : 3);
      at = { x: to.x, y: at.y + Math.sign(dy) * swipe };
    }
  }
}

/**
 * The strongbox's maze, seen from above. A swipe tips the box that way
 * and the bit rolls one cell, unless a wall stops it; a finger kept down
 * and moving keeps tipping it.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as MazeModel;
  const layout = host.layout;
  const n = layout.size;
  const walls = layout.walls ?? [];

  const view = board(
    host,
    "A tumbler maze, seen from above. Swipe to tip the box and roll the bit, one cell a swipe, to the marked cell.",
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 });
  let bit: SVGGElement | undefined;
  let lit: SVGPathElement | undefined;
  let guide: SVGPathElement | undefined;
  let shown: Point | undefined;
  let anchor: Point | undefined;
  let tipped: { dir: number; until: number } | undefined;

  function build(): void {
    const { cell, origin } = geo;
    let d = "";
    for (let c = 0; c < n * n; c++) {
      const x = origin.x + (c % n) * cell;
      const y = origin.y + Math.trunc(c / n) * cell;
      const w = walls[c] ?? 0;
      if (w & 1) d += `M${x + cell},${y}v${cell}`;
      if (w & 2) d += `M${x},${y + cell}h${cell}`;
      if (w & 4) d += `M${x},${y}v${cell}`;
      if (w & 8) d += `M${x},${y}h${cell}`;
    }
    const home = centre(geo, n, layout.goal);
    const r = cell * 0.3;
    guide = svg("path", { class: "guide" });
    lit = svg("path", { class: "hint" });
    bit = svg(
      "g",
      { class: "bit", "aria-label": "The bit" },
      svg("circle", { r }),
      svg("circle", { class: "shine", r: r * 0.35, cx: -r * 0.3, cy: -r * 0.3 }),
    );
    root.append(
      svg("rect", {
        class: "floor",
        x: origin.x,
        y: origin.y,
        width: cell * n,
        height: cell * n,
      }),
      svg("circle", { class: "home", cx: home.x, cy: home.y, r: cell * 0.36 }),
      glyph(3, home, cell * 0.2, "var(--signal)"),
      svg("path", { class: "walls", d, "stroke-width": Math.max(4, cell * 0.09) }),
      guide,
      lit,
      bit,
    );
    shown = undefined;
  }

  // An arrow out of a cell, the way a tilt would roll the bit.
  function arrow(from: Point, dir: number | undefined): string {
    if (dir === undefined || !within(dir, SIDES)) return "";
    const len = geo.cell * 0.85;
    const head = geo.cell * 0.2;
    const [ax, ay] = [ACROSS[dir]!, DOWN[dir]!];
    const tip = { x: from.x + ax * len, y: from.y + ay * len };
    return (
      `M${from.x + ax * geo.cell * 0.4},${from.y + ay * geo.cell * 0.4}L${tip.x},${tip.y}` +
      `M${tip.x - ax * head - ay * head},${tip.y - ay * head + ax * head}L${tip.x},${tip.y}` +
      `L${tip.x - ax * head + ay * head},${tip.y - ay * head - ax * head}`
    );
  }

  function frame(): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(n, size);
      build();
    }
    const clock = performance.now();
    const hint = host.hinted();
    if (tipped && clock > tipped.until) tipped = undefined;
    const m = model();
    const to = centre(geo, n, m.cell);
    shown = shown
      ? { x: shown.x + (to.x - shown.x) * ROLL, y: shown.y + (to.y - shown.y) * ROLL }
      : to;
    if (Math.hypot(to.x - shown.x, to.y - shown.y) < 0.5) shown = to;
    set(bit!, { transform: `translate(${shown.x} ${shown.y})` });
    set(lit!, { d: arrow(to, hint?.a) });
    set(guide!, { d: m.cell === layout.start ? arrow(to, host.guide?.a) : "" });
    if (tipped) root.dataset.tilt = String(tipped.dir);
    else delete root.dataset.tilt;
  }

  function tilt(dir: number): void {
    const m = model();
    const before = m.cell;
    host.move(dir);
    tipped = { dir, until: performance.now() + TILT_MS };
    // Against a wall the bit knocks and settles back.
    if (model().cell === before && shown)
      shown = {
        x: shown.x + ACROSS[dir]! * geo.cell * 0.16,
        y: shown.y + DOWN[dir]! * geo.cell * 0.16,
      };
  }

  const unbind = pointers(host.surface, {
    down(p) {
      anchor = p;
      return true;
    },
    move(p) {
      if (!anchor) return;
      const out = tilts(anchor, p, geo.swipe);
      anchor = out.anchor;
      for (const dir of out.dirs) tilt(dir);
    },
    up() {
      anchor = undefined;
    },
    cancel() {
      anchor = undefined;
    },
  });

  return {
    frame,
    destroy() {
      unbind();
      view.remove();
    },
  };
}

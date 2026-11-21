import "./scene.css";
import { board, glyph, pointers, set, svg, type Point, type Size } from "../../shell/board.ts";
import { HEX_SHAPE, SIDES, hexFit, type HexFit } from "../../shell/grid.ts";
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
  /** A cell's side; on a hex maze, the distance between two neighbours' middles. */
  cell: number;
  origin: Point;
  /** How far a finger travels for one tilt. */
  swipe: number;
  /** The hex maze's cells on their rhombus; none on a square maze. */
  hex?: HexFit;
}

export function geometry(n: number, size: Size, shape = 0): Geometry {
  const pad = 8;
  if (shape === HEX_SHAPE) {
    const hex = hexFit(n, size, pad);
    const cell = hex.r * 2;
    return { cell, origin: { x: 0, y: 0 }, swipe: Math.max(24, Math.min(48, cell * 0.5)), hex };
  }
  const cell = Math.min((size.width - pad * 2) / n, (size.height - pad * 2) / n);
  return {
    cell,
    origin: { x: (size.width - cell * n) / 2, y: (size.height - cell * n) / 2 },
    swipe: Math.max(24, Math.min(48, cell * 0.5)),
  };
}

export function centre(geo: Geometry, n: number, cell: number): Point {
  if (geo.hex) return { ...geo.hex.centres[cell]! };
  return {
    x: geo.origin.x + ((cell % n) + 0.5) * geo.cell,
    y: geo.origin.y + (Math.trunc(cell / n) + 0.5) * geo.cell,
  };
}

/** The way side d of a cell faces on the screen, as a unit step across and down. */
export function heading(geo: Geometry, d: number): Point {
  if (geo.hex) {
    const a = geo.hex.angle(d);
    return { x: Math.cos(a), y: Math.sin(a) };
  }
  return { x: ACROSS[d] ?? 0, y: DOWN[d] ?? 0 };
}

/**
 * The tilts a finger makes travelling from an anchor to a point: one for
 * each swipe's length along the stronger axis. Returns them with the
 * anchor the rest of the drag is measured from. On a hex maze the six
 * ways a cell faces are the axes, and each tilt goes the nearest of them.
 */
export function tilts(
  anchor: Point,
  to: Point,
  swipe: number,
  ways?: Point[],
): { dirs: number[]; anchor: Point } {
  if (ways) return hexTilts(anchor, to, swipe, ways);
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

function hexTilts(
  anchor: Point,
  to: Point,
  swipe: number,
  ways: Point[],
): { dirs: number[]; anchor: Point } {
  const dirs: number[] = [];
  let at = anchor;
  for (;;) {
    const v = { x: to.x - at.x, y: to.y - at.y };
    let best = 0;
    let along = -Infinity;
    for (const [d, u] of ways.entries()) {
      const dot = v.x * u.x + v.y * u.y;
      if (dot > along) [best, along] = [d, dot];
    }
    if (along < swipe) return { dirs, anchor: at };
    dirs.push(best);
    // As on a square maze, the drift across the tilt is forgiven.
    const u = ways[best]!;
    at = { x: to.x - (along - swipe) * u.x, y: to.y - (along - swipe) * u.y };
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
  const shape = layout.shape ?? 0;

  const view = board(
    host,
    shape === HEX_SHAPE
      ? "A hex tumbler maze, seen from above. Swipe any of six ways to tip the box and roll the bit, one cell a swipe, to the marked cell."
      : "A tumbler maze, seen from above. Swipe to tip the box and roll the bit, one cell a swipe, to the marked cell.",
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 }, shape);
  let bit: SVGGElement | undefined;
  let lit: SVGPathElement | undefined;
  let guide: SVGPathElement | undefined;
  let shown: Point | undefined;
  let anchor: Point | undefined;
  let tipped: { dir: number; until: number } | undefined;

  // A hex maze's floor is every cell's hexagon, and a wall the edge of the side it closes.
  function hexWalls(hex: HexFit): { floor: string; walls: string } {
    let floor = "";
    let d = "";
    const R = (hex.r * 2) / Math.sqrt(3);
    for (let c = 0; c < n * n; c++) {
      floor += hex.outline(c);
      const at = hex.centres[c]!;
      const w = walls[c] ?? 0;
      for (let side = 0; side < 6; side++) {
        if ((w & (1 << side)) === 0) continue;
        const a = hex.angle(side);
        const p = (off: number) =>
          `${(at.x + R * Math.cos(a + off)).toFixed(2)},${(at.y + R * Math.sin(a + off)).toFixed(2)}`;
        d += `M${p(-Math.PI / 6)}L${p(Math.PI / 6)}`;
      }
    }
    return { floor, walls: d };
  }

  function build(): void {
    const { cell, origin } = geo;
    let d = "";
    for (let c = 0; geo.hex === undefined && c < n * n; c++) {
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
    const hex = geo.hex && hexWalls(geo.hex);
    if (hex) d = hex.walls;
    root.append(
      hex
        ? svg("path", { class: "floor", d: hex.floor })
        : svg("rect", {
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
    if (dir === undefined || !within(dir, geo.hex ? 6 : SIDES)) return "";
    const len = geo.cell * 0.85;
    const head = geo.cell * 0.2;
    const { x: ax, y: ay } = heading(geo, dir);
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
      geo = geometry(n, size, shape);
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
    if (tipped && geo.hex) {
      // A hex tilt tips the box about the line square to its way.
      const u = heading(geo, tipped.dir);
      root.dataset.tilt = "hex";
      root.style.setProperty("--tilt-x", (-u.y).toFixed(3));
      root.style.setProperty("--tilt-y", u.x.toFixed(3));
    } else if (tipped) root.dataset.tilt = String(tipped.dir);
    else delete root.dataset.tilt;
  }

  function tilt(dir: number): void {
    const m = model();
    const before = m.cell;
    host.move(dir);
    tipped = { dir, until: performance.now() + TILT_MS };
    // Against a wall the bit knocks and settles back.
    if (model().cell === before && shown) {
      const u = heading(geo, dir);
      shown = { x: shown.x + u.x * geo.cell * 0.16, y: shown.y + u.y * geo.cell * 0.16 };
    }
  }

  const unbind = pointers(host.surface, {
    down(p) {
      anchor = p;
      return true;
    },
    move(p) {
      if (!anchor) return;
      const ways = geo.hex ? [0, 1, 2, 3, 4, 5].map((d) => heading(geo, d)) : undefined;
      const out = tilts(anchor, p, geo.swipe, ways);
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

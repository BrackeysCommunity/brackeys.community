import "./scene.css";
import {
  board,
  distance,
  nearest,
  pointers,
  set,
  svg,
  text,
  type Point,
  type Size,
} from "../../shell/board.ts";
import { HEX_SHAPE, hexFit, type HexFit } from "../../shell/grid.ts";
import { GOING, within, type Scene, type SceneHost } from "../../shell/kit.ts";
import { plural } from "../../units.ts";
import { HIDDEN, type ScrubModel } from "./model.ts";

/** How far into a cell, as a share of its side, a finger must be to have moved onto it. */
export const INSET = 0.12;

// The points of the finger's path that are drawn, and the most layers a
// cell is drawn counting down.
const WIPE = 10;
const DOTS = 3;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  /** The grid's top left corner, a cell's side, and the cells a side; on hex cells, the box round the rhombus and a cell's width across its sides. */
  x: number;
  y: number;
  cell: number;
  n: number;
  /** The board's width. */
  width: number;
  /** The hex cells on their rhombus; none on a square grid. */
  hex?: HexFit;
}

export function geometry(n: number, size: Size, shape = 0): Geometry {
  const pad = 8;
  const head = 34;
  const foot = 22;
  if (shape === HEX_SHAPE) {
    const box = { width: size.width, height: size.height - head - foot };
    const hex = hexFit(n, box, pad);
    for (const c of hex.centres) c.y += head;
    const xs = hex.centres.map((c) => c.x);
    const ys = hex.centres.map((c) => c.y);
    const reach = (hex.r * 2) / Math.sqrt(3);
    const x = Math.min(...xs) - reach;
    return {
      x,
      y: Math.min(...ys) - reach,
      cell: hex.r * 2,
      n,
      width: Math.max(...xs) + reach - x,
      hex,
    };
  }
  const side = Math.max(1, Math.min(size.width - pad * 2, size.height - head - foot - pad));
  return {
    x: (size.width - side) / 2,
    y: head + (size.height - head - foot - side) / 2,
    cell: side / n,
    n,
    width: side,
  };
}

/** The middle of a cell. */
export function centre(geo: Geometry, cell: number): Point {
  if (geo.hex) return { ...geo.hex.centres[cell]! };
  return {
    x: geo.x + ((cell % geo.n) + 0.5) * geo.cell,
    y: geo.y + (Math.trunc(cell / geo.n) + 0.5) * geo.cell,
  };
}

/** The cell under a point, if it is on the grid. */
export function cellAt(geo: Geometry, p: Point): number | undefined {
  if (geo.hex) {
    // A hex cell holds every point nearer its middle than any other's.
    const { index, distance: d } = nearest(geo.hex.centres, p);
    return d <= geo.hex.r * 1.1 ? index : undefined;
  }
  const col = Math.floor((p.x - geo.x) / geo.cell);
  const row = Math.floor((p.y - geo.y) / geo.cell);
  if (col < 0 || row < 0 || col >= geo.n || row >= geo.n) return undefined;
  return row * geo.n + col;
}

/**
 * The cell a finger is on, given the one it was on: it has moved to a new
 * cell only once it is a little way in, so a wobble on an edge is not a
 * rub of each side in turn.
 */
export function settle(geo: Geometry, was: number | undefined, p: Point): number | undefined {
  const raw = cellAt(geo, p);
  if (raw === undefined || was === undefined || raw === was) return raw;
  const c = centre(geo, raw);
  const reach = geo.cell * (0.5 - INSET);
  if (geo.hex) return distance(p, c) <= reach ? raw : was;
  return Math.abs(p.x - c.x) <= reach && Math.abs(p.y - c.y) <= reach ? raw : was;
}

// A hexagon filling a c by c box about its middle, turned as the board's cells are.
function hexPane(hex: HexFit, c: number): string {
  const R = c / Math.sqrt(3);
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = hex.angle(k) + Math.PI / 6;
    return `${(c / 2 + R * Math.cos(a)).toFixed(2)},${(c / 2 + R * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join("L")}Z`;
}

interface Drag {
  cell: number | undefined;
  last: Point;
  path: Point[];
}

interface Cell {
  g: SVGGElement;
  dots: SVGCircleElement[];
}

/**
 * The fouled panel: a grid under grit. A finger rubbed over a cell takes
 * a layer off it. A cell down to its last layer shows what it is; the
 * reading's cells are rubbed clean and a cracked one is left alone.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as ScrubModel;
  const n = host.layout.size;
  const cells = n * n;
  const shape = host.layout.shape ?? 0;

  const view = board(
    host,
    shape === HEX_SHAPE
      ? `A fouled panel of hex cells, ${plural(n, "cell")} a side. Rub the grit off the cells that hold the reading. A cell on its last layer shows what it is: one more rub breaks a cracked one.`
      : `A fouled panel, ${plural(n, "cell")} a side. Rub the grit off the cells that hold the reading. A cell on its last layer shows what it is: one more rub breaks a cracked one.`,
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 }, shape);
  let drawn: Cell[] = [];
  let fill: SVGRectElement | undefined;
  let wipe: SVGPolylineElement | undefined;
  let drag: Drag | undefined;
  /** The cracked cells a hint has warned of. */
  const warned = new Set<number>();

  function build(): void {
    const c = geo.cell;
    const side = geo.width;
    // A cell's pane: its square, or on hex cells its hexagon, in a c by c box.
    const pane = (cls: string) =>
      geo.hex
        ? svg("path", { class: cls, d: hexPane(geo.hex, c) })
        : svg("rect", { class: cls, width: c, height: c });
    fill = svg("rect", { class: "fill", x: geo.x + 64, y: 12, width: 0, height: 12 });
    wipe = svg("polyline", { class: "wipe", "stroke-width": c * 0.5 });
    root.append(
      text("label", geo.x, 23, "Reading"),
      svg("rect", { class: "track", x: geo.x + 64, y: 12, width: side - 64, height: 12 }),
      fill,
      text(
        "legend",
        size.width / 2,
        size.height - 8,
        "Rub the reading clean. One more rub breaks a crack.",
      ),
    );
    const m = model();
    drawn = Array.from({ length: cells }, (_, i) => {
      const kind = m.kind(i);
      const mark =
        kind === "reading"
          ? svg("path", {
              class: "what",
              d: `M${c * 0.5},${c * 0.24}L${c * 0.76},${c * 0.5}L${c * 0.5},${c * 0.76}L${c * 0.24},${c * 0.5}Z`,
            })
          : kind === "crack"
            ? svg("path", {
                class: "what",
                d: `M${c * 0.2},${c * 0.2}L${c * 0.45},${c * 0.4}L${c * 0.35},${c * 0.55}L${c * 0.65},${c * 0.6}L${c * 0.8},${c * 0.82}`,
              })
            : svg("path", { class: "what" });
      const dots = Array.from({ length: DOTS }, () =>
        svg("circle", { class: "dot", cy: c * 0.5, r: c * 0.06 }),
      );
      const at = centre(geo, i);
      const g = svg(
        "g",
        { transform: `translate(${at.x - c / 2} ${at.y - c / 2})` },
        pane("glass"),
        mark,
        pane("grit"),
        svg("path", {
          class: "haze",
          d: `M${c * 0.1},${c * 0.5}L${c * 0.5},${c * 0.1}M${c * 0.5},${c * 0.9}L${c * 0.9},${c * 0.5}`,
        }),
        ...dots,
        svg("path", {
          class: "tick",
          d: `M${c * 0.62},${c * 0.82}l${c * 0.08},${c * 0.08}l${c * 0.16},${-c * 0.2}`,
        }),
        svg("path", {
          class: "warn",
          d: `M${c * 0.78},${c * 0.1}v${c * 0.16}m0,${c * 0.07}v${c * 0.02}`,
        }),
        svg("circle", { class: "ring", cx: c * 0.5, cy: c * 0.5, r: c * 0.4 }),
      );
      root.append(g);
      return { g, dots };
    });
    root.append(wipe);
  }

  function frame(): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(n, size, shape);
      build();
    }
    const m = model();
    // A hint that names a cracked cell is a warning, and stays; any other
    // is a cell worth rubbing.
    const lit = host.hinted();
    const crack = lit !== undefined && within(lit.a, cells) && m.kind(lit.a) === "crack";
    if (lit && crack) warned.add(lit.a);
    const hint = crack ? undefined : lit;
    for (const [i, cell] of drawn.entries()) {
      const grit = m.grit[i]!;
      // A cell under two layers or more shows nothing of what it is.
      const shows = grit < HIDDEN ? ` ${m.kind(i)}` : "";
      const cover = grit >= HIDDEN ? "hidden" : grit === 1 ? "hazy" : "clean";
      const ring = hint?.a === i ? " hinted" : host.guide?.a === i && grit > 0 ? " guided" : "";
      set(cell.g, {
        class: `cell ${cover}${shows}${warned.has(i) ? " warned" : ""}${ring}`,
      });
      // The dots count the rubs before the cell shows.
      const rubs = grit - (HIDDEN - 1);
      for (const [k, dot] of cell.dots.entries())
        set(dot, {
          class: k < rubs ? "dot on" : "dot",
          cx: geo.cell * (0.5 + (k - (rubs - 1) / 2) * 0.2),
        });
    }
    const reading = m.cells;
    const clean = reading.filter((c) => m.grit[c] === 0).length;
    const track = geo.width - 64;
    set(fill!, { width: (track * clean) / Math.max(1, reading.length) });
    set(wipe!, { points: (drag?.path ?? []).map((p) => `${p.x},${p.y}`).join(" ") });
  }

  function rub(cell: number): void {
    // A clean cell has nothing left to rub off.
    if (model().grit[cell] === 0) return;
    if (host.move(cell) !== GOING) drag = undefined;
  }

  function reach(p: Point): void {
    if (!drag) return;
    const cell = settle(geo, drag.cell, p);
    if (cell === drag.cell) return;
    drag.cell = cell;
    if (cell !== undefined) rub(cell);
  }

  const unbind = pointers(host.surface, {
    down(p) {
      drag = { cell: undefined, last: p, path: [p] };
      reach(p);
      return true;
    },
    move(p) {
      if (!drag) return;
      // A fast finger skips cells between two events: walk the line.
      const from = drag.last;
      const steps = Math.max(1, Math.ceil(distance(from, p) / (geo.cell / 4)));
      for (let i = 1; i <= steps && drag; i++)
        reach({
          x: from.x + ((p.x - from.x) * i) / steps,
          y: from.y + ((p.y - from.y) * i) / steps,
        });
      if (!drag) return;
      drag.last = p;
      drag.path = [...drag.path, p].slice(-WIPE);
    },
    up() {
      drag = undefined;
    },
    cancel() {
      drag = undefined;
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

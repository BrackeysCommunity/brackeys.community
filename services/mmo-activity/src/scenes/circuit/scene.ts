import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  distance,
  dropped,
  glyph,
  pointers,
  set,
  sizeOf,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import { CORNER, EMPTY, END, STRAIGHT, TEE, type CircuitModel } from "./model.ts";

const HINT_MS = 3000;

// The marks of the board, from the shared glyphs: the source is a bolt,
// the load a ring that fills, a trap a cross.
const BOLT = 11;
const RING = 6;
const DISC = 0;
const CROSS = 4;

/** Where the grid sits, in CSS px of the surface. */
export interface Geometry {
  cell: number;
  origin: Point;
}

export function geometry(n: number, size: Size): Geometry {
  const pad = 8;
  const cell = Math.min((size.width - pad * 2) / n, (size.height - pad * 2) / n);
  return { cell, origin: { x: (size.width - cell * n) / 2, y: (size.height - cell * n) / 2 } };
}

export function centre(geo: Geometry, n: number, cell: number): Point {
  return {
    x: geo.origin.x + ((cell % n) + 0.5) * geo.cell,
    y: geo.origin.y + (Math.trunc(cell / n) + 0.5) * geo.cell,
  };
}

/** The tile under a pointer. */
export function pick(geo: Geometry, n: number, p: Point): number | undefined {
  const x = Math.floor((p.x - geo.origin.x) / geo.cell);
  const y = Math.floor((p.y - geo.origin.y) / geo.cell);
  return x < 0 || y < 0 || x >= n || y >= n ? undefined : y * n + x;
}

// A tile's conduit before it is turned, about its centre, h to an edge.
function conduit(kind: number, h: number): string {
  switch (kind) {
    case STRAIGHT:
      return `M${-h},0H${h}`;
    case CORNER:
      return `M${h},0H0V${h}`;
    case TEE:
      return `M${-h},0H${h}M0,0V${h}`;
    case END:
      return `M0,0H${h}`;
    default:
      return "";
  }
}

interface Tile {
  group: SVGGElement;
  box: SVGRectElement;
  /** Quarter turns drawn, counted up and never back, so a tile always turns one way. */
  spun: number;
}

/**
 * A board of conduit tiles. A tap gives a tile a quarter turn; power
 * runs from the source through every joined conduit, and has to reach
 * the load without lighting a trap.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as CircuitModel;
  const layout = host.layout;
  const n = layout.size;
  const kinds = layout.tiles ?? [];
  const traps = new Set(layout.false ?? []);

  const root = svg("svg", {
    class: "board circuit",
    role: "img",
    "aria-label":
      "A board of conduit tiles. Tap a tile to turn it. Join the bolt to the ring, and keep the power off every cross.",
  });
  host.surface.append(root);

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 });
  let tiles: Tile[] = [];
  let load: SVGPathElement | undefined;
  let fed: SVGPathElement | undefined;
  let lit: SVGCircleElement | undefined;
  let guide: SVGCircleElement | undefined;
  let pressed: number | undefined;
  let hint: { move: PuzzleMove; until: number } | undefined;

  function build(): void {
    root.replaceChildren();
    set(root, {
      viewBox: `0 0 ${size.width} ${size.height}`,
      width: size.width,
      height: size.height,
    });
    const { cell, origin } = geo;
    const h = cell / 2;
    const m = model();
    tiles = [];
    const marks: SVGElement[] = [];
    for (let c = 0; c < n * n; c++) {
      const at = centre(geo, n, c);
      const kind = kinds[c] ?? EMPTY;
      const box = svg("rect", {
        x: origin.x + (c % n) * cell + 2,
        y: origin.y + Math.trunc(c / n) * cell + 2,
        width: cell - 4,
        height: cell - 4,
      });
      const group = svg("g", { class: "tile" });
      const d = conduit(kind, h);
      group.append(
        svg("path", { class: "wire", d, "stroke-width": Math.max(6, cell * 0.16) }),
        svg("path", { class: "flow", d, "stroke-width": Math.max(2, cell * 0.05) }),
      );
      if (kind === END) group.append(svg("circle", { class: "node", r: cell * 0.24 }));
      const spun = m.at[c] ?? 0;
      group.style.transform = `translate(${at.x}px, ${at.y}px) rotate(${spun * 90}deg)`;
      tiles.push({ group, box, spun });
      if (traps.has(c))
        marks.push(
          glyph(
            CROSS,
            { x: at.x - h * 0.55, y: at.y - h * 0.55 },
            Math.max(7, cell * 0.14),
            "var(--hazard)",
          ),
        );
    }
    const source = centre(geo, n, layout.start);
    const goal = centre(geo, n, layout.goal);
    load = glyph(RING, goal, cell * 0.16, "var(--ash)");
    fed = glyph(DISC, goal, cell * 0.16, "var(--signal)");
    lit = svg("circle", { class: "hint", r: h * 0.86 });
    guide = svg("circle", { class: "guide", r: h * 0.86 });
    root.append(
      ...tiles.map((t) => t.box),
      ...tiles.map((t) => t.group),
      glyph(BOLT, source, cell * 0.17, "var(--hazard)"),
      load,
      fed,
      ...marks,
      guide,
      lit,
    );
  }

  function ring(node: SVGCircleElement, cell: number | undefined): void {
    const at = cell === undefined ? undefined : centre(geo, n, cell);
    set(node, { cx: at?.x ?? 0, cy: at?.y ?? 0, opacity: at ? 1 : 0 });
  }

  function frame(): void {
    const now = sizeOf(host.surface);
    if (now.width !== size.width || now.height !== size.height) {
      size = now;
      geo = geometry(n, size);
      build();
    }
    if (hint && performance.now() > hint.until) hint = undefined;
    const m = model();
    const on = m.lit();
    for (const [c, tile] of tiles.entries()) {
      const at = centre(geo, n, c);
      tile.spun += ((((m.at[c] ?? 0) - tile.spun) % 4) + 4) % 4;
      const transform = `translate(${at.x}px, ${at.y}px) rotate(${tile.spun * 90}deg)`;
      if (tile.group.style.transform !== transform) tile.group.style.transform = transform;
      const trap = traps.has(c);
      set(tile.group, { class: `tile${on[c] ? " lit" : ""}${trap && on[c] ? " tripped" : ""}` });
      set(tile.box, {
        class: [
          "cell",
          trap ? "trap" : "",
          trap && on[c] ? "tripped" : "",
          pressed === c ? "pressed" : "",
          kinds[c] === EMPTY ? "bare" : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    }
    set(load!, { opacity: on[layout.goal] ? 0 : 1 });
    set(fed!, { opacity: on[layout.goal] ? 1 : 0 });
    ring(lit!, hint?.move.a);
    const led = host.guide;
    ring(guide!, led && m.at[led.a] === layout.turn?.[led.a] ? led.a : undefined);
  }

  const unbind = pointers(host.surface, {
    down(p) {
      const c = pick(geo, n, p);
      // A bare tile has nothing on it to turn.
      if (c === undefined || (kinds[c] ?? EMPTY) === EMPTY) return false;
      pressed = c;
      return true;
    },
    up(p, ev) {
      const c = pressed;
      pressed = undefined;
      if (c === undefined) return;
      const still = pick(geo, n, p) === c;
      dropped("circuit", distance(p, centre(geo, n, c)), geo.cell / 2, still, ev);
      if (still) host.move(c);
    },
    cancel() {
      pressed = undefined;
    },
  });

  return {
    frame,
    hint(move) {
      hint = { move, until: performance.now() + HINT_MS };
    },
    destroy() {
      unbind();
      root.remove();
    },
  };
}

import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  HIT,
  PICKUP,
  distance,
  dropped,
  glyph,
  glyphName,
  letter,
  nearest,
  pieceColour,
  pointers,
  set,
  sizeOf,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import { plural } from "../../units.ts";
import type { RewireModel } from "./model.ts";

// How long a hint stays lit, and how far a press may wander and still be a tap.
const HINT_MS = 3000;
const TAP_PX = 8;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  r: number;
  /** Where wire w leaves the box. */
  sources: Point[];
  /** Where a plug sits in port p. */
  seats: Point[];
  /** Where port p's mark is drawn. */
  marks: Point[];
}

export function geometry(n: number, size: Size): Geometry {
  const row = size.height / n;
  const r = Math.max(HIT, Math.min(34, row * 0.36, size.width * 0.075));
  const pad = 8;
  const ys = Array.from({ length: n }, (_, i) => row * (i + 0.5));
  return {
    r,
    sources: ys.map((y) => ({ x: pad + r, y })),
    seats: ys.map((y) => ({ x: size.width - pad - r * 3.4, y })),
    marks: ys.map((y) => ({ x: size.width - pad - r, y })),
  };
}

/** The wire whose plug a pointer picks up: the nearest within a thumb's reach. */
export function pick(geo: Geometry, at: number[], p: Point): number | undefined {
  const hit = nearest(
    at.map((port) => geo.seats[port]!),
    p,
  );
  return hit.distance <= geo.r * PICKUP ? hit.index : undefined;
}

/** The port a drop lands in, if it is near one, and how far it missed the nearest. */
export function land(geo: Geometry, p: Point): { port: number | undefined; miss: number } {
  const hit = nearest(geo.seats, p);
  return { port: hit.distance <= geo.r * PICKUP ? hit.index : undefined, miss: hit.distance };
}

interface Drag {
  wire: number;
  from: Point;
  p: Point;
}

/**
 * The junction box: each wire's plug is dragged to the port that carries
 * its mark. A plug can also be tapped, then a port tapped.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as RewireModel;
  const n = host.layout.size;
  const target = host.layout.target ?? [];
  const marks = host.layout.glyph ?? [];
  // The mark a wire carries is the mark of the port it belongs in.
  const wants = (w: number) => marks[target[w] ?? w] ?? w;

  const root = svg("svg", {
    class: "board rewire",
    role: "img",
    "aria-label": `A junction box with ${plural(n, "wire")}. Put each plug in the port that shows its mark.`,
  });
  host.surface.append(root);

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 });
  let cables: SVGPathElement[] = [];
  let plugs: SVGGElement[] = [];
  let rings: SVGCircleElement[] = [];
  let guide: SVGPathElement | undefined;
  let lit: SVGPathElement | undefined;
  let drag: Drag | undefined;
  let chosen: number | undefined;
  let hint: { move: PuzzleMove; until: number } | undefined;

  function build(): void {
    root.replaceChildren();
    set(root, {
      viewBox: `0 0 ${size.width} ${size.height}`,
      width: size.width,
      height: size.height,
    });
    const { r } = geo;
    for (let p = 0; p < n; p++) {
      const colour = pieceColour(marks[p] ?? p);
      const at = geo.marks[p]!;
      root.append(
        svg("rect", {
          class: "port",
          x: at.x - r,
          y: at.y - r,
          width: r * 2,
          height: r * 2,
          stroke: colour,
        }),
        glyph(marks[p] ?? p, at, r * 0.55, colour),
      );
    }
    rings = geo.seats.map((s) => svg("circle", { class: "seat", cx: s.x, cy: s.y, r }));
    root.append(...rings);
    guide = svg("path", { class: "guide" });
    lit = svg("path", { class: "hint" });
    root.append(guide, lit);
    cables = [];
    plugs = [];
    for (let w = 0; w < n; w++) {
      const colour = pieceColour(wants(w));
      const s = geo.sources[w]!;
      root.append(
        svg("rect", {
          class: "source",
          x: s.x - r,
          y: s.y - r * 0.8,
          width: r * 2,
          height: r * 1.6,
          stroke: colour,
        }),
        glyph(wants(w), { x: s.x - r * 0.4, y: s.y }, r * 0.4, colour),
      );
      const tag = svg("text", { class: "tag", x: s.x + r * 0.45, y: s.y, "font-size": r * 0.75 });
      tag.textContent = letter(w);
      root.append(tag);
      cables.push(
        svg("path", { class: "cable", stroke: colour, "stroke-width": Math.max(5, r * 0.3) }),
      );
    }
    root.append(...cables);
    for (let w = 0; w < n; w++) {
      const colour = pieceColour(wants(w));
      const plug = svg(
        "g",
        { class: "plug", "aria-label": `Wire ${letter(w)}, ${glyphName(wants(w))}` },
        svg("circle", { r: r * 0.86, stroke: colour }),
        glyph(wants(w), { x: 0, y: 0 }, r * 0.42, colour),
        svg("path", {
          class: "tick",
          d: `M${-r * 0.2},${r * 0.55}L${0},${r * 0.75}L${r * 0.35},${r * 0.4}`,
        }),
      );
      plugs.push(plug);
    }
    root.append(...plugs);
  }

  function plugAt(w: number): Point {
    return drag?.wire === w ? drag.p : geo.seats[model().at[w]!]!;
  }

  function line(from: Point, to: Point): string {
    const mid = (from.x + to.x) / 2;
    return `M${from.x},${from.y}C${mid},${from.y} ${mid},${to.y} ${to.x},${to.y}`;
  }

  function frame(): void {
    const now = sizeOf(host.surface);
    if (now.width !== size.width || now.height !== size.height) {
      size = now;
      geo = geometry(n, size);
      build();
    }
    const m = model();
    for (let w = 0; w < n; w++) {
      const p = plugAt(w);
      const s = geo.sources[w]!;
      set(cables[w]!, { d: line({ x: s.x + geo.r, y: s.y }, p) });
      const held = drag?.wire === w;
      set(plugs[w]!, {
        transform: `translate(${p.x} ${p.y})`,
        class: `plug${m.seated(w) && !held ? " seated" : ""}${held ? " held" : ""}${chosen === w ? " chosen" : ""}`,
      });
    }
    for (let p = 0; p < n; p++) {
      const w = m.at.indexOf(p);
      set(rings[p]!, { class: w >= 0 && m.seated(w) ? "seat live" : "seat" });
    }
    set(guide!, { d: route(host.guide, drag?.wire) });
    if (hint && performance.now() > hint.until) hint = undefined;
    set(lit!, { d: route(hint?.move, undefined) });
  }

  // The way a move would take a plug, bowed clear of the plugs between;
  // nothing once the move is made, or while its wire is in hand.
  function route(move: PuzzleMove | undefined, held: number | undefined): string {
    const to = move && geo.seats[move.b ?? 0];
    if (!move || !to || model().at[move.a] === undefined) return "";
    if (model().at[move.a] === (move.b ?? 0) || held === move.a) return "";
    const from = plugAt(move.a);
    const out = Math.min(from.x, to.x) - geo.r * 2.6;
    return `M${from.x},${from.y}C${out},${from.y} ${out},${to.y} ${to.x},${to.y}`;
  }

  function plugIn(wire: number, port: number): void {
    if (model().at[wire] !== port) host.move(wire, port);
  }

  const unbind = pointers(host.surface, {
    down(p) {
      if (chosen !== undefined) {
        // A plug was tapped: this tap sends it to a port, or lets it go.
        const { port } = land(geo, p);
        const wire = chosen;
        chosen = undefined;
        if (port !== undefined) plugIn(wire, port);
        return false;
      }
      const wire = pick(geo, model().at, p);
      if (wire === undefined) return false;
      drag = { wire, from: p, p };
      // The plug in hand is drawn over the others.
      root.append(plugs[wire]!);
      return true;
    },
    move(p) {
      if (drag) drag.p = p;
    },
    up(p, ev) {
      if (!drag) return;
      const { wire, from } = drag;
      drag = undefined;
      if (distance(from, p) <= TAP_PX) {
        chosen = wire;
        return;
      }
      const { port, miss } = land(geo, p);
      dropped("rewire", miss, geo.r * PICKUP, port !== undefined, ev);
      if (port !== undefined) plugIn(wire, port);
    },
    cancel() {
      drag = undefined;
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

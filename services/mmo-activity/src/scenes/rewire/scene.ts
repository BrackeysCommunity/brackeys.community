import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  HIT,
  PICKUP,
  angleOf,
  board,
  distance,
  glyph,
  glyphName,
  letter,
  reach,
  pieceColour,
  pointers,
  set,
  svg,
  sweep,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import { plural } from "../../units.ts";
import type { RewireModel } from "./model.ts";

// How far a press may wander and still be a tap.
const TAP_PX = 8;

/** The shape whose wires stand on an inner ring, ports on the outer. */
export const RING_SHAPE = 1;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  r: number;
  /** Where wire w leaves the box. */
  sources: Point[];
  /** Where a plug sits in port p. */
  seats: Point[];
  /** Where port p's mark is drawn. */
  marks: Point[];
  /** Where wire w's cable comes out of its source. */
  leads: Point[];
  /** Half a source's size. */
  sr: number;
  /** The ring panel's centre; none on the straight box. */
  hub?: Point;
}

export function geometry(n: number, size: Size, shape = 0): Geometry {
  if (shape === RING_SHAPE) return ring(n, size);
  const row = size.height / n;
  const r = Math.max(HIT, Math.min(34, row * 0.36, size.width * 0.075));
  const pad = 8;
  const ys = Array.from({ length: n }, (_, i) => row * (i + 0.5));
  return {
    r,
    sources: ys.map((y) => ({ x: pad + r, y })),
    seats: ys.map((y) => ({ x: size.width - pad - r * 3.4, y })),
    marks: ys.map((y) => ({ x: size.width - pad - r, y })),
    leads: ys.map((y) => ({ x: pad + r * 2, y })),
    sr: r,
  };
}

// The ring panel: port p's seat and mark at p's angle round the hub, from
// twelve o'clock clockwise, and wire w's source on the inner ring at w's.
function ring(n: number, size: Size): Geometry {
  const pad = 8;
  const hub = { x: size.width / 2, y: size.height / 2 };
  const room = Math.min(size.width, size.height) / 2 - pad;
  // Seats a ring apart by more than two radii, and a mark outside each.
  const r = Math.max(HIT, Math.min(34, room / (3.1 + 0.37 * n)));
  const outer = room - r;
  const mid = outer - r * 2.1;
  const inner = mid * 0.5;
  const sr = Math.min(r * 0.7, ((Math.PI * inner) / n) * 0.8);
  const at = (i: number, radius: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: hub.x + radius * Math.cos(a), y: hub.y + radius * Math.sin(a) };
  };
  const ids = Array.from({ length: n }, (_, i) => i);
  return {
    r,
    sources: ids.map((i) => at(i, inner)),
    seats: ids.map((i) => at(i, mid)),
    marks: ids.map((i) => at(i, outer)),
    leads: ids.map((i) => at(i, inner + sr)),
    sr,
    hub,
  };
}

/** The wire whose plug a pointer picks up: the nearest within a thumb's reach. */
export function pick(geo: Geometry, at: number[], p: Point): number | undefined {
  return reach(
    at.map((port) => geo.seats[port]!),
    p,
    geo.r,
  ).index;
}

/** The port a drop lands in, if it is near one, and how far it missed the nearest. */
export function land(geo: Geometry, p: Point): { port: number | undefined; miss: number } {
  const { index, miss } = reach(geo.seats, p, geo.r);
  return { port: index, miss };
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
  const shape = host.layout.shape ?? 0;
  const target = host.layout.target ?? [];
  const marks = host.layout.glyph ?? [];
  // The mark a wire carries is the mark of the port it belongs in.
  const wants = (w: number) => marks[target[w] ?? w] ?? w;

  const view = board(
    host,
    shape === RING_SHAPE
      ? `A ring panel with ${plural(n, "wire")} round the middle. Put each plug in the port on the rim that shows its mark.`
      : `A junction box with ${plural(n, "wire")}. Put each plug in the port that shows its mark.`,
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 }, shape);
  let cables: SVGPathElement[] = [];
  let plugs: SVGGElement[] = [];
  let rings: SVGCircleElement[] = [];
  let guide: SVGPathElement | undefined;
  let lit: SVGPathElement | undefined;
  let drag: Drag | undefined;
  let chosen: number | undefined;

  function build(): void {
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
    if (geo.hub)
      root.append(
        svg("circle", {
          class: "rim",
          cx: geo.hub.x,
          cy: geo.hub.y,
          r: distance(geo.hub, geo.seats[0]!),
        }),
      );
    for (let w = 0; w < n; w++) {
      const colour = pieceColour(wants(w));
      const s = geo.sources[w]!;
      if (geo.hub) {
        // On the ring a source is a socket with its mark, and its letter toward the hub.
        const sr = geo.sr;
        const toward = {
          x: (geo.hub.x - s.x) / distance(geo.hub, s),
          y: (geo.hub.y - s.y) / distance(geo.hub, s),
        };
        root.append(
          svg("circle", { class: "source", cx: s.x, cy: s.y, r: sr, stroke: colour }),
          glyph(wants(w), s, sr * 0.5, colour),
        );
        const tag = svg("text", {
          class: "tag",
          x: s.x + toward.x * sr * 1.7,
          y: s.y + toward.y * sr * 1.7,
          "font-size": sr * 0.9,
        });
        tag.textContent = letter(w);
        root.append(tag);
      } else {
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
      }
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
    if (geo.hub) {
      // Out from the source along its spoke, then over to the plug.
      const d = distance(geo.hub, from) || 1;
      const reachOut = geo.r * 1.6;
      const cx = from.x + ((from.x - geo.hub.x) / d) * reachOut;
      const cy = from.y + ((from.y - geo.hub.y) / d) * reachOut;
      return `M${from.x},${from.y}Q${cx},${cy} ${to.x},${to.y}`;
    }
    const mid = (from.x + to.x) / 2;
    return `M${from.x},${from.y}C${mid},${from.y} ${mid},${to.y} ${to.x},${to.y}`;
  }

  function frame(): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(n, size, shape);
      build();
    }
    const m = model();
    for (let w = 0; w < n; w++) {
      const p = plugAt(w);
      set(cables[w]!, { d: line(geo.leads[w]!, p) });
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
    const hint = host.hinted();
    set(lit!, { d: route(hint, undefined) });
  }

  // The way a move would take a plug, bowed clear of the plugs between;
  // nothing once the move is made, or while its wire is in hand.
  function route(move: PuzzleMove | undefined, held: number | undefined): string {
    const to = move && geo.seats[move.b ?? 0];
    if (!move || !to || model().at[move.a] === undefined) return "";
    if (model().at[move.a] === (move.b ?? 0) || held === move.a) return "";
    const from = plugAt(move.a);
    if (geo.hub) {
      // Round the rim, outside the marks, the shorter way.
      const hub = geo.hub;
      const a = angleOf(hub, from);
      const half = a + sweep(a, angleOf(hub, to)) / 2;
      const out = distance(hub, to) + geo.r * 3.6;
      const cx = hub.x + out * Math.cos(half * Math.PI * 2);
      const cy = hub.y + out * Math.sin(half * Math.PI * 2);
      return `M${from.x},${from.y}Q${cx},${cy} ${to.x},${to.y}`;
    }
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
      host.dropped(miss, geo.r * PICKUP, port !== undefined, ev);
      if (port !== undefined) plugIn(wire, port);
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

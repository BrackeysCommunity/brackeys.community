import "./scene.css";
import {
  angleOf,
  board,
  distance,
  glyph,
  glyphName,
  letter,
  pieceColour,
  pointers,
  set,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import type { OverrideModel } from "./model.ts";

// The pause before a round is shown, between showings while the machine
// is at rest, and how long a pressed pad stays lit.
const LEAD_MS = 450;
const REST_MS = 1600;
const PRESS_MS = 180;
// The share of a symbol's slot it is lit for, so a repeat reads as two.
const LIT = 0.65;

/** How long each symbol of a round is shown: longer rounds are shown faster. */
export function pace(round: number): number {
  return Math.max(180, 420 - 20 * (round + 1));
}

/**
 * The symbol on show a while into a round's showing, or nothing between
 * symbols and once it is over.
 */
export function showing(order: number[], round: number, since: number): number | undefined {
  if (since < 0) return undefined;
  const slot = pace(round);
  const i = Math.trunc(since / slot);
  return i <= round && since - i * slot < slot * LIT ? order[i] : undefined;
}

/** The shape whose pads stand in a ring round a round screen. */
export const RING_SHAPE = 1;

type Box = { x: number; y: number; width: number; height: number };

/** The ring pad: a round screen at the hub, the pads as arcs of the ring round it. */
export interface Ring {
  hub: Point;
  /** The screen's radius, where the pads begin. */
  inner: number;
  outer: number;
}

/** Where the screen and the pads sit, in CSS px of the surface. */
export interface Geometry {
  /** The screen; on the ring pad, the box round its circle. */
  screen: Box;
  /** Each pad's box; on the ring pad, a square on the middle of its arc. */
  pads: Box[];
  ring?: Ring;
}

export function geometry(symbols: number, size: Size, shape = 0): Geometry {
  if (shape === RING_SHAPE) return ringPad(symbols, size);
  const pad = 8;
  const gap = 8;
  const screen = {
    x: pad,
    y: pad,
    width: size.width - pad * 2,
    height: Math.max(72, Math.min(130, size.height * 0.24)),
  };
  const cols = Math.ceil(Math.sqrt(symbols));
  const rows = Math.ceil(symbols / cols);
  const top = screen.y + screen.height + gap;
  const width = (size.width - pad * 2 - gap * (cols - 1)) / cols;
  const height = (size.height - pad - top - gap * (rows - 1)) / rows;
  return {
    screen,
    pads: Array.from({ length: symbols }, (_, i) => ({
      x: pad + (i % cols) * (width + gap),
      y: top + Math.trunc(i / cols) * (height + gap),
      width,
      height,
    })),
  };
}

// The ring pad: pad 0's arc is centred at twelve o'clock and the rest
// follow clockwise.
function ringPad(symbols: number, size: Size): Geometry {
  const pad = 8;
  const hub = { x: size.width / 2, y: size.height / 2 };
  const outer = Math.min(size.width, size.height) / 2 - pad;
  const inner = Math.max(48, outer * 0.44);
  const mid = (inner + outer) / 2;
  const side = Math.min(outer - inner, (Math.PI * mid * 2) / symbols) * 0.62;
  return {
    screen: { x: hub.x - inner, y: hub.y - inner, width: inner * 2, height: inner * 2 },
    pads: Array.from({ length: symbols }, (_, i) => {
      const a = (i / symbols) * Math.PI * 2 - Math.PI / 2;
      const c = { x: hub.x + mid * Math.cos(a), y: hub.y + mid * Math.sin(a) };
      return { x: c.x - side / 2, y: c.y - side / 2, width: side, height: side };
    }),
    ring: { hub, inner, outer },
  };
}

/** The outline of pad i's arc on the ring pad, inset by some px. */
export function arc(ring: Ring, symbols: number, i: number, inset = 0): string {
  const gap = 4 + inset;
  const r0 = ring.inner + gap;
  const r1 = ring.outer - inset;
  const half = Math.PI / symbols;
  const centre = (i / symbols) * Math.PI * 2 - Math.PI / 2;
  // Each edge keeps a straight gap of px from the next pad's, at either radius.
  const at = (r: number, side: number) => {
    const a = centre + side * (half - gap / 2 / r);
    return `${(ring.hub.x + r * Math.cos(a)).toFixed(2)},${(ring.hub.y + r * Math.sin(a)).toFixed(2)}`;
  };
  return `M${at(r0, -1)}L${at(r1, -1)}A${r1},${r1} 0 0 1 ${at(r1, 1)}L${at(r0, 1)}A${r0},${r0} 0 0 0 ${at(r0, -1)}Z`;
}

function inside(box: Box, p: Point): boolean {
  return p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height;
}

/** Whether a pointer is on the screen. */
export function onScreen(geo: Geometry, p: Point): boolean {
  return geo.ring ? distance(p, geo.ring.hub) < geo.ring.inner : inside(geo.screen, p);
}

/** The pad under a pointer. */
export function pick(geo: Geometry, p: Point): number | undefined {
  const ring = geo.ring;
  if (ring) {
    const d = distance(p, ring.hub);
    if (d < ring.inner || d > ring.outer) return undefined;
    const n = geo.pads.length;
    return Math.round(((angleOf(ring.hub, p) + 0.25 + 1) % 1) * n) % n;
  }
  const i = geo.pads.findIndex((box) => inside(box, p));
  return i < 0 ? undefined : i;
}

/**
 * A terminal that shows a sequence of symbols, one longer each round, to
 * be pressed back on its pads. A press takes at once, so a hand can drum
 * a round it knows without waiting for the showing; a touch on the
 * screen shows the round again.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as OverrideModel;
  const order = host.layout.order ?? [];
  const rounds = host.layout.size;
  const symbols = Math.max(1, host.layout.range ?? 1);
  const shape = host.layout.shape ?? 0;

  const view = board(
    host,
    shape === RING_SHAPE
      ? "A terminal with a round screen in a ring of pads. Watch the symbols the screen shows, then press the same pads in the same order. Each round adds one."
      : "A terminal with a screen over a set of pads. Watch the symbols the screen shows, then press the same pads in the same order. Each round adds one.",
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(symbols, { width: 1, height: 1 }, shape);
  let pads: SVGGElement[] = [];
  let lamps: SVGGElement[] = [];
  let pips: SVGCircleElement[] = [];
  let ticks: SVGRectElement[] = [];
  let said: SVGTextElement | undefined;
  // The round on show and when its showing began, by this device's clock.
  let show: { round: number; from: number } | undefined;
  let seen = -1;
  let press: { pad: number; until: number } | undefined;

  function build(): void {
    const { screen, ring } = geo;
    const mid = { x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 - 4 };
    const big = Math.min(screen.height * 0.3, 34);
    // In the round screen the word stands centred over the symbol.
    said = ring
      ? svg("text", {
          class: "said",
          x: mid.x,
          y: screen.y + screen.height * 0.22,
          "text-anchor": "middle",
        })
      : svg("text", { class: "said", x: screen.x + 12, y: screen.y + 20 });
    lamps = Array.from({ length: symbols }, (_, s) =>
      svg("g", { class: "lamp" }, glyph(s, mid, big, pieceColour(s))),
    );
    // The round pips sit along the screen's foot; a round screen's foot is its chord.
    const room = ring ? screen.width * 0.72 : screen.width - 24;
    const step = Math.min(16, room / Math.max(1, rounds));
    const foot = ring ? screen.y + screen.height * 0.82 : screen.y + screen.height - 12;
    pips = Array.from({ length: rounds }, (_, r) =>
      svg("circle", {
        class: "pip",
        cx: mid.x + (r - (rounds - 1) / 2) * step,
        cy: foot,
        r: Math.min(5, step * 0.32),
      }),
    );
    ticks = Array.from({ length: rounds }, (_, r) =>
      svg("rect", {
        class: "entered",
        x: mid.x + (r - (rounds - 1) / 2) * step - step * 0.3,
        y: foot - 15,
        width: step * 0.6,
        height: 5,
      }),
    );
    pads = geo.pads.map((box, s) => {
      const colour = pieceColour(s);
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (ring) {
        // The letter stands toward the hub, under the mark.
        const toward = {
          x: (ring.hub.x - at.x) / (distance(ring.hub, at) || 1),
          y: (ring.hub.y - at.y) / (distance(ring.hub, at) || 1),
        };
        const reachIn = (ring.outer - ring.inner) * 0.3;
        const tag = svg("text", {
          class: "tag",
          x: at.x + toward.x * reachIn,
          y: at.y + toward.y * reachIn,
        });
        tag.textContent = letter(s);
        return svg(
          "g",
          { class: "pad", "aria-label": `Pad ${letter(s)}, ${glyphName(s)}` },
          svg("path", { class: "face", d: arc(ring, symbols, s), stroke: colour }),
          glyph(
            s,
            { x: at.x - toward.x * reachIn * 0.3, y: at.y - toward.y * reachIn * 0.3 },
            box.width * 0.3,
            colour,
          ),
          tag,
          svg("path", { class: "ring", d: arc(ring, symbols, s, 7) }),
        );
      }
      const tag = svg("text", { class: "tag", x: box.x + 14, y: box.y + 20 });
      tag.textContent = letter(s);
      return svg(
        "g",
        { class: "pad", "aria-label": `Pad ${letter(s)}, ${glyphName(s)}` },
        svg("rect", { ...box, rx: 8, stroke: colour }),
        glyph(s, at, Math.min(box.width, box.height) * 0.24, colour),
        tag,
        svg("rect", {
          class: "ring",
          x: box.x + 7,
          y: box.y + 7,
          width: box.width - 14,
          height: box.height - 14,
          rx: 5,
        }),
      );
    });
    root.append(
      ring
        ? svg("circle", { class: "screen", cx: ring.hub.x, cy: ring.hub.y, r: ring.inner - 2 })
        : svg("rect", { class: "screen", ...screen }),
      said,
      ...lamps,
      ...ticks,
      ...pips,
      ...pads,
    );
  }

  function frame(): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(symbols, size, shape);
      build();
    }
    const clock = performance.now();
    const hint = host.hinted();
    if (press && clock > press.until) press = undefined;
    const m = model();
    const { round, entered } = m.progress();
    // A new round is shown once; the first is shown over and over until
    // the machine is touched, so there is always something to study.
    if (round !== seen && round < rounds) {
      seen = round;
      show = { round, from: clock + (round ? LEAD_MS : 0) };
    }
    if (show && clock - show.from >= pace(show.round) * (show.round + 1))
      show = m.k === 0 && host.now() === 0 ? { round: 0, from: clock + REST_MS } : undefined;
    const lit = show && show.round === round ? showing(order, round, clock - show.from) : undefined;
    const watching = show !== undefined && clock >= show.from;
    said!.textContent = round >= rounds ? "" : watching ? "Watch" : "Your turn";
    for (const [s, lamp] of lamps.entries()) set(lamp, { class: lit === s ? "lamp on" : "lamp" });
    for (const [s, pad] of pads.entries()) {
      const state = [
        "pad",
        lit === s ? "shown" : "",
        press?.pad === s ? "pressed" : "",
        hint?.a === s ? "hinted" : "",
        host.guide?.a === s && m.k === 0 ? "guided" : "",
      ];
      set(pad, { class: state.filter(Boolean).join(" ") });
    }
    for (const [r, pip] of pips.entries())
      set(pip, { class: r < round ? "pip done" : r === round ? "pip now" : "pip" });
    for (const [i, tick] of ticks.entries())
      set(tick, { class: i < entered ? "entered on" : "entered", opacity: i <= round ? 1 : 0 });
  }

  const unbind = pointers(host.surface, {
    down(p, ev) {
      const pad = pick(geo, p);
      if (pad === undefined) {
        // The screen shows the round again for a hand that lost its place.
        if (onScreen(geo, p)) show = { round: model().progress().round, from: performance.now() };
        return false;
      }
      show = undefined;
      press = { pad, until: performance.now() + PRESS_MS };
      const box = geo.pads[pad]!;
      const off = Math.hypot(p.x - box.x - box.width / 2, p.y - box.y - box.height / 2);
      host.dropped(off, Math.min(box.width, box.height) / 2, true, ev);
      host.move(pad);
      return true;
    },
    cancel() {
      press = undefined;
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

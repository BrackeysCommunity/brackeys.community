import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  dropped,
  glyph,
  glyphName,
  letter,
  pieceColour,
  pointers,
  set,
  sizeOf,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import type { OverrideModel } from "./model.ts";

const HINT_MS = 3000;
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

/** Where the screen and the pads sit, in CSS px of the surface. */
export interface Geometry {
  screen: { x: number; y: number; width: number; height: number };
  pads: { x: number; y: number; width: number; height: number }[];
}

export function geometry(symbols: number, size: Size): Geometry {
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

function inside(box: { x: number; y: number; width: number; height: number }, p: Point): boolean {
  return p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height;
}

/** The pad under a pointer. */
export function pick(geo: Geometry, p: Point): number | undefined {
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

  const root = svg("svg", {
    class: "board override",
    role: "img",
    "aria-label":
      "A terminal with a screen over a set of pads. Watch the symbols the screen shows, then press the same pads in the same order. Each round adds one.",
  });
  host.surface.append(root);

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(symbols, { width: 1, height: 1 });
  let pads: SVGGElement[] = [];
  let lamps: SVGGElement[] = [];
  let pips: SVGCircleElement[] = [];
  let ticks: SVGRectElement[] = [];
  let said: SVGTextElement | undefined;
  // The round on show and when its showing began, by this device's clock.
  let show: { round: number; from: number } | undefined;
  let seen = -1;
  let press: { pad: number; until: number } | undefined;
  let hint: { move: PuzzleMove; until: number } | undefined;

  function build(): void {
    root.replaceChildren();
    set(root, {
      viewBox: `0 0 ${size.width} ${size.height}`,
      width: size.width,
      height: size.height,
    });
    const { screen } = geo;
    const mid = { x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 - 4 };
    const big = Math.min(screen.height * 0.3, 34);
    said = svg("text", { class: "said", x: screen.x + 12, y: screen.y + 20 });
    lamps = Array.from({ length: symbols }, (_, s) =>
      svg("g", { class: "lamp" }, glyph(s, mid, big, pieceColour(s))),
    );
    const step = Math.min(16, (screen.width - 24) / Math.max(1, rounds));
    pips = Array.from({ length: rounds }, (_, r) =>
      svg("circle", {
        class: "pip",
        cx: mid.x + (r - (rounds - 1) / 2) * step,
        cy: screen.y + screen.height - 12,
        r: Math.min(5, step * 0.32),
      }),
    );
    ticks = Array.from({ length: rounds }, (_, r) =>
      svg("rect", {
        class: "entered",
        x: mid.x + (r - (rounds - 1) / 2) * step - step * 0.3,
        y: screen.y + screen.height - 27,
        width: step * 0.6,
        height: 5,
      }),
    );
    pads = geo.pads.map((box, s) => {
      const colour = pieceColour(s);
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
      svg("rect", { class: "screen", ...screen }),
      said,
      ...lamps,
      ...ticks,
      ...pips,
      ...pads,
    );
  }

  function frame(): void {
    const now = sizeOf(host.surface);
    if (now.width !== size.width || now.height !== size.height) {
      size = now;
      geo = geometry(symbols, size);
      build();
    }
    const clock = performance.now();
    if (hint && clock > hint.until) hint = undefined;
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
        hint?.move.a === s ? "hinted" : "",
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
        if (inside(geo.screen, p))
          show = { round: model().progress().round, from: performance.now() };
        return false;
      }
      show = undefined;
      press = { pad, until: performance.now() + PRESS_MS };
      const box = geo.pads[pad]!;
      const off = Math.hypot(p.x - box.x - box.width / 2, p.y - box.y - box.height / 2);
      dropped("override", off, Math.min(box.width, box.height) / 2, true, ev);
      host.move(pad);
      return true;
    },
    cancel() {
      press = undefined;
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

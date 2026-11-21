import "./scene.css";
import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import {
  HIT,
  board,
  glyph,
  pieceColour,
  pointers,
  set,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import type { SignalModel } from "./model.ts";

// Points along each trace, and how often the static on the wanted one changes.
const SAMPLES = 96;
const NOISE_MS = 120;
// A finger travels at least this far for one detent, however short the scale.
const DETENT_PX = 14;
const PIPS = 5;

// What each knob tunes, in the order the layout numbers them.
const KNOBS = ["Pitch", "Shift", "Height", "Ripple"];

/** The shape whose knobs are upright sliders under the scope, slid up and down. */
export const SLIDERS_SHAPE = 1;

/** Where the scope and the knobs sit, in CSS px of the surface. */
export interface Geometry {
  scope: { x: number; y: number; width: number; height: number };
  /** The centre line of each knob's row, and half a row; on the sliders each one's column x, and half a column. */
  rows: number[];
  half: number;
  /** The scale a needle runs along: x across a row, or y up a slider from its foot. */
  from: number;
  to: number;
  r: number;
  /** The finger's travel for one detent. */
  detent: number;
  /** The knobs are sliders: value runs up the screen. */
  upright?: boolean;
}

export function geometry(n: number, range: number, size: Size, shape = 0): Geometry {
  if (shape === SLIDERS_SHAPE) return sliders(n, range, size);
  const pad = 8;
  const row = Math.max(HIT * 2 + 8, Math.min(84, size.height * 0.17));
  const r = Math.min(row / 2 - 4, 30);
  const top = size.height - pad - row * n;
  const from = pad + 76 + r;
  const to = size.width - pad - r;
  return {
    scope: { x: pad, y: pad, width: size.width - pad * 2, height: Math.max(40, top - pad * 2) },
    rows: Array.from({ length: n }, (_, i) => top + row * (i + 0.5)),
    half: row / 2,
    from,
    to,
    r,
    detent: Math.max(DETENT_PX, (to - from) / Math.max(1, range - 1)),
  };
}

// The sliders: the scope over a row of upright tracks, each with its
// mark and name at its foot.
function sliders(n: number, range: number, size: Size): Geometry {
  const pad = 8;
  const scopeH = Math.max(90, size.height * 0.4);
  const lane = Math.min(110, (size.width - pad * 2) / n);
  const r = Math.max(HIT, Math.min(lane / 2 - 6, 30));
  const foot = size.height - pad - 34;
  const from = foot - r;
  const to = scopeH + pad * 2 + r;
  return {
    scope: { x: pad, y: pad, width: size.width - pad * 2, height: scopeH - pad },
    rows: Array.from({ length: n }, (_, i) => size.width / 2 + (i - (n - 1) / 2) * lane),
    half: lane / 2,
    from,
    to,
    r,
    detent: Math.max(DETENT_PX, (from - to) / Math.max(1, range - 1)),
    upright: true,
  };
}

/** The knob whose row (or slider's column) a pointer is in. */
export function pick(geo: Geometry, p: Point): number | undefined {
  const i = geo.rows.findIndex((c) => Math.abs((geo.upright ? p.x : p.y) - c) <= geo.half);
  if (i < 0) return undefined;
  // A slider is held along its track, not on the scope over it.
  if (geo.upright && (p.y < geo.to - geo.r * 1.5 || p.y > geo.from + geo.r * 1.5)) return undefined;
  return i;
}

/** How far along the scale a finger is: rightward on a row, upward on a slider. */
export function along(geo: Geometry, p: Point): number {
  return geo.upright ? -p.y : p.x;
}

/** Where a knob at a value stands on the surface. */
export function knobAt(geo: Geometry, range: number, knob: number, value: number): Point {
  const t = geo.from + ((geo.to - geo.from) * value) / Math.max(1, range - 1);
  return geo.upright ? { x: geo.rows[knob]!, y: t } : { x: t, y: geo.rows[knob]! };
}

/** The value a knob reaches when the finger has slid dx from where it took hold. */
export function slide(geo: Geometry, range: number, from: number, dx: number): number {
  return Math.max(0, Math.min(range - 1, from + Math.round(dx / geo.detent)));
}

/**
 * The trace a set of knob values draws, at x from 0 to 1, between -1 and
 * 1. A knob the machine does not have sits at its plain setting. Every
 * value of every knob gives a different trace.
 */
export function wave(values: number[], range: number, x: number): number {
  const top = Math.max(1, range - 1);
  const pitch = 1 + (values[0] ?? 0) * 0.25;
  const shift = ((values[1] ?? 0) / range) * Math.PI * 2;
  const height = values[2] === undefined ? 1 : 0.3 + (0.7 * values[2]) / top;
  const ripple = values[3] === undefined ? 0 : (0.6 * values[3]) / top;
  const turn = x * Math.PI * 2 * pitch;
  return (height * (Math.sin(turn + shift) + ripple * Math.sin(turn * 3))) / (1 + ripple);
}

/** How near the knobs' trace is to the wanted one, as lit pips. */
export function closeness(layout: PuzzleLayout, knobs: number[]): number {
  const range = layout.range ?? 1;
  let off = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const x = i / (SAMPLES - 1);
    off += Math.abs(wave(layout.target ?? [], range, x) - wave(knobs, range, x));
  }
  const near = 1 - Math.min(1, off / SAMPLES / 0.7);
  return knobs.every((v, i) => v === layout.target?.[i]) ? PIPS : Math.floor(near * (PIPS - 1));
}

// Static on the wanted trace, the same for the same point and moment.
function hiss(i: number, beat: number): number {
  const x = Math.sin(i * 12.9898 + beat * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

interface Hold {
  knob: number;
  x: number;
  from: number;
}

interface Row {
  group: SVGGElement;
  needle: SVGGElement;
  hint: SVGPathElement;
  guide: SVGPathElement;
}

/**
 * A relay's scope over a bank of tuning knobs. Each knob is rolled
 * sideways, a detent at a time, and bends the solid trace; the machine
 * locks on when it lies over the dashed one.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as SignalModel;
  const layout = host.layout;
  const n = layout.size;
  const range = layout.range ?? 1;
  const noise = Math.min(layout.decoys, 6) * 0.03;
  const shape = layout.shape ?? 0;

  const view = board(
    host,
    shape === SLIDERS_SHAPE
      ? "A scope over a row of sliders. Slide each one up or down until the solid trace lies over the dashed one."
      : "A scope over a bank of tuning knobs. Slide each knob sideways until the solid trace lies over the dashed one.",
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, range, { width: 1, height: 1 }, shape);
  let rows: Row[] = [];
  let wanted: SVGPathElement | undefined;
  let yours: SVGPathElement | undefined;
  let pips: SVGRectElement[] = [];
  let note: SVGTextElement | undefined;
  let hold: Hold | undefined;
  let touched = false;

  const at = (knob: number, value: number) => knobAt(geo, range, knob, value);

  function build(): void {
    const { scope, r } = geo;
    wanted = svg("path", { class: "wanted" });
    yours = svg("path", { class: "yours" });
    const key = (label: string, x: number, cls: string) => {
      const text = svg("text", { class: "key", x: x + 34, y: scope.y + 16 });
      text.textContent = label;
      return [svg("path", { class: cls, d: `M${x},${scope.y + 16}h28` }), text];
    };
    pips = Array.from({ length: PIPS }, (_, i) =>
      svg("rect", {
        class: "pip",
        x: scope.x + scope.width - 14 - (PIPS - i) * 14,
        y: scope.y + 9,
        width: 10,
        height: 14,
      }),
    );
    note = svg("text", {
      class: "note",
      x: scope.x + scope.width / 2,
      y: scope.y + scope.height - 10,
    });
    root.append(
      svg("rect", { class: "screen", ...scope }),
      svg("path", {
        class: "axis",
        d: `M${scope.x},${scope.y + scope.height / 2}h${scope.width}`,
      }),
      wanted,
      yours,
      ...key("Wanted", scope.x + 10, "wanted"),
      ...key("Yours", scope.x + 118, "yours"),
      ...pips,
      note,
    );
    rows = geo.rows.map((y, i) => {
      const colour = pieceColour(i);
      const up = geo.upright;
      let ticks = "";
      for (let v = 0; v < range; v++) {
        const tall = v % 6 === 0 ? 9 : 5;
        const t = at(i, v);
        ticks += up ? `M${t.x - r - 1},${t.y}h${-tall}` : `M${t.x},${y - r - 1}v${-tall}`;
      }
      const label = up
        ? svg("text", { class: "label", x: y + 8, y: geo.from + r + 22, "text-anchor": "middle" })
        : svg("text", { class: "label", x: 34, y: y + 5 });
      label.textContent = KNOBS[i] ?? "Knob";
      const foot = at(i, 0);
      const head = at(i, range - 1);
      const mark = (cls: string) => svg("path", { class: cls });
      const row: Row = {
        hint: mark("hint"),
        guide: mark("guide"),
        needle: up
          ? svg(
              "g",
              { class: "needle" },
              svg("rect", {
                x: -r,
                y: -r * 0.6,
                width: r * 2,
                height: r * 1.2,
                rx: r * 0.25,
                stroke: colour,
              }),
              svg("path", {
                class: "ridges",
                d: `M${-r * 0.5},${-r * 0.3}h${r}M${-r * 0.6},0h${r * 1.2}M${-r * 0.5},${r * 0.3}h${r}`,
              }),
            )
          : svg(
              "g",
              { class: "needle" },
              svg("circle", { r, stroke: colour }),
              svg("path", {
                class: "ridges",
                d: `M${-r * 0.4},${-r * 0.5}v${r}M0,${-r * 0.6}v${r * 1.2}M${r * 0.4},${-r * 0.5}v${r}`,
              }),
            ),
        group: svg("g", { class: "knob", "aria-label": `${KNOBS[i] ?? "Knob"} knob` }),
      };
      row.group.append(
        glyph(i, up ? { x: y - 22, y: geo.from + r + 22 } : { x: 18, y }, 9, colour),
        label,
        svg("path", { class: "scale", d: `M${foot.x},${foot.y}L${head.x},${head.y}` }),
        svg("path", { class: "ticks", d: ticks }),
        row.guide,
        row.hint,
        row.needle,
      );
      return row;
    });
    root.append(...rows.map((row) => row.group));
  }

  function trace(values: number[], beat: number | undefined): string {
    const { scope } = geo;
    const mid = scope.y + scope.height / 2;
    const reach = scope.height / 2 - 30;
    let d = "";
    for (let i = 0; i < SAMPLES; i++) {
      const x = i / (SAMPLES - 1);
      const y = wave(values, range, x) + (beat === undefined ? 0 : hiss(i, beat) * noise);
      d += `${i ? "L" : "M"}${(scope.x + x * scope.width).toFixed(1)},${(mid - y * reach).toFixed(1)}`;
    }
    return d;
  }

  // A mark on a knob's scale at a value: where a hint or the guide says to leave it.
  function mark(node: SVGPathElement, knob: number, move: PuzzleMove | undefined): void {
    const { x, y } = at(knob, move?.b ?? 0);
    const r = geo.r;
    const d = geo.upright ? `M${x - r - 2},${y}l-12,-7v14Z` : `M${x},${y - r - 2}l-7,-12h14Z`;
    set(node, { d: move?.a === knob ? d : "" });
  }

  function frame(): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(n, range, size, shape);
      build();
    }
    const clock = performance.now();
    const hint = host.hinted();
    const m = model();
    set(wanted!, {
      d: trace(layout.target ?? [], noise ? Math.floor(clock / NOISE_MS) : undefined),
    });
    set(yours!, { d: trace(m.knobs, undefined) });
    const near = closeness(layout, m.knobs);
    for (const [i, pip] of pips.entries()) set(pip, { class: i < near ? "pip on" : "pip" });
    // Knobs that already sit on their values lock nothing until one is moved.
    note!.textContent = !touched && m.matched() ? "Nudge a knob and bring it back to lock on" : "";
    for (const [i, row] of rows.entries()) {
      const p = at(i, m.knobs[i] ?? 0);
      set(row.needle, { transform: `translate(${p.x} ${p.y})` });
      set(row.group, { class: hold?.knob === i ? "knob held" : "knob" });
      mark(row.hint, i, hint);
      mark(row.guide, i, host.guide && m.knobs[i] !== host.guide.b ? host.guide : undefined);
    }
  }

  const unbind = pointers(host.surface, {
    down(p) {
      const knob = pick(geo, p);
      if (knob === undefined) return false;
      hold = { knob, x: along(geo, p), from: model().knobs[knob] ?? 0 };
      return true;
    },
    move(p) {
      if (!hold) return;
      const value = slide(geo, range, hold.from, along(geo, p) - hold.x);
      if (value === model().knobs[hold.knob]) return;
      touched = true;
      host.move(hold.knob, value);
    },
    up() {
      hold = undefined;
    },
    cancel() {
      hold = undefined;
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

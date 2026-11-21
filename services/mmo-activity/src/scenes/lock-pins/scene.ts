import "./scene.css";
import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import {
  HIT,
  dropped,
  letter,
  pointers,
  set,
  sizeOf,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import type { PinsModel } from "./model.ts";

/** The heights a pin can be left at. */
export const HEIGHTS = 4;

// How long a hint stays lit, and how long the lock shudders when the pins drop.
const HINT_MS = 3000;
const SLIP_MS = 350;

// A pin's column, in heights: the room over the line for a pin lifted too
// far, and the key pin's reach under it.
const ABOVE = 4.4;
const BELOW = 4.2;
const TELL = 18;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  /** Half a column: how far to the side a pin is still picked up. */
  r: number;
  /** The travel of one height. */
  notch: number;
  grip: number;
  /** One column per slot, left to right, row by row. */
  cols: Column[];
}

export interface Column {
  x: number;
  top: number;
  /** The shear line. */
  line: number;
  /** Where the pin's grip rests. */
  rest: number;
  bottom: number;
}

export function geometry(pins: number, size: Size): Geometry {
  const pad = 8;
  const fit = Math.max(1, Math.floor((size.width - pad * 2) / (HIT * 2)));
  const rows = Math.max(1, Math.ceil(pins / fit));
  const perRow = Math.ceil(pins / rows);
  const w = Math.min(84, (size.width - pad * 2) / perRow);
  const rowH = size.height / rows;
  const grip = Math.min(w / 2 - 3, 26);
  const notch = Math.max(10, Math.min(34, (rowH - TELL - grip * 2 - 14) / (ABOVE + BELOW + 0.3)));
  const cols: Column[] = [];
  for (let s = 0; s < pins; s++) {
    const row = Math.trunc(s / perRow);
    const inRow = Math.min(perRow, pins - row * perRow);
    const top = row * rowH + TELL;
    const line = top + ABOVE * notch;
    cols.push({
      x: size.width / 2 + ((s % perRow) - (inRow - 1) / 2) * w,
      top,
      line,
      rest: line + (BELOW + 0.3) * notch + grip + 4,
      bottom: (row + 1) * rowH,
    });
  }
  return { r: w / 2, notch, grip, cols };
}

function seed(layout: PuzzleLayout): number {
  const order = layout.order ?? [];
  return (layout.target ?? []).reduce((sum, t, i) => sum + t * (i + 1) + (order[i] ?? 0), 0);
}

/**
 * The slot each pin is drawn in. The false pins come last in the layout;
 * on the lock they are shuffled in among the others, the same way every
 * time the same lock is drawn.
 */
export function slots(layout: PuzzleLayout): number[] {
  const pins = layout.size + (layout.false?.length ?? 0);
  const out = Array.from({ length: pins }, (_, i) => i);
  let x = seed(layout) + 1;
  for (let i = pins - 1; i > 0; i--) {
    x = (x * 48271) % 2147483647;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * How far under the line a pin's cut rests, in heights. A false pin has a
 * cut like any other, which no lift will ever make hold.
 */
export function cuts(layout: PuzzleLayout): number[] {
  const target = layout.target ?? [];
  const pins = layout.size + (layout.false?.length ?? 0);
  return Array.from(
    { length: pins },
    (_, pin) => target[pin] ?? 1 + ((pin * 3 + seed(layout)) % HEIGHTS),
  );
}

/** The slot a pointer picks up: the column it is in. */
export function pick(geo: Geometry, p: Point): number | undefined {
  const s = geo.cols.findIndex(
    (c) => Math.abs(p.x - c.x) <= geo.r && p.y >= c.top - TELL && p.y < c.bottom,
  );
  return s < 0 ? undefined : s;
}

/** The height a lift of some px leaves a pin at; 0 puts it back down. */
export function heightOf(geo: Geometry, lift: number): number {
  return Math.max(0, Math.min(HEIGHTS, Math.round(lift / geo.notch)));
}

interface Lift {
  slot: number;
  from: number;
  px: number;
}

interface Pin {
  group: SVGGElement;
  spring: SVGPathElement;
  driver: SVGRectElement;
  key: SVGRectElement;
  cut: SVGPathElement;
  stem: SVGRectElement;
  grip: SVGGElement;
  glow: SVGLineElement;
}

/**
 * The lock, seen from the side: each pin is lifted by its grip until its
 * cut meets the line, and let go there. A pin held in the hand says
 * whether it binds; only the binding pin will hold.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as PinsModel;
  const layout = host.layout;
  const total = layout.size + (layout.false?.length ?? 0);
  const slotOf = slots(layout);
  const pinAt = slotOf.reduce<number[]>((at, slot, pin) => ((at[slot] = pin), at), []);
  const cut = cuts(layout);

  const root = svg("svg", {
    class: "board lock-pins",
    role: "img",
    "aria-label":
      "A pin lock, seen from the side. Hold a pin to feel whether it binds, lift the binding pin until its cut meets the line, and let go.",
  });
  host.surface.append(root);

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(total, { width: 1, height: 1 });
  let pins: Pin[] = [];
  let tell: SVGTextElement | undefined;
  let lift: Lift | undefined;
  let hint: { move: PuzzleMove; until: number } | undefined;
  let slipUntil = 0;

  function build(): void {
    root.replaceChildren();
    set(root, {
      viewBox: `0 0 ${size.width} ${size.height}`,
      width: size.width,
      height: size.height,
    });
    const { notch, grip, r } = geo;
    const w = Math.min(r * 2 - 14, notch * 1.9);
    const lines = new Map<number, { from: number; to: number }>();
    pins = geo.cols.map((c, slot) => {
      const row = lines.get(c.line) ?? { from: c.x - r, to: c.x + r };
      lines.set(c.line, { from: Math.min(row.from, c.x - r), to: Math.max(row.to, c.x + r) });
      const pin: Pin = {
        spring: svg("path", { class: "spring" }),
        driver: svg("rect", { class: "driver", x: c.x - w / 2, width: w }),
        key: svg("rect", { class: "key", x: c.x - w / 2, width: w }),
        cut: svg("path", { class: "cut" }),
        stem: svg("rect", { class: "stem", x: c.x - 3, width: 6 }),
        grip: svg("g", { class: "grip" }, svg("circle", { r: grip })),
        glow: svg("line", {
          class: "glow",
          x1: c.x - r + 3,
          x2: c.x + r - 3,
          y1: c.line,
          y2: c.line,
        }),
        group: svg("g", { class: "pin", "aria-label": `Pin ${letter(slot)}` }),
      };
      const tag = svg("text", { class: "tag", "font-size": grip * 0.9 });
      tag.textContent = letter(slot);
      pin.grip.append(
        tag,
        svg("path", {
          class: "tick",
          d: `M${-grip * 0.35},${grip * 0.5}L${-grip * 0.05},${grip * 0.78}L${grip * 0.45},${grip * 0.3}`,
        }),
        svg("path", {
          class: "lead",
          d: `M${-grip * 0.5},${grip * 1.45}L0,${grip * 1.15}L${grip * 0.5},${grip * 1.45}`,
        }),
      );
      pin.group.append(
        svg("rect", {
          class: "chamber",
          x: c.x - w / 2 - 4,
          y: c.top,
          width: w + 8,
          height: (ABOVE + BELOW + 0.3) * notch,
        }),
        pin.spring,
        pin.driver,
        pin.key,
        pin.cut,
        pin.stem,
        pin.grip,
        pin.glow,
      );
      return pin;
    });
    root.append(...pins.map((p) => p.group));
    for (const [y, row] of lines)
      root.append(svg("line", { class: "line", x1: row.from, x2: row.to, y1: y, y2: y }));
    tell = svg("text", { class: "tell" });
    root.append(tell);
  }

  // The px a pin stands lifted: in the hand, held at the line, or at rest.
  function lifted(slot: number): number {
    if (lift?.slot === slot) return lift.px;
    return model().set(pinAt[slot]!) ? cut[pinAt[slot]!]! * geo.notch : 0;
  }

  function frame(): void {
    const now = sizeOf(host.surface);
    if (now.width !== size.width || now.height !== size.height) {
      size = now;
      geo = geometry(total, size);
      build();
    }
    const clock = performance.now();
    if (hint && clock > hint.until) hint = undefined;
    const m = model();
    const { notch, grip, r } = geo;
    const w = Math.min(r * 2 - 14, notch * 1.9);
    for (const [slot, pin] of pins.entries()) {
      const c = geo.cols[slot]!;
      const id = pinAt[slot]!;
      const up = lifted(slot);
      const held = lift?.slot === slot;
      const seated = m.set(id);
      // The cut is where the key pin ends and the driver begins.
      const top = c.line + cut[id]! * notch - up;
      const foot = c.line + (BELOW + 0.3) * notch - up;
      // Every stack is the same height at rest, so a deeper cut has a
      // longer driver over it; lifted far enough, the driver runs into
      // the top of its chamber.
      const driver = Math.max(c.top + 0.3 * notch, top - (cut[id]! + 1) * notch);
      set(pin.driver, { y: driver, height: top - driver });
      set(pin.key, { y: top, height: foot - top });
      set(pin.cut, {
        d: `M${c.x - w / 2 - 7},${top - 4}L${c.x - w / 2 - 1},${top}L${c.x - w / 2 - 7},${top + 4}ZM${c.x + w / 2 + 7},${top - 4}L${c.x + w / 2 + 1},${top}L${c.x + w / 2 + 7},${top + 4}Z`,
      });
      set(pin.spring, { d: coil(c.x, c.top + 2, driver, w * 0.3) });
      set(pin.stem, { y: foot, height: Math.max(0, c.rest - up - grip - foot) });
      set(pin.grip, { transform: `translate(${c.x} ${c.rest - up})` });
      const level = Math.abs(top - c.line) < notch / 2;
      const state = [
        "pin",
        seated ? "set" : "",
        held ? (m.binding() === id ? "held binds" : "held loose") : "",
        held && level ? "level" : "",
        hint?.move.a === id ? "hinted" : "",
        host.guide?.a === id && m.k === 0 && !held ? "guided" : "",
      ];
      set(pin.group, { class: state.filter(Boolean).join(" ") });
    }
    const held = lift && geo.cols[lift.slot];
    tell!.textContent = held ? (m.binding() === pinAt[lift!.slot] ? "Binds" : "Loose") : "";
    if (held) set(tell!, { x: held.x, y: held.top - 5 });
    set(root, { class: `board lock-pins${clock < slipUntil ? " slip" : ""}` });
  }

  function coil(x: number, from: number, to: number, half: number): string {
    const turns = 5;
    let d = `M${x},${from}`;
    for (let i = 1; i <= turns; i++)
      d += `L${x + (i % 2 ? half : -half)},${from + ((to - from) * (i - 0.5)) / turns}`;
    return `${d}L${x},${to}`;
  }

  const unbind = pointers(host.surface, {
    down(p) {
      const slot = pick(geo, p);
      if (slot === undefined || model().set(pinAt[slot]!)) return false;
      lift = { slot, from: p.y, px: 0 };
      return true;
    },
    move(p) {
      if (lift) lift.px = Math.max(0, Math.min(HEIGHTS * geo.notch, lift.from - p.y));
    },
    up(_p, ev) {
      if (!lift) return;
      const { slot, px } = lift;
      lift = undefined;
      const height = heightOf(geo, px);
      if (height === 0) return;
      const pin = pinAt[slot]!;
      const before = model().k;
      const off = Math.abs(px - cut[pin]! * geo.notch);
      host.move(pin, height);
      const held = model().k > before;
      dropped("lock-pins", off, geo.notch / 2, held, ev);
      if (!held) slipUntil = performance.now() + SLIP_MS;
    },
    cancel() {
      lift = undefined;
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

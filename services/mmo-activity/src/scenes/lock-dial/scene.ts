import "./scene.css";
import {
  HIT,
  board,
  distance,
  letter,
  nearest,
  pointers,
  set,
  svg,
  turning,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import type { DialModel } from "./model.ts";

// How long a click's ring spreads and a dropped lock shudders.
const PULSE_MS = 450;
const SLIP_MS = 350;
// Nearer the hub than this share of the radius, a finger's angle means nothing.
const HUB = 0.2;

/** The shape whose dials are concentric rings about one hub, the first outermost. */
export const RINGS_SHAPE = 1;

// On the rings the hub holds the word and the pulse; a finger there means nothing.
const RINGS_HUB = 0.14;

export interface Band {
  inner: number;
  outer: number;
}

/** Where the dials sit, in CSS px of the surface. */
export interface Geometry {
  r: number;
  /** Each dial's centre; on the rings every one is the hub. */
  dials: Point[];
  /** Each ring's inner and outer radius; none for a row of dials. */
  bands?: Band[];
}

/** How far from its centre a dial is best taken hold of. */
export function holdAt(geo: Geometry, d: number): number {
  const b = geo.bands?.[d];
  return b ? (b.inner + b.outer) / 2 : geo.r * 0.8;
}

/** The radius a finger's angle means nothing within. */
export function deadOf(geo: Geometry): number {
  return geo.r * (geo.bands ? RINGS_HUB : HUB);
}

export function geometry(n: number, size: Size, shape = 0): Geometry {
  if (shape === RINGS_SHAPE) return rings(n, size);
  let best = { r: 0, cols: 1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const r = Math.min(size.width / cols, size.height / rows) / 2 - 14;
    if (r > best.r) best = { r, cols };
  }
  const { cols } = best;
  const rows = Math.ceil(n / cols);
  const cell = { width: size.width / cols, height: size.height / rows };
  return {
    r: Math.max(HIT * 2, Math.min(best.r, 150)),
    dials: Array.from({ length: n }, (_, i) => {
      const row = Math.trunc(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      return {
        x: size.width / 2 + ((i % cols) - (inRow - 1) / 2) * cell.width,
        y: cell.height * (row + 0.5),
      };
    }),
  };
}

// Concentric rings: the outermost is dial 0, and each ring inward is the next.
function rings(n: number, size: Size): Geometry {
  const r = Math.max(HIT * 2, Math.min(size.width, size.height) / 2 - 14);
  const hub = r * RINGS_HUB;
  const w = (r - hub) / n;
  const hubPoint = { x: size.width / 2, y: size.height / 2 };
  return {
    r,
    dials: Array.from({ length: n }, () => hubPoint),
    bands: Array.from({ length: n }, (_, d) => ({ inner: r - w * (d + 1), outer: r - w * d })),
  };
}

/** The dial a pointer takes hold of. */
export function pick(geo: Geometry, p: Point): number | undefined {
  if (geo.bands) {
    const d = distance(geo.dials[0]!, p);
    if (d > geo.r + 10) return undefined;
    const i = geo.bands.findIndex(
      (b) => d >= b.inner && d <= b.outer + (b === geo.bands![0] ? 10 : 0),
    );
    return i < 0 ? undefined : i;
  }
  const hit = nearest(geo.dials, p);
  return hit.distance <= geo.r + 10 ? hit.index : undefined;
}

// A needle leaves its detent only once it is this far toward the next, so
// a shaky hand on the halfway mark does not rattle between two.
const LATCH = 0.65;

/** The detent a needle sits in after it was turned to pos, given the one it sat in. */
export function settle(detent: number, pos: number): number {
  while (pos - detent > LATCH) detent++;
  while (detent - pos > LATCH) detent--;
  return detent;
}

interface Hold {
  dial: number;
  /** The way the last detent was crossed: 1 clockwise, -1 the other way, 0 none yet. */
  way: number;
}

interface Dial {
  group: SVGGElement;
  knob: SVGGElement;
  said: SVGTextElement;
  pulse: SVGCircleElement;
  hint: SVGPathElement;
  guide: SVGCircleElement;
}

/**
 * Safe dials. A dial is turned by dragging round it and left where the
 * finger lifts. The dial in turn gives a click, a ring and a buzz where
 * the browser has one, as its needle comes onto its number the way its
 * arrow points; turned the other way it gives nothing.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as DialModel;
  const n = host.layout.size;
  const range = host.layout.range ?? 1;
  const turn = host.layout.turn ?? [];
  const shape = host.layout.shape ?? 0;

  const view = board(
    host,
    shape === RINGS_SHAPE
      ? "Safe rings, one inside another. Drag round the marked ring the way its arrow points until it clicks, and let go on the click."
      : "Safe dials. Drag round the marked dial the way its arrow points until it clicks, and let go on the click.",
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 }, shape);
  let dials: Dial[] = [];
  // Where each needle stands, in detents turned since the scene opened:
  // the detent it sits in, and where the hand has it between detents.
  const turned = Array.from({ length: n }, () => 0);
  const pos = Array.from({ length: n }, () => 0);
  let hold: Hold | undefined;
  let finger = turning(deadOf(geo));
  let caught = false;
  let pulseAt = -PULSE_MS;
  let slipUntil = 0;

  const number = (d: number) => ((turned[d]! % range) + range) % range;
  const spot = (value: number, at: number): Point => {
    const a = (value / range) * Math.PI * 2;
    return { x: Math.sin(a) * at, y: -Math.cos(a) * at };
  };

  function build(): void {
    const { r } = geo;
    dials = geo.dials.map((c, d) => {
      let ticks = "";
      for (let v = 0; v < range; v++) {
        const from = spot(v, r * (v % 10 === 0 ? 0.76 : v % 5 === 0 ? 0.82 : 0.88));
        const to = spot(v, r * 0.96);
        ticks += `M${from.x},${from.y}L${to.x},${to.y}`;
      }
      const zero = spot(0, r * 0.7);
      // The way to turn, engraved over the hub: an arc with a head.
      const way = turn[d] === -1 ? -1 : 1;
      const arc = r * 0.4;
      const sweep = range * 0.3;
      const from = spot(-way * sweep, arc);
      const to = spot(way * sweep, arc);
      // The head's two barbs trail back from the tip, either side of the arc.
      const barb = (out: number) => spot(way * (sweep - range * 0.07), arc + out);
      const [inner, outer] = [barb(-r * 0.12), barb(r * 0.12)];
      const dial: Dial = {
        knob: svg(
          "g",
          { class: "knob" },
          svg("circle", { r: r * 0.62 }),
          svg("path", { class: "needle", d: `M0,${-r * 0.5}L0,${-r * 0.7}` }),
          svg("path", {
            class: "point",
            d: `M0,${-r * 0.74}L${-r * 0.07},${-r * 0.6}L${r * 0.07},${-r * 0.6}Z`,
          }),
        ),
        said: svg("text", { class: "said", y: -r * 0.2, "font-size": Math.max(12, r * 0.16) }),
        pulse: svg("circle", { class: "pulse", r: r * 0.2 }),
        hint: svg("path", { class: "hint" }),
        guide: svg("circle", { class: "guide", r: Math.max(3, r * 0.045) }),
        group: svg("g", {
          class: "dial",
          transform: `translate(${c.x} ${c.y})`,
          "aria-label": `Dial ${letter(d)}, turned ${way === 1 ? "right" : "left"}`,
        }),
      };
      const tag = svg("text", { class: "tag", y: r * 0.22, "font-size": Math.max(13, r * 0.2) });
      tag.textContent = letter(d);
      dial.group.append(
        svg("circle", { class: "rim", r }),
        svg("path", { class: "ticks", d: ticks }),
        svg("circle", { class: "zero", cx: zero.x, cy: zero.y, r: Math.max(2, r * 0.03) }),
        dial.guide,
        dial.hint,
        dial.knob,
        svg("path", {
          class: "way",
          d: `M${from.x},${from.y}A${arc},${arc} 0 1 ${way === 1 ? 1 : 0} ${to.x},${to.y}M${inner.x},${inner.y}L${to.x},${to.y}L${outer.x},${outer.y}`,
        }),
        svg("circle", { class: "lamp", r: r * 0.085 }),
        svg("path", {
          class: "tick",
          d: `M${-r * 0.16},${r * 0.2}L${-r * 0.03},${r * 0.33}L${r * 0.2},${r * 0.08}`,
        }),
        tag,
        dial.said,
        dial.pulse,
      );
      return dial;
    });
    root.append(...dials.map((d) => d.group));
  }

  // The rings: each band carries fixed ticks at its rim and a turning
  // collar with its needle; the hub holds the word and the pulse.
  function buildRings(bands: Band[]): void {
    const hub = geo.dials[0]!;
    const group = (d: number) =>
      svg("g", {
        class: "dial ring",
        transform: `translate(${hub.x} ${hub.y})`,
        "aria-label": `Ring ${letter(d)}, turned ${turn[d] === -1 ? "left" : "right"}`,
      });
    const annulus = (inner: number, outer: number) =>
      `M${outer},0A${outer},${outer} 0 1 1 ${-outer},0A${outer},${outer} 0 1 1 ${outer},0ZM${inner},0A${inner},${inner} 0 1 0 ${-inner},0A${inner},${inner} 0 1 0 ${inner},0Z`;
    dials = bands.map(({ inner, outer }, d) => {
      const w = outer - inner;
      const tickIn = outer - w * 0.28;
      let ticks = "";
      for (let v = 0; v < range; v++) {
        const from = spot(
          v,
          v % 10 === 0 ? tickIn - w * 0.08 : v % 5 === 0 ? tickIn : tickIn + w * 0.06,
        );
        const to = spot(v, outer - w * 0.06);
        ticks += `M${from.x},${from.y}L${to.x},${to.y}`;
      }
      const collar = inner + (tickIn - inner) / 2;
      const way = turn[d] === -1 ? -1 : 1;
      // The way to turn, laid in the collar's lower half with a head.
      const sweep = range * 0.14;
      const centre = range / 2;
      const from = spot(centre - way * sweep, collar);
      const to = spot(centre + way * sweep, collar);
      const barb = (out: number) => spot(centre + way * (sweep - range * 0.035), collar + out);
      const [a, b] = [barb(-w * 0.16), barb(w * 0.16)];
      const tagAt = spot(range * 0.25, collar);
      const lampAt = spot(range * 0.75, collar);
      const dial: Dial = {
        knob: svg(
          "g",
          { class: "knob" },
          svg("path", { class: "collar", d: annulus(inner + 2, tickIn - 2) }),
          svg("path", {
            class: "point",
            d: `M0,${-tickIn + 1}L${-w * 0.14},${-tickIn + w * 0.3}L${w * 0.14},${-tickIn + w * 0.3}Z`,
          }),
        ),
        said: svg("text", { class: "said", "font-size": Math.max(12, geo.r * 0.09) }),
        pulse: svg("circle", { class: "pulse", r: inner }),
        hint: svg("path", { class: "hint" }),
        guide: svg("circle", { class: "guide", r: Math.max(3, w * 0.1) }),
        group: group(d),
      };
      const tag = svg("text", {
        class: "tag",
        x: tagAt.x,
        y: tagAt.y,
        "font-size": Math.max(13, w * 0.36),
      });
      tag.textContent = letter(d);
      dial.group.append(
        svg("path", { class: "rim", d: annulus(inner, outer) }),
        svg("path", { class: "ticks", d: ticks }),
        dial.guide,
        dial.hint,
        dial.knob,
        svg("path", {
          class: "way",
          d: `M${from.x},${from.y}A${collar},${collar} 0 0 ${way === 1 ? 1 : 0} ${to.x},${to.y}M${a.x},${a.y}L${to.x},${to.y}L${b.x},${b.y}`,
        }),
        svg("circle", { class: "lamp", cx: lampAt.x, cy: lampAt.y, r: Math.max(4, w * 0.12) }),
        svg("path", {
          class: "tick",
          d: `M${lampAt.x - w * 0.18},${lampAt.y}L${lampAt.x - w * 0.04},${lampAt.y + w * 0.14}L${lampAt.x + w * 0.2},${lampAt.y - w * 0.12}`,
        }),
        tag,
        dial.said,
        dial.pulse,
      );
      return dial;
    });
    root.append(...dials.map((d) => d.group));
  }

  function frame(): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(n, size, shape);
      if (geo.bands) buildRings(geo.bands);
      else build();
    }
    const clock = performance.now();
    const hint = host.hinted();
    const m = model();
    const { r } = geo;
    const notch = 360 / range;
    for (const [d, dial] of dials.entries()) {
      const held = hold?.dial === d;
      const live = held && caught;
      set(dial.knob, { transform: `rotate(${(held ? pos[d]! : turned[d]!) * notch})` });
      const band = geo.bands?.[d];
      const state = [
        band ? "dial ring" : "dial",
        d < m.k ? "open" : d === m.k ? "next" : "",
        held ? "held" : "",
        live ? "caught" : "",
      ];
      set(dial.group, { class: state.filter(Boolean).join(" ") });
      dial.said.textContent = live ? "Click" : "";
      const spread = held ? Math.min(1, (clock - pulseAt) / PULSE_MS) : 1;
      // A ring's pulse spreads across its own band; a dial's from its hub.
      const [low, high] = band ? [band.inner, band.outer] : [r * 0.2, r];
      set(dial.pulse, {
        r: low + (high - low) * spread,
        opacity: spread < 1 ? 1 - spread : 0,
      });
      const shown = hint?.a === d ? hint : undefined;
      // On the rings the hint points in from the band's own rim, over its ticks.
      const w = band ? band.outer - band.inner : 0;
      const at = spot(shown?.b ?? 0, band ? band.outer - w * 0.32 : r * 1.02);
      const out = spot(shown?.b ?? 0, band ? band.outer : r * 1.14);
      const side = spot((shown?.b ?? 0) + range / 4, band ? w * 0.12 : r * 0.07);
      set(dial.hint, {
        d: shown
          ? `M${at.x},${at.y}L${out.x + side.x},${out.y + side.y}L${out.x - side.x},${out.y - side.y}Z`
          : "",
      });
      const led = host.guide?.a === d && m.k === 0 ? host.guide : undefined;
      const dot = spot(led?.b ?? 0, band ? band.outer - w * 0.1 : r * 1.05);
      set(dial.guide, { cx: dot.x, cy: dot.y, opacity: led ? 0.6 : 0 });
    }
    set(root, { class: `board lock-dial${clock < slipUntil ? " slip" : ""}` });
  }

  // One detent crossed, the way it was crossed: the dial in turn clicks as
  // its needle comes onto its number that way.
  function crossed(d: number, way: number): void {
    turned[d]! += way;
    hold!.way = way;
    const click = model().clicks(d, number(d), way);
    if (click && !caught) {
      pulseAt = performance.now();
      try {
        navigator.vibrate?.(12);
      } catch {
        // No buzz here; the ring and the word say it.
      }
    }
    caught = click;
  }

  const unbind = pointers(host.surface, {
    down(p) {
      const dial = pick(geo, p);
      if (dial === undefined) return false;
      finger = turning(deadOf(geo));
      finger.start(geo.dials[dial]!, p);
      hold = { dial, way: 0 };
      pos[dial] = turned[dial]!;
      caught = false;
      return true;
    },
    move(p) {
      if (!hold) return;
      const d = hold.dial;
      pos[d]! += finger.turn(geo.dials[d]!, p) * range;
      const steps = settle(turned[d]!, pos[d]!) - turned[d]!;
      for (let i = Math.abs(steps); i > 0; i--) crossed(d, Math.sign(steps));
    },
    up() {
      if (!hold) return;
      const { dial, way } = hold;
      hold = undefined;
      caught = false;
      // A dial that was only held, never turned a detent, has not been left anywhere new.
      if (way === 0) return;
      const before = model().k;
      host.move(dial, number(dial), way);
      if (model().k <= before) slipUntil = performance.now() + SLIP_MS;
    },
    cancel() {
      hold = undefined;
      caught = false;
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

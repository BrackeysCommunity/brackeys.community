import "./scene.css";
import {
  HIT,
  distance,
  pointers,
  set,
  sizeOf,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import { GOING, type Model, type Scene, type SceneHost } from "../../shell/kit.ts";
import { plural, seconds } from "../../units.ts";
import { TURN, WARN, type CrankModel } from "./model.ts";

/** The degrees of clockwise travel that send one pulse. */
export const QUARTER = 90;
/** Nearer the hub than this a finger has no angle worth reading. */
export const DEAD = 14;

// How long a hint stays lit, the degrees a ms the wheel is drawn coasting
// per unit of speed, and how much of the gauge lies past the blow mark.
const HINT_MS = 3000;
const COAST = 0.0007;
const PAST_BLOW = 1.1;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  hub: Point;
  /** The wheel's radius, and the handle's. */
  r: number;
  knob: number;
  /** The speed gauge: its left edge, width, top and height. */
  x: number;
  width: number;
  top: number;
  bar: number;
}

export function geometry(size: Size): Geometry {
  const pad = 8;
  const head = 138;
  const room = Math.max(1, size.height - head);
  const r = Math.max(HIT * 2, Math.min(size.width * 0.36, room * 0.42));
  return {
    hub: { x: size.width / 2, y: head + room / 2 },
    r,
    knob: Math.max(HIT, r * 0.24),
    x: pad,
    width: size.width - pad * 2,
    top: 32,
    bar: 24,
  };
}

/** A point's angle round the hub in degrees, clockwise on the screen from three o'clock. */
export function angleOf(hub: Point, p: Point): number {
  return (Math.atan2(p.y - hub.y, p.x - hub.x) * 180) / Math.PI;
}

/** The shorter way round from one angle to another, in degrees; clockwise is positive. */
export function sweep(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

interface Drag {
  /** The finger's last angle; none while it is on the hub. */
  angle: number | undefined;
  /** Clockwise degrees not yet spent on a pulse. */
  wound: number;
}

/**
 * The dynamo: a crank wound in circles. Every quarter turn clockwise
 * kicks the speed up; the gauge above shows the band it must be held in
 * and the mark it blows at.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as CrankModel;
  const step = Math.max(host.layout.step ?? 0, 1);

  const root = svg("svg", {
    class: "board crank",
    role: "img",
    "aria-label": `A dynamo with a crank and ${plural(host.layout.size, "load spike")} to come. Drag in circles, clockwise, to wind it into the band and hold it there until it has charged.`,
  });
  host.surface.append(root);

  let size: Size = { width: 0, height: 0 };
  let geo = geometry({ width: 1, height: 1 });
  let status: SVGTextElement | undefined;
  let needle: SVGPathElement | undefined;
  let fill: SVGRectElement | undefined;
  let left: SVGTextElement | undefined;
  let warn: SVGTextElement | undefined;
  let wheel: SVGGElement | undefined;
  let guide: SVGPathElement | undefined;
  let lit: SVGPathElement | undefined;
  let drag: Drag | undefined;
  let seen: Model | undefined;
  let turned = 0;
  let spin = 0;
  let lastAt = 0;
  let hintUntil = 0;
  /** The ms of each spike a hint has warned of. */
  const warned: number[] = [];

  function text(cls: string, x: number, y: number, content = ""): SVGTextElement {
    const node = svg("text", { class: cls, x, y });
    node.textContent = content;
    return node;
  }

  function say(node: SVGTextElement, line: string): void {
    if (node.textContent !== line) node.textContent = line;
  }

  function speedX(m: CrankModel, speed: number): number {
    const max = Math.max(1, m.blow * PAST_BLOW);
    return geo.x + (geo.width * Math.min(speed, max)) / max;
  }

  // Three quarters of a circle round the hub with an arrowhead: the way to turn.
  function way(r: number): string {
    const { hub } = geo;
    const head = 9;
    return (
      `M${hub.x},${hub.y - r}A${r},${r} 0 1 1 ${hub.x - r},${hub.y}` +
      `m${-head},${head}l${head},${-head}l${head},${head}`
    );
  }

  function build(): void {
    root.replaceChildren();
    set(root, {
      viewBox: `0 0 ${size.width} ${size.height}`,
      width: size.width,
      height: size.height,
    });
    const m = model();
    const { hub, r, top, bar } = geo;
    const lo = speedX(m, m.lo);
    const hi = speedX(m, m.hi);
    const blow = speedX(m, m.blow);
    const end = geo.x + geo.width;
    status = text("status", size.width / 2, 20);
    needle = svg("path", { class: "needle" });
    fill = svg("rect", { class: "charge", x: geo.x, y: top + 54, width: 0, height: 10 });
    left = text("left", size.width / 2, top + 82);
    warn = text("warn", size.width / 2, top + 100);
    guide = svg("path", { class: "guide", d: way(r + 12) });
    lit = svg("path", { class: "hint", d: way(r + 12) });
    wheel = svg(
      "g",
      { class: "wheel" },
      svg("circle", { class: "rim", r }),
      svg("path", { class: "spokes", d: `M${-r},0H${r}M0,${-r}V${r}` }),
      svg("circle", { class: "hub", r: DEAD }),
      svg("circle", { class: "knob", cx: r, r: geo.knob }),
      svg("circle", { class: "grip", cx: r, r: geo.knob * 0.35 }),
    );
    root.append(
      status,
      svg("rect", { class: "track", x: geo.x, y: top, width: geo.width, height: bar }),
      svg("rect", { class: "band", x: lo, y: top - 3, width: hi - lo, height: bar + 6 }),
      svg("rect", { class: "blow", x: blow, y: top, width: end - blow, height: bar }),
      svg("path", {
        class: "hatch",
        d: `M${blow},${top + bar}L${end},${top}M${blow},${top}L${end},${top + bar}`,
      }),
      needle,
      text("mark", (lo + hi) / 2, top + bar + 18, "charges here"),
      text("mark end", end, top + bar + 18, "blows"),
      svg("rect", { class: "track", x: geo.x, y: top + 54, width: geo.width, height: 10 }),
      fill,
      left,
      warn,
      guide,
      lit,
      wheel,
      // Over the wheel, and still while it turns: the way to wind.
      svg("path", { class: "way", d: way(r * 0.5) }),
    );
    set(wheel, { transform: `translate(${hub.x} ${hub.y})` });
  }

  function frame(at: number): void {
    const now = sizeOf(host.surface);
    const m = model();
    if (m !== seen) {
      seen = m;
      turned = 0;
      lastAt = at;
      drag = undefined;
    }
    if (now.width !== size.width || now.height !== size.height) {
      size = now;
      geo = geometry(size);
      build();
    }
    // The handle follows a finger; let go, the wheel coasts at its speed.
    if (drag?.angle !== undefined) spin = drag.angle;
    else spin += Math.max(0, Math.min(100, at - lastAt)) * m.speed * COAST;
    lastAt = at;
    const spiking = m.spiking(Math.trunc(at / step));
    set(wheel!, {
      class: `wheel${drag ? " held" : ""}${spiking ? " loaded" : ""}`,
      transform: `translate(${geo.hub.x} ${geo.hub.y}) rotate(${spin})`,
    });
    const x = speedX(m, m.speed);
    const { top, bar } = geo;
    set(needle!, { d: `M${x - 7},${top - 12}h14l-7,10ZM${x},${top - 2}v${bar + 4}` });
    const still = m.speed === 0 && m.charge === 0;
    const word = still
      ? "Wind it clockwise."
      : m.speed > m.hi
        ? "Too fast."
        : m.speed < m.lo
          ? "Too slow."
          : "Charging.";
    say(status!, spiking ? `Load spike! ${word}` : word);
    set(status!, { class: `status${m.speed > m.hi ? " fast" : ""}${spiking ? " spike" : ""}` });
    set(fill!, { width: (geo.width * Math.min(m.charge, m.need)) / Math.max(1, m.need) });
    say(left!, `${seconds(Math.max(0, m.need - m.charge) * step)} of charge to go`);
    const next = warned.filter((w) => w > at).sort((a, b) => a - b)[0];
    say(warn!, next === undefined ? "" : `Load spike in ${seconds(next - at)}`);
    set(guide!, { class: host.guide && turned === 0 ? "guide" : "guide off" });
    set(lit!, { class: performance.now() < hintUntil ? "hint" : "hint off" });
  }

  const unbind = pointers(host.surface, {
    down(p) {
      const far = distance(p, geo.hub) >= DEAD;
      drag = { angle: far ? angleOf(geo.hub, p) : undefined, wound: 0 };
      return true;
    },
    move(p) {
      if (!drag) return;
      if (distance(p, geo.hub) < DEAD) {
        drag.angle = undefined;
        return;
      }
      const angle = angleOf(geo.hub, p);
      // Winding back only unwinds what has not been spent, so a wiggle
      // sends nothing.
      if (drag.angle !== undefined)
        drag.wound = Math.max(-QUARTER, drag.wound + sweep(drag.angle, angle));
      drag.angle = angle;
      while (drag && drag.wound >= QUARTER) {
        drag.wound -= QUARTER;
        turned++;
        if (host.move(TURN) !== GOING) drag = undefined;
      }
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
    hint(move) {
      // A warning is of one spike's start; any other hint is the way to turn.
      if (move.a === WARN) {
        if (!warned.includes(move.at)) warned.push(move.at);
      } else if (move.a === TURN) hintUntil = performance.now() + HINT_MS;
    },
    destroy() {
      unbind();
      root.remove();
    },
  };
}

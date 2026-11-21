import "./scene.css";
import {
  HIT,
  board,
  pointers,
  say,
  set,
  svg,
  text,
  turning,
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

// The degrees a ms the wheel is drawn coasting per unit of speed, and how
// much of the gauge lies past the blow mark.
const COAST = 0.0007;
const PAST_BLOW = 1.1;

/** Where a speed lies on a gauge from x for width, the gauge running a little past the blow mark. */
export function speedX(x: number, width: number, blow: number, speed: number): number {
  const max = Math.max(1, blow * PAST_BLOW);
  return x + (width * Math.min(speed, max)) / max;
}

/** Three quarters of a circle round a hub with an arrowhead of the given size: the way to turn. */
export function turnArrow(hub: Point, r: number, head: number): string {
  return (
    `M${hub.x},${hub.y - r}A${r},${r} 0 1 1 ${hub.x - r},${hub.y}` +
    `m${-head},${head}l${head},${-head}l${head},${head}`
  );
}

/** The shape whose crank is a pump lever: each full push down is one quarter turn. */
export const PUMP_SHAPE = 1;

// The lever's swing either side of level, in degrees, and the share of a
// stroke a hand must lift back before the next push counts.
const SWING = 28;
const REARM = 0.6;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  /** The wheel's hub; on the pump, the lever's pivot. */
  hub: Point;
  /** The wheel's radius, and the handle's; on the pump, the lever's length. */
  r: number;
  knob: number;
  /** The speed gauge: its left edge, width, top and height. */
  x: number;
  width: number;
  top: number;
  bar: number;
  /** The px of one push down the pump's handle; none on the crank. */
  stroke?: number;
}

export function geometry(size: Size, shape = 0): Geometry {
  const pad = 8;
  const head = 138;
  const room = Math.max(1, size.height - head);
  if (shape === PUMP_SHAPE) {
    // The pump stands at the left, its lever reaching right to the handle.
    const r = Math.max(HIT * 3, Math.min(size.width * 0.62, room * 0.9));
    return {
      hub: { x: Math.max(pad + 40, (size.width - r) / 2), y: head + room / 2 },
      r,
      knob: Math.max(HIT, r * 0.14),
      x: pad,
      width: size.width - pad * 2,
      top: 32,
      bar: 24,
      stroke: Math.max(HIT * 2, Math.min(room * 0.4, r * Math.sin((SWING * Math.PI) / 180) * 2)),
    };
  }
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

interface Drag {
  /** Clockwise degrees not yet spent on a pulse. */
  wound: number;
}

/**
 * A hand on the pump's handle: a push down by a whole stroke is one pulse,
 * and the handle must come back up most of a stroke before the next.
 */
export class Pump {
  private top: number;
  private low: number;
  private armed = true;

  constructor(
    private readonly stroke: number,
    y: number,
  ) {
    this.top = y;
    this.low = y;
  }

  /** The pulses a hand moved to y sends: 1 on a full push, else 0. */
  to(y: number): number {
    if (this.armed) {
      this.top = Math.min(this.top, y);
      if (y - this.top < this.stroke) return 0;
      this.armed = false;
      this.low = y;
      return 1;
    }
    this.low = Math.max(this.low, y);
    if (this.low - y >= this.stroke * REARM) {
      this.armed = true;
      this.top = y;
    }
    return 0;
  }

  /** How far down the stroke the handle stands, from 0 (up) to 1 (down). */
  depth(y: number): number {
    return this.armed
      ? Math.max(0, Math.min(1, (y - this.top) / this.stroke))
      : Math.max(0, Math.min(1, 1 - (this.low - y) / this.stroke));
  }
}

/**
 * The dynamo: a crank wound in circles. Every quarter turn clockwise
 * kicks the speed up; the gauge above shows the band it must be held in
 * and the mark it blows at.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as CrankModel;
  const step = Math.max(host.layout.step ?? 0, 1);
  const shape = host.layout.shape ?? 0;
  const pump = shape === PUMP_SHAPE;

  const view = board(
    host,
    pump
      ? `A dynamo with a pump lever and ${plural(host.layout.size, "load spike")} to come. Push the handle down and let it up again to pump it into the band, and hold it there until it has charged.`
      : `A dynamo with a crank and ${plural(host.layout.size, "load spike")} to come. Drag in circles, clockwise, to wind it into the band and hold it there until it has charged.`,
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry({ width: 1, height: 1 }, shape);
  let lever: SVGGElement | undefined;
  let hand: { pump: Pump; y: number } | undefined;
  let status: SVGTextElement | undefined;
  let needle: SVGPathElement | undefined;
  let fill: SVGRectElement | undefined;
  let left: SVGTextElement | undefined;
  let warn: SVGTextElement | undefined;
  let wheel: SVGGElement | undefined;
  let guide: SVGPathElement | undefined;
  let lit: SVGPathElement | undefined;
  let drag: Drag | undefined;
  const finger = turning(DEAD);
  let seen: Model | undefined;
  let turned = 0;
  let spin = 0;
  let lastAt = 0;
  /** The ms of each spike a hint has warned of. */
  const warned: number[] = [];

  function gaugeX(m: CrankModel, speed: number): number {
    return speedX(geo.x, geo.width, m.blow, speed);
  }

  function way(r: number): string {
    return turnArrow(geo.hub, r, 9);
  }

  function build(): void {
    const m = model();
    const { hub, r, top, bar } = geo;
    const lo = gaugeX(m, m.lo);
    const hi = gaugeX(m, m.hi);
    const blow = gaugeX(m, m.blow);
    const end = geo.x + geo.width;
    status = text("status", size.width / 2, 20);
    needle = svg("path", { class: "needle" });
    fill = svg("rect", { class: "charge", x: geo.x, y: top + 54, width: 0, height: 10 });
    left = text("left", size.width / 2, top + 82);
    warn = text("warn", size.width / 2, top + 100);
    guide = svg("path", { class: "guide", d: pump ? push() : way(r + 12) });
    lit = svg("path", { class: "hint", d: pump ? push() : way(r + 12) });
    // The pump's flywheel is small and turns with the speed; its lever is the handle.
    const fly = pump ? r * 0.2 : r;
    wheel = svg(
      "g",
      { class: "wheel" },
      svg("circle", { class: "rim", r: fly }),
      svg("path", { class: "spokes", d: `M${-fly},0H${fly}M0,${-fly}V${fly}` }),
      svg("circle", { class: "hub", r: pump ? fly * 0.3 : DEAD }),
      ...(pump
        ? []
        : [
            svg("circle", { class: "knob", cx: r, r: geo.knob }),
            svg("circle", { class: "grip", cx: r, r: geo.knob * 0.35 }),
          ]),
    );
    lever = pump
      ? svg(
          "g",
          { class: "lever" },
          svg("path", { class: "arm", d: `M0,0H${r}` }),
          svg("circle", { class: "knob", cx: r, r: geo.knob }),
          svg("circle", { class: "grip", cx: r, r: geo.knob * 0.35 }),
          svg("circle", { class: "pivot", r: Math.max(6, r * 0.04) }),
        )
      : undefined;
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
      ...(pump
        ? [
            // The pump's barrel stands under the pivot, the flywheel at its foot.
            svg("rect", {
              class: "barrel",
              x: hub.x - r * 0.09,
              y: hub.y,
              width: r * 0.18,
              height: r * 0.34,
              rx: 4,
            }),
            wheel,
            lever!,
            svg("path", { class: "way", d: push(0.45) }),
          ]
        : [
            wheel,
            // Over the wheel, and still while it turns: the way to wind.
            svg("path", { class: "way", d: way(r * 0.5) }),
          ]),
    );
    set(wheel, {
      transform: `translate(${hub.x} ${pump ? hub.y + r * 0.34 : hub.y})`,
    });
  }

  // A double arrow down and up beside the handle: the way to pump.
  function push(scale = 1): string {
    const { hub, r } = geo;
    const half = (geo.stroke ?? 0) * 0.5 * scale + 6;
    const x = hub.x + r + geo.knob + 16;
    const head = 8;
    return (
      `M${x},${hub.y - half}V${hub.y + half}` +
      `M${x - head},${hub.y + half - head}L${x},${hub.y + half}L${x + head},${hub.y + half - head}` +
      `M${x - head},${hub.y - half + head}L${x},${hub.y - half}L${x + head},${hub.y - half + head}`
    );
  }

  function frame(at: number): void {
    const now = view.fit();
    const m = model();
    if (m !== seen) {
      seen = m;
      turned = 0;
      lastAt = at;
      drag = undefined;
      hand = undefined;
    }
    if (now) {
      size = now;
      geo = geometry(size, shape);
      build();
    }
    // The handle follows a finger; let go, the wheel coasts at its speed.
    const held = drag && finger.angle();
    if (held !== undefined) spin = held * 360;
    else spin += Math.max(0, Math.min(100, at - lastAt)) * m.speed * COAST;
    lastAt = at;
    const spiking = m.spiking(Math.trunc(at / step));
    const flyY = pump ? geo.hub.y + geo.r * 0.34 : geo.hub.y;
    set(wheel!, {
      class: `wheel${drag || hand ? " held" : ""}${spiking ? " loaded" : ""}`,
      transform: `translate(${geo.hub.x} ${flyY}) rotate(${spin})`,
    });
    if (lever) {
      // The handle stands where the hand is along its stroke, level at half way.
      const depth = hand ? hand.pump.depth(hand.y) : 0;
      const lift = ((depth - 0.5) * (geo.stroke ?? 0)) / geo.r;
      const deg = (Math.asin(Math.max(-1, Math.min(1, lift))) * 180) / Math.PI;
      set(lever, {
        class: `lever${hand ? " held" : ""}`,
        transform: `translate(${geo.hub.x} ${geo.hub.y}) rotate(${deg})`,
      });
    }
    const x = gaugeX(m, m.speed);
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
    // A warning is of one spike's start, and stays; any other hint is the
    // way to turn.
    const hint = host.hinted();
    if (hint?.a === WARN && !warned.includes(hint.at)) warned.push(hint.at);
    const next = warned.filter((w) => w > at).sort((a, b) => a - b)[0];
    say(warn!, next === undefined ? "" : `Load spike in ${seconds(next - at)}`);
    set(guide!, { class: host.guide && turned === 0 ? "guide" : "guide off" });
    set(lit!, { class: hint?.a === TURN ? "hint" : "hint off" });
  }

  const unbind = pointers(host.surface, {
    down(p) {
      if (pump) {
        hand = { pump: new Pump(geo.stroke ?? 1, p.y), y: p.y };
        return true;
      }
      finger.start(geo.hub, p);
      drag = { wound: 0 };
      return true;
    },
    move(p) {
      if (hand) {
        hand.y = p.y;
        if (hand.pump.to(p.y) > 0) {
          turned++;
          if (host.move(TURN) !== GOING) hand = undefined;
        }
        return;
      }
      if (!drag) return;
      // Winding back only unwinds what has not been spent, so a wiggle
      // sends nothing.
      drag.wound = Math.max(-QUARTER, drag.wound + finger.turn(geo.hub, p) * 360);
      while (drag && drag.wound >= QUARTER) {
        drag.wound -= QUARTER;
        turned++;
        if (host.move(TURN) !== GOING) drag = undefined;
      }
    },
    up() {
      drag = undefined;
      hand = undefined;
    },
    cancel() {
      drag = undefined;
      hand = undefined;
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

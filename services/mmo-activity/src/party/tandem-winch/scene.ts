import "./scene.css";
import { TURN } from "../../scenes/crank/model.ts";
import { DEAD, QUARTER, speedX, turnArrow } from "../../scenes/crank/scene.ts";
import {
  HIT,
  board,
  letter,
  nearest,
  pointers,
  say,
  set,
  svg,
  text,
  turning,
  type Point,
  type Size,
} from "../../shell/board.ts";
import { GOING, type Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { seconds } from "../../units.ts";
import { PartyBar, playArea, seatName } from "../wrap.ts";
import { CRANKS, type WinchModel } from "./model.ts";

// The degrees a ms a wheel is drawn coasting per unit of speed, and how
// long a touch on the other seat's crank is answered.
const COAST = 0.0007;
const REFUSED_MS = 1200;

/** Where everything sits, in CSS px of the play area. */
export interface Geometry {
  /** Each crank's hub, and the left edge and width of its gauge. */
  hubs: Point[];
  gauges: { x: number; width: number }[];
  r: number;
  knob: number;
  /** The gauges' top and height, and the pair's charge bar. */
  top: number;
  bar: number;
  charge: { x: number; y: number; width: number };
}

export function geometry(size: Size): Geometry {
  const pad = 8;
  const col = size.width / CRANKS;
  const top = 100;
  const bar = 20;
  const head = top + bar + 30;
  const room = Math.max(1, size.height - head - 26);
  // Small enough that the knob's full sweep and the label under it clear the bottom line.
  const r = Math.max(HIT * 1.6, Math.min(col * 0.34, room * 0.36));
  return {
    hubs: Array.from({ length: CRANKS }, (_, c) => ({ x: col * (c + 0.5), y: head + room / 2 })),
    gauges: Array.from({ length: CRANKS }, (_, c) => ({ x: col * c + pad, width: col - pad * 2 })),
    r,
    knob: Math.max(HIT, r * 0.24),
    top,
    bar,
    charge: { x: pad, y: 32, width: size.width - pad * 2 },
  };
}

/** The crank a finger lands on, if it is on one's wheel. */
export function grab(geo: Geometry, p: Point): number | undefined {
  const hit = nearest(geo.hubs, p);
  return hit.distance <= geo.r + geo.knob ? hit.index : undefined;
}

interface Crank {
  wheel: SVGGElement;
  needle: SVGPathElement;
  who: SVGTextElement;
  shade: SVGCircleElement;
}

/** Two dynamos side by side with a speed gauge each, and the crank this seat holds. */
export function mount(host: PartySceneHost): Scene {
  const model = () => host.model as WinchModel;
  const step = Math.max(host.layout.step ?? 0, 1);

  const view = board(
    host,
    "Two dynamos side by side, each with a crank and a speed gauge, and one charge between them.",
  );
  const root = view.root;
  root.classList.add("tandem-winch");
  const bar = new PartyBar(
    host,
    `${seatName(host.seat)} of ${host.seats}. Two dynamos charge only while both run in the band together. Drag in circles, clockwise, on the crank you hold; the cranks change hands every few seconds.`,
  );

  let size: Size = { width: 0, height: 0 };
  let geo = geometry({ width: 1, height: 1 });
  let status: SVGTextElement | undefined;
  let fill: SVGRectElement | undefined;
  let left: SVGTextElement | undefined;
  let hands: SVGTextElement | undefined;
  let cranks: Crank[] = [];
  let drag: { crank: number; wound: number } | undefined;
  const finger = turning(DEAD);
  const spin = [0, 0];
  let lastAt = 0;
  let refused: { crank: number; until: number } | undefined;

  function gaugeX(c: number, speed: number): number {
    const g = geo.gauges[c]!;
    return speedX(g.x, g.width, model().blow, speed);
  }

  function build(): void {
    const m = model();
    const { top, bar: h, r } = geo;
    status = text("status", size.width / 2, 20);
    fill = svg("rect", { class: "charge", x: geo.charge.x, y: geo.charge.y, width: 0, height: 10 });
    left = text("left", size.width / 2, geo.charge.y + 24);
    hands = text("mark", size.width / 2, size.height - 8);
    root.append(
      status,
      svg("rect", {
        class: "track",
        x: geo.charge.x,
        y: geo.charge.y,
        width: geo.charge.width,
        height: 10,
      }),
      fill,
      left,
      hands,
    );
    cranks = geo.hubs.map((hub, c) => {
      const g = geo.gauges[c]!;
      const lo = gaugeX(c, m.lo);
      const hi = gaugeX(c, m.hi);
      const blow = gaugeX(c, m.blow);
      const end = g.x + g.width;
      const needle = svg("path", { class: "needle" });
      const wheel = svg(
        "g",
        { class: "wheel" },
        svg("circle", { class: "rim", r }),
        svg("path", { class: "spokes", d: `M${-r},0H${r}M0,${-r}V${r}` }),
        svg("circle", { class: "hub", r: DEAD }),
        svg("circle", { class: "knob", cx: r, r: geo.knob }),
        svg("circle", { class: "grip", cx: r, r: geo.knob * 0.35 }),
      );
      const who = text("who", hub.x, hub.y + r + geo.knob + 14);
      const shade = svg("circle", { class: "theirs", cx: hub.x, cy: hub.y, r: r + 6 });
      root.append(
        text("mark", g.x + g.width / 2, top - 24, `Crank ${letter(c)}`),
        svg("rect", { class: "track", x: g.x, y: top, width: g.width, height: h }),
        svg("rect", { class: "band", x: lo, y: top - 3, width: hi - lo, height: h + 6 }),
        svg("rect", { class: "blow", x: blow, y: top, width: end - blow, height: h }),
        svg("path", {
          class: "hatch",
          d: `M${blow},${top + h}L${end},${top}M${blow},${top}L${end},${top + h}`,
        }),
        needle,
        wheel,
        svg("path", { class: "way", d: turnArrow(hub, r * 0.5, 7) }),
        shade,
        who,
      );
      return { wheel, needle, who, shade };
    });
  }

  function line(m: WinchModel): string {
    const [a, b] = m.cranks.map((c) => c.speed) as [number, number];
    if (a === 0 && b === 0 && m.charge === 0) return "Wind both cranks into the band.";
    if (m.together()) return "Both in the band: charging.";
    for (const [c, s] of [a, b].entries()) {
      if (s > m.hi) return `Crank ${letter(c)} too fast.`;
      if (s < m.lo) return `Crank ${letter(c)} too slow.`;
    }
    return "Keep the two cranks closer together.";
  }

  function frame(at: number): void {
    const now = view.fit();
    if (now) {
      size = playArea(now);
      geo = geometry(size);
      build();
    }
    bar.fit();
    const m = model();
    const ms = host.now();
    const spiking = m.cranks[0]!.spiking(Math.trunc(at / step));
    for (const [c, k] of cranks.entries()) {
      const held = drag?.crank === c ? finger.angle() : undefined;
      if (held !== undefined) spin[c] = held * 360;
      else spin[c]! += Math.max(0, Math.min(100, at - lastAt)) * m.cranks[c]!.speed * COAST;
      const hub = geo.hubs[c]!;
      set(k.wheel, {
        class: `wheel${drag?.crank === c ? " held" : ""}${spiking ? " loaded" : ""}`,
        transform: `translate(${hub.x} ${hub.y}) rotate(${spin[c]})`,
      });
      const x = gaugeX(c, m.cranks[c]!.speed);
      set(k.needle, { d: `M${x - 6},${geo.top - 10}h12l-6,8ZM${x},${geo.top - 2}v${geo.bar + 4}` });
      const seat = m.seatAt(c, ms);
      say(k.who, seat === host.seat ? "You wind this" : `${seatName(seat)} winds this`);
      set(k.who, { class: seat === host.seat ? "who yours" : "who" });
      set(k.shade, { class: seat === host.seat ? "theirs off" : "theirs" });
    }
    lastAt = at;
    say(status!, spiking ? `Load spike! ${line(m)}` : line(m));
    set(fill!, { width: (geo.charge.width * Math.min(m.charge, m.need)) / Math.max(1, m.need) });
    say(left!, `${seconds(Math.max(0, m.need - m.charge) * step)} of charge to go`);
    const change = m.handsChange(ms);
    say(hands!, change === undefined ? "" : `The cranks change hands in ${seconds(change - ms)}.`);
    const held = Array.from({ length: CRANKS }, (_, c) => m.seatAt(c, ms));
    for (let s = 0; s < host.seats; s++) bar.light(s, held.includes(s), "holds");
    if (refused && performance.now() > refused.until) refused = undefined;
    const yours = held.indexOf(host.seat);
    bar.say(
      refused
        ? `${seatName(m.seatAt(refused.crank, ms))} winds crank ${letter(refused.crank)} now.`
        : yours < 0
          ? "Both cranks are in other hands: wait for yours."
          : `You wind crank ${letter(yours)}.`,
    );
  }

  const unbind = pointers(host.surface, {
    down(p, ev) {
      const crank = grab(geo, p);
      const hub = crank === undefined ? geo.hubs[0]! : geo.hubs[crank]!;
      host.dropped(Math.hypot(p.x - hub.x, p.y - hub.y), geo.r + geo.knob, crank !== undefined, ev);
      if (crank === undefined) return false;
      if (model().seatAt(crank, host.now()) !== host.seat) {
        refused = { crank, until: performance.now() + REFUSED_MS };
        return false;
      }
      finger.start(hub, p);
      drag = { crank, wound: 0 };
      return true;
    },
    move(p) {
      if (!drag) return;
      const hub = geo.hubs[drag.crank]!;
      drag.wound = Math.max(-QUARTER, drag.wound + finger.turn(hub, p) * 360);
      while (drag && drag.wound >= QUARTER) {
        drag.wound -= QUARTER;
        // The crank changed hands under the finger: the next turn is not this seat's.
        if (model().seatAt(drag.crank, host.now()) !== host.seat) {
          drag = undefined;
          break;
        }
        if (host.move(TURN, drag.crank) !== GOING) drag = undefined;
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
    destroy() {
      unbind();
      view.remove();
      bar.remove();
    },
  };
}

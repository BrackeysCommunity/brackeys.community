import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  HIT,
  PICKUP,
  board,
  pointers,
  say,
  set,
  svg,
  text,
  type Point,
  type Size,
} from "../../shell/board.ts";
import { GOING, type Model, type Scene, type SceneHost } from "../../shell/kit.ts";
import { plural } from "../../units.ts";
import type { KeycardModel, Read } from "./model.ts";

// The swipes of a pass the gauge remembers.
const MARKS = 8;

/** The shape whose reader takes the card in from above: a pass is timed as it is pulled out. */
export const INSERT_SHAPE = 1;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  /** The reader's slot: its y, and the x of its two gates; on the insert reader its x, and the gates' y. */
  rail: number;
  gates: [number, number];
  /** The card: its size, and how far its middle can travel along the slot. */
  card: Size;
  min: number;
  max: number;
  /** The slot runs up and down, and only a card on its way out is read. */
  upright?: boolean;
  /** The speed gauge: its left edge, top, width and height. */
  x: number;
  top: number;
  width: number;
  bar: number;
}

export function geometry(size: Size, shape = 0): Geometry {
  const pad = 8;
  const head = 112;
  const span = size.width - pad * 2;
  const room = Math.max(1, size.height - head);
  if (shape === INSERT_SHAPE) {
    // The card lies flat and wide, so it is pulled out by its face.
    const card = {
      width: Math.max(HIT * 3, Math.min(150, size.width * 0.42)),
      height: Math.max(HIT * 2 + 6, Math.min(84, room * 0.2)),
    };
    const min = head + card.height / 2;
    const max = size.height - pad - card.height / 2;
    return {
      rail: size.width / 2,
      gates: [min + (max - min) * 0.3, min + (max - min) * 0.78],
      card,
      min,
      max,
      x: pad,
      top: 62,
      width: span,
      bar: 20,
      upright: true,
    };
  }
  const card = {
    width: Math.max(HIT * 2 + 6, Math.min(84, size.width * 0.17)),
    height: Math.max(80, Math.min(150, room * 0.44)),
  };
  return {
    rail: head + room / 2,
    gates: [pad + span * 0.24, pad + span * 0.76],
    card,
    min: pad + card.width / 2,
    max: size.width - pad - card.width / 2,
    x: pad,
    top: 62,
    width: span,
    bar: 20,
  };
}

/** How far along the slot a pointer is. */
export function along(geo: Geometry, p: Point): number {
  return geo.upright ? p.y : p.x;
}

/** Where on the surface the card's middle is, at a place along the slot. */
export function cardAt(geo: Geometry, pos: number): Point {
  return geo.upright ? { x: geo.rail, y: pos } : { x: pos, y: geo.rail };
}

/** Whether a pointer picks the card up, and how far it was from its middle. */
export function grabs(geo: Geometry, cardX: number, p: Point): { held: boolean; miss: number } {
  const c = cardAt(geo, cardX);
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  // Along the slot a thumb is let in wider than across it.
  const [da, dc] = geo.upright ? [dy, dx] : [dx, dy];
  const [sa, sc] = geo.upright
    ? [geo.card.height, geo.card.width]
    : [geo.card.width, geo.card.height];
  return {
    held: da <= (sa / 2) * PICKUP && dc <= (sc / 2) * 1.2,
    miss: Math.hypot(dx, dy),
  };
}

/** What the card passed going from one x to another: each gate, and the share of the way it lay at. */
export function crossings(
  gates: [number, number],
  from: number,
  to: number,
): { enters: boolean; share: number }[] {
  if (from === to) return [];
  const right = to > from;
  const met = right ? gates : [gates[1], gates[0]];
  const out: { enters: boolean; share: number }[] = [];
  for (const [i, g] of met.entries()) {
    const crossed = right ? from < g && to >= g : from > g && to <= g;
    // The first gate met leads in between the two; the second leads out.
    if (crossed) out.push({ enters: i === 0, share: (g - from) / (to - from) });
  }
  return out;
}

interface Swipe {
  /** The ms the card passed its first gate, and the way it was going. */
  t: number;
  right: boolean;
}

interface Mark {
  ms: number;
  read: Read;
}

/**
 * The reader: a card dragged through a slot. The time it takes from one
 * gate to the other is the swipe; each pass wants its own, and the reader
 * only says whether a swipe was too fast or too slow.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as KeycardModel;
  const passes = host.layout.size;
  const slowest = host.layout.range ?? 0;
  const shape = host.layout.shape ?? 0;

  const view = board(
    host,
    shape === INSERT_SHAPE
      ? `An insert reader that wants ${plural(passes, "pass", "passes")}. Push the card in, then pull it out through both gates at the speed each pass wants; the reader says when a pull was too fast or too slow.`
      : `A card reader that wants ${plural(passes, "pass", "passes")}. Drag the card through both gates at the speed each pass wants; the reader says when a swipe was too fast or too slow.`,
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry({ width: 1, height: 1 }, shape);
  let status: SVGTextElement | undefined;
  let card: SVGGElement | undefined;
  let lamps: SVGGElement[] = [];
  let strikes: SVGGElement[] = [];
  let ticks: SVGPathElement[] = [];
  let pace: SVGPathElement | undefined;
  let guide: SVGPathElement | undefined;
  let lit: SVGPathElement | undefined;
  let seen: Model | undefined;
  let cardX = 0;
  let grab: number | undefined;
  let lastT = 0;
  let swipe: Swipe | undefined;
  let marks: Mark[] = [];
  let said: Read | undefined;
  let dead = false;

  function msX(ms: number): number {
    const fastest = model().fastest;
    const share = (ms - fastest) / Math.max(1, slowest - fastest);
    return geo.x + geo.width * Math.max(0, Math.min(1, share));
  }

  // A bracket over the stretch of the gauge a swipe may fall in.
  function bracket(move: PuzzleMove | undefined): string {
    if (!move) return "";
    const w = model().width;
    const [a, b] = [msX(move.a - w), msX(move.a + w)];
    const y = geo.top - 4;
    return `M${a},${y + 8}V${y}H${b}V${y + 8}`;
  }

  // A line with a head at each end: the card may be swiped either way.
  function bothWays(a: number, b: number, y: number): string {
    return `M${a},${y}H${b}M${b - 8},${y - 6}l8,6l-8,6M${a + 8},${y - 6}l-8,6l8,6`;
  }

  // A line up the slot with a head at the top: the card is read on its way out.
  function outward(top: number, bottom: number, x: number): string {
    return `M${x},${bottom}V${top}M${x - 6},${top + 8}l6,-8l6,8`;
  }

  function build(): void {
    const { rail, gates, top, bar } = geo;
    const { width: cw, height: ch } = geo.card;
    const m = model();
    status = text("status", size.width / 2, 20);
    lamps = Array.from({ length: passes }, (_, i) =>
      svg(
        "g",
        { transform: `translate(${geo.x + 66 + i * 22} 40)` },
        svg("circle", { r: 8 }),
        svg("path", { class: "read", d: "M-4,0L-1,3L5,-4" }),
      ),
    );
    const right = geo.x + geo.width;
    // A bad swipe the reader still forgives is a ring; one spent is a cross.
    strikes = Array.from({ length: m.strikes }, (_, i) =>
      svg(
        "g",
        { transform: `translate(${right - 8 - i * 18} 40)` },
        svg("circle", { r: 5 }),
        svg("path", { d: "M-5,-5L5,5M5,-5L-5,5" }),
      ),
    );
    ticks = Array.from({ length: MARKS }, () => svg("path", { class: "tick" }));
    pace = svg("path", { class: "pace" });
    guide = svg("path", { class: "guide" });
    lit = svg("path", { class: "hint" });
    const post = ch / 2 + 14;
    card = svg(
      "g",
      { class: "card" },
      svg("rect", { x: -cw / 2, y: -ch / 2, width: cw, height: ch, rx: 6 }),
      svg("rect", { class: "stripe", x: -cw / 2, y: -ch / 2 + 12, width: cw, height: 14 }),
      svg("path", {
        class: "grip",
        d: `M${-cw * 0.22},${ch * 0.2}H${cw * 0.22}M${-cw * 0.22},${ch * 0.3}H${cw * 0.22}`,
      }),
    );
    root.append(
      status,
      text("label", geo.x, 44, "Passes"),
      ...lamps,
      text("label end", right - 2 - m.strikes * 18, 44, "Bad swipes"),
      ...strikes,
      svg("rect", { class: "track", x: geo.x, y: top, width: geo.width, height: bar }),
      text("label", geo.x, top + bar + 16, "fast"),
      text("label end", right, top + bar + 16, "slow"),
      guide,
      lit,
      ...ticks,
      pace,
      ...(geo.upright
        ? upright(cw, ch)
        : [
            svg("rect", { class: "slot", x: geo.x, y: rail - 9, width: geo.width, height: 18 }),
            svg("path", {
              class: "gate",
              d: gates.map((g) => `M${g},${rail - post}V${rail + post}`).join(""),
            }),
            svg("path", {
              class: "way",
              d: bothWays(gates[0] + 14, gates[1] - 14, rail + post - 6),
            }),
          ]),
      card,
    );
  }

  // The insert reader: an upright slot down into the reader's body, its two
  // gates across it, and the way out beside it.
  function upright(cw: number, ch: number): SVGElement[] {
    const { rail, gates } = geo;
    const post = cw / 2 + 14;
    return [
      svg("rect", {
        class: "body",
        x: rail - post - 6,
        y: gates[0] - ch * 0.3,
        width: (post + 6) * 2,
        height: geo.max + ch / 2 - gates[0] + ch * 0.3,
        rx: 10,
      }),
      svg("rect", { class: "slot", x: rail - 9, y: geo.min, width: 18, height: geo.max - geo.min }),
      svg("path", {
        class: "gate",
        d: gates.map((g) => `M${rail - post},${g}H${rail + post}`).join(""),
      }),
      svg("path", { class: "way", d: outward(gates[0] + 10, gates[1] - 10, rail + post + 14) }),
    ];
  }

  // The mark a swipe leaves on the gauge: a tick where it was read, or an
  // arrowhead pointing the way the next one should move.
  function tick(mark: Mark | undefined): string {
    if (!mark) return "";
    const x = msX(mark.ms);
    const y = geo.top + geo.bar / 2;
    if (mark.read === "good") return `M${x - 6},${y}l4,5l8,-10`;
    const d = mark.read === "fast" ? 1 : -1;
    return `M${x - d * 4},${y - 7}l${d * 8},7l${-d * 8},7`;
  }

  function line(m: KeycardModel): string {
    if (swipe) return "Reading the swipe.";
    const last = m.bad === m.strikes ? " One more bad swipe breaks it." : "";
    if (said === "fast") return `Too fast. Swipe slower.${last}`;
    if (said === "slow") return `Too slow. Swipe faster.${last}`;
    if (said === "good") return "Pass read. Now the next.";
    return "Drag the card through both gates.";
  }

  function frame(): void {
    const now = view.fit();
    const m = model();
    const fresh = m !== seen;
    if (fresh) {
      seen = m;
      marks = [];
      said = undefined;
      swipe = undefined;
      grab = undefined;
    }
    if (now) {
      size = now;
      geo = geometry(size, shape);
      build();
      cardX = geo.min;
    } else if (fresh) cardX = geo.min;
    const c = cardAt(geo, cardX);
    set(card!, {
      class: `card${grab === undefined ? "" : " held"}`,
      transform: `translate(${c.x} ${c.y})`,
    });
    say(status!, line(m));
    set(status!, { class: said && said !== "good" && !swipe ? "status bad" : "status" });
    for (const [i, lamp] of lamps.entries())
      set(lamp, { class: i < m.k ? "lamp read" : i === m.k ? "lamp next" : "lamp" });
    for (const [i, s] of strikes.entries()) set(s, { class: i < m.bad ? "strike on" : "strike" });
    for (const [i, t] of ticks.entries()) {
      const mark = marks[i];
      set(t, { d: tick(mark), class: mark ? `tick ${mark.read}` : "tick" });
    }
    const x = swipe ? msX(host.now() - swipe.t) : 0;
    set(pace!, { d: swipe ? `M${x - 7},${geo.top - 12}h14l-7,10Z` : "" });
    set(guide!, { d: m.k === 0 ? bracket(host.guide) : "" });
    const hint = host.hinted();
    set(lit!, { d: bracket(hint) });
  }

  // The card left the gates: its time between them is the swipe.
  function read(t: number): void {
    const m = model();
    const a = Math.max(1, Math.round(t - swipe!.t));
    // A swipe the machine's clock has no room for was made before it ran.
    if (a > host.now() - m.last) return;
    const how = m.read(a);
    const [k, bad] = [m.k, m.bad];
    const st = host.move(a);
    if (dead || (st === GOING && m.k === k && m.bad === bad)) return;
    said = how;
    marks =
      how === "good" ? [{ ms: a, read: how }] : [...marks, { ms: a, read: how }].slice(-MARKS);
  }

  function travel(to: number, t: number): void {
    for (const c of crossings(geo.gates, cardX, to)) {
      const at = lastT + (t - lastT) * c.share;
      if (c.enters) {
        // Pushed into the insert reader, a card is only going in: nothing is read.
        if (geo.upright && to > cardX) continue;
        // A swipe is timed from its first gate, so the clock runs from there.
        if (host.now() === 0) host.arm();
        swipe = { t: at, right: to > cardX };
        continue;
      }
      // Out by the gate it came in at is no swipe.
      if (swipe && swipe.right === to > cardX) read(at);
      swipe = undefined;
    }
    cardX = to;
    lastT = t;
  }

  const unbind = pointers(host.surface, {
    down(p, ev) {
      const { held, miss } = grabs(geo, cardX, p);
      host.dropped(miss, (geo.card.width / 2) * PICKUP, held, ev);
      if (!held) return false;
      grab = along(geo, p) - cardX;
      lastT = host.now();
      return true;
    },
    move(p) {
      if (grab === undefined) return;
      travel(Math.max(geo.min, Math.min(geo.max, along(geo, p) - grab)), host.now());
    },
    // A card let go between the gates has not been swiped.
    up() {
      grab = undefined;
      swipe = undefined;
    },
    cancel() {
      grab = undefined;
      swipe = undefined;
    },
  });

  return {
    frame,
    destroy() {
      dead = true;
      unbind();
      view.remove();
    },
  };
}

import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  HIT,
  PICKUP,
  dropped,
  pointers,
  set,
  sizeOf,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import { GOING, type Model, type Scene, type SceneHost } from "../../shell/kit.ts";
import { plural } from "../../units.ts";
import type { KeycardModel, Read } from "./model.ts";

// How long a hint stays lit, and the swipes of a pass the gauge remembers.
const HINT_MS = 5000;
const MARKS = 8;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  /** The reader's slot: its y, and the x of its two gates. */
  rail: number;
  gates: [number, number];
  /** The card: its size, and how far its middle can travel. */
  card: Size;
  min: number;
  max: number;
  /** The speed gauge: its left edge, top, width and height. */
  x: number;
  top: number;
  width: number;
  bar: number;
}

export function geometry(size: Size): Geometry {
  const pad = 8;
  const head = 112;
  const span = size.width - pad * 2;
  const room = Math.max(1, size.height - head);
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

/** Whether a pointer picks the card up, and how far it was from its middle. */
export function grabs(geo: Geometry, cardX: number, p: Point): { held: boolean; miss: number } {
  const dx = Math.abs(p.x - cardX);
  const dy = Math.abs(p.y - geo.rail);
  return {
    held: dx <= (geo.card.width / 2) * PICKUP && dy <= (geo.card.height / 2) * 1.2,
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

  const root = svg("svg", {
    class: "board keycard",
    role: "img",
    "aria-label": `A card reader that wants ${plural(passes, "pass", "passes")}. Drag the card through both gates at the speed each pass wants; the reader says when a swipe was too fast or too slow.`,
  });
  host.surface.append(root);

  let size: Size = { width: 0, height: 0 };
  let geo = geometry({ width: 1, height: 1 });
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
  let hint: { move: PuzzleMove; until: number } | undefined;
  let dead = false;

  function text(cls: string, x: number, y: number, content = ""): SVGTextElement {
    const node = svg("text", { class: cls, x, y });
    node.textContent = content;
    return node;
  }

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

  function build(): void {
    root.replaceChildren();
    set(root, {
      viewBox: `0 0 ${size.width} ${size.height}`,
      width: size.width,
      height: size.height,
    });
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
      svg("rect", { class: "slot", x: geo.x, y: rail - 9, width: geo.width, height: 18 }),
      svg("path", {
        class: "gate",
        d: gates.map((g) => `M${g},${rail - post}V${rail + post}`).join(""),
      }),
      svg("path", { class: "way", d: bothWays(gates[0] + 14, gates[1] - 14, rail + post - 6) }),
      card,
    );
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
    const now = sizeOf(host.surface);
    const m = model();
    const fresh = m !== seen;
    if (fresh) {
      seen = m;
      marks = [];
      said = undefined;
      swipe = undefined;
      grab = undefined;
    }
    if (now.width !== size.width || now.height !== size.height) {
      size = now;
      geo = geometry(size);
      build();
      cardX = geo.min;
    } else if (fresh) cardX = geo.min;
    set(card!, {
      class: `card${grab === undefined ? "" : " held"}`,
      transform: `translate(${cardX} ${geo.rail})`,
    });
    const say = line(m);
    if (status!.textContent !== say) status!.textContent = say;
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
    if (hint && performance.now() > hint.until) hint = undefined;
    set(lit!, { d: bracket(hint?.move) });
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
      dropped("keycard", miss, (geo.card.width / 2) * PICKUP, held, ev);
      if (!held) return false;
      grab = p.x - cardX;
      lastT = host.now();
      return true;
    },
    move(p) {
      if (grab === undefined) return;
      travel(Math.max(geo.min, Math.min(geo.max, p.x - grab)), host.now());
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
    hint(move) {
      hint = { move, until: performance.now() + HINT_MS };
    },
    destroy() {
      dead = true;
      unbind();
      root.remove();
    },
  };
}

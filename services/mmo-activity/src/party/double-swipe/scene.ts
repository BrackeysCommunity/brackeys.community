import "./scene.css";
import type { Read } from "../../scenes/keycard/model.ts";
import { crossings, grabs, type Geometry as Reader } from "../../scenes/keycard/scene.ts";
import {
  HIT,
  PICKUP,
  board,
  letter,
  pointers,
  say,
  set,
  svg,
  text,
  type Size,
} from "../../shell/board.ts";
import { GOING, type Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural, seconds } from "../../units.ts";
import { PartyBar, playArea, seatName } from "../wrap.ts";
import { READERS, type SwipeModel } from "./model.ts";

// How long a touch on the other seat's card is answered.
const REFUSED_MS = 1200;

/** Where everything sits, in CSS px of the play area: the lamps, then a reader a band. */
export interface Geometry {
  readers: Reader[];
  /** The y of the pass lamps' row, and of each reader's name. */
  lamps: number;
  names: number[];
}

export function geometry(size: Size): Geometry {
  const pad = 8;
  const head = 56;
  const band = Math.max(1, (size.height - head) / READERS);
  const span = size.width - pad * 2;
  const card = {
    width: Math.max(HIT * 2 + 6, Math.min(72, size.width * 0.16)),
    height: Math.max(HIT * 2 + 6, Math.min(110, band - 64)),
  };
  const readers = Array.from({ length: READERS }, (_, r) => {
    const top = head + band * r + 22;
    return {
      rail: top + 18 + 10 + card.height / 2,
      gates: [pad + span * 0.24, pad + span * 0.76] as [number, number],
      card,
      min: pad + card.width / 2,
      max: size.width - pad - card.width / 2,
      x: pad,
      top,
      width: span,
      bar: 12,
    };
  });
  return { readers, lamps: 40, names: readers.map((r) => r.top - 6) };
}

interface Drawn {
  card: SVGGElement;
  name: SVGTextElement;
  tick: SVGPathElement;
  good: SVGGElement;
  shade: SVGRectElement;
}

/** Two Keycard readers; a seat swipes only the reader it holds on this pass. */
export function mount(host: PartySceneHost): Scene {
  const model = () => host.model as SwipeModel;
  const passes = host.layout.size;
  const slowest = host.layout.range ?? 0;
  const window = host.layout.window ?? 0;

  const view = board(
    host,
    `Two card readers that want ${plural(passes, "pass", "passes")}, each read by both within ${seconds(window)} of each other. Drag your reader's card through both gates at the speed its pass wants.`,
  );
  const root = view.root;
  root.classList.add("double-swipe");
  const bar = new PartyBar(
    host,
    `${seatName(host.seat)} of ${host.seats}. You swipe the reader you hold on the pass in hand; both readers must read it within ${seconds(window)} of each other.`,
  );

  let size: Size = { width: 0, height: 0 };
  let geo = geometry({ width: 1, height: 1 });
  let status: SVGTextElement | undefined;
  let lamps: SVGGElement[] = [];
  let strikes: SVGGElement[] = [];
  let drawn: Drawn[] = [];
  const cardX = [0, 0];
  const marks: (Read | undefined)[] = [undefined, undefined];
  const mark: number[] = [0, 0];
  let grab: { reader: number; dx: number } | undefined;
  let swipe: { t: number; right: boolean } | undefined;
  let lastT = 0;
  let refused: { reader: number; until: number } | undefined;
  let dead = false;

  function msX(r: Reader, ms: number): number {
    const fastest = model().fastest;
    const share = (ms - fastest) / Math.max(1, slowest - fastest);
    return r.x + r.width * Math.max(0, Math.min(1, share));
  }

  function build(): void {
    const m = model();
    status = text("status", size.width / 2, 20);
    lamps = Array.from({ length: passes }, (_, i) =>
      svg(
        "g",
        { transform: `translate(${8 + 66 + i * 22} ${geo.lamps})` },
        svg("circle", { r: 8 }),
        svg("path", { class: "read", d: "M-4,0L-1,3L5,-4" }),
      ),
    );
    const right = size.width - 8;
    strikes = Array.from({ length: m.strikes }, (_, i) =>
      svg(
        "g",
        { transform: `translate(${right - 8 - i * 18} ${geo.lamps})` },
        svg("circle", { r: 5 }),
        svg("path", { d: "M-5,-5L5,5M5,-5L-5,5" }),
      ),
    );
    root.append(
      status,
      text("label", 8, geo.lamps + 4, "Passes"),
      ...lamps,
      text("label end", right - 2 - m.strikes * 18, geo.lamps + 4, "Bad swipes"),
      ...strikes,
    );
    drawn = geo.readers.map((r, i) => {
      const { width: cw, height: ch } = r.card;
      const post = ch / 2 + 10;
      const name = text("label", r.x, geo.names[i]!);
      const tick = svg("path", { class: "tick" });
      const good = svg(
        "g",
        { class: "lamp", transform: `translate(${r.x + r.width - 8} ${geo.names[i]! - 4})` },
        svg("circle", { r: 7 }),
        svg("path", { class: "read", d: "M-4,0L-1,3L5,-4" }),
      );
      const card = svg(
        "g",
        { class: "card" },
        svg("rect", { x: -cw / 2, y: -ch / 2, width: cw, height: ch, rx: 6 }),
        svg("rect", { class: "stripe", x: -cw / 2, y: -ch / 2 + 10, width: cw, height: 12 }),
        svg("path", {
          class: "grip",
          d: `M${-cw * 0.22},${ch * 0.2}H${cw * 0.22}M${-cw * 0.22},${ch * 0.3}H${cw * 0.22}`,
        }),
      );
      const shade = svg("rect", {
        class: "theirs",
        x: r.x,
        y: r.top - 20,
        width: r.width,
        height: r.rail + post - r.top + 24,
      });
      root.append(
        name,
        good,
        svg("rect", { class: "track", x: r.x, y: r.top, width: r.width, height: r.bar }),
        tick,
        svg("rect", { class: "slot", x: r.x, y: r.rail - 8, width: r.width, height: 16 }),
        svg("path", {
          class: "gate",
          d: r.gates.map((g) => `M${g},${r.rail - post}V${r.rail + post}`).join(""),
        }),
        card,
        shade,
      );
      return { card, name, tick, good, shade };
    });
  }

  // The mark a reader's last swipe left on its gauge: a tick where it was
  // read, or an arrowhead pointing the way the next should move.
  function tickPath(r: Reader, read: Read | undefined, ms: number): string {
    if (!read) return "";
    const x = msX(r, ms);
    const y = r.top + r.bar / 2;
    if (read === "good") return `M${x - 5},${y}l3,4l7,-8`;
    const d = read === "fast" ? 1 : -1;
    return `M${x - d * 4},${y - 6}l${d * 8},6l${-d * 8},6`;
  }

  function line(m: SwipeModel): string {
    if (m.k >= passes) return "Every pass read.";
    const [a, b] = m.good as [number, number];
    if (a >= 0 && b < 0) return "Reader A has read: B now, quick.";
    if (b >= 0 && a < 0) return "Reader B has read: A now, quick.";
    return "Swipe both readers together.";
  }

  function frame(): void {
    const now = view.fit();
    const m = model();
    if (now) {
      size = playArea(now);
      geo = geometry(size);
      build();
      cardX[0] = geo.readers[0]!.min;
      cardX[1] = geo.readers[1]!.min;
    }
    bar.fit();
    say(status!, line(m));
    for (const [i, lamp] of lamps.entries())
      set(lamp, { class: i < m.k ? "lamp read" : i === m.k ? "lamp next" : "lamp" });
    for (const [i, s] of strikes.entries()) set(s, { class: i < m.bad ? "strike on" : "strike" });
    for (const [i, d] of drawn.entries()) {
      const r = geo.readers[i]!;
      const seat = m.readerSeat(i);
      const yours = seat === host.seat;
      say(d.name, `Reader ${letter(i)}: ${yours ? "you swipe" : `${seatName(seat)} swipes`}`);
      set(d.name, { class: yours ? "label yours" : "label" });
      set(d.shade, { class: yours ? "theirs off" : "theirs" });
      set(d.good, { class: m.good[i]! >= 0 ? "lamp read" : "lamp" });
      set(d.tick, {
        d: tickPath(r, marks[i], mark[i]!),
        class: marks[i] ? `tick ${marks[i]}` : "tick",
      });
      set(d.card, {
        class: `card${grab?.reader === i ? " held" : ""}`,
        transform: `translate(${cardX[i]} ${r.rail})`,
      });
    }
    for (let s = 0; s < host.seats; s++)
      bar.light(s, s === m.readerSeat(0) || s === m.readerSeat(1), "holds");
    if (refused && performance.now() > refused.until) refused = undefined;
    const mine = [0, 1].find((r) => m.readerSeat(r) === host.seat);
    bar.say(
      refused
        ? `${seatName(m.readerSeat(refused.reader))} swipes reader ${letter(refused.reader)} this pass.`
        : mine === undefined
          ? "Both readers are in other hands this pass."
          : `You swipe reader ${letter(mine)}.`,
    );
  }

  // The card left the gates: its time between them is the swipe.
  function read(reader: number, t: number): void {
    const m = model();
    const a = Math.max(1, Math.round(t - swipe!.t));
    // The readers changed hands on the pass just read: this one is no longer this seat's.
    if (m.readerSeat(reader) !== host.seat) {
      grab = undefined;
      return;
    }
    // A swipe the machine's clock has no room for was made before it ran.
    if (a > host.now() - m.last[reader]!) return;
    const how = m.read(reader, a);
    const st = host.move(a, reader);
    if (dead) return;
    marks[reader] = how;
    mark[reader] = a;
    if (st !== GOING) grab = undefined;
  }

  function travel(reader: number, to: number, t: number): void {
    const r = geo.readers[reader]!;
    for (const c of crossings(r.gates, cardX[reader]!, to)) {
      const at = lastT + (t - lastT) * c.share;
      if (c.enters) {
        if (host.now() === 0) host.arm();
        swipe = { t: at, right: to > cardX[reader]! };
        continue;
      }
      if (swipe && swipe.right === to > cardX[reader]!) read(reader, at);
      swipe = undefined;
    }
    cardX[reader] = to;
    lastT = t;
  }

  const unbind = pointers(host.surface, {
    down(p, ev) {
      const m = model();
      const hits = geo.readers.map((r, i) => grabs(r, cardX[i]!, p));
      const reader = hits.findIndex((h) => h.held);
      const near = hits.reduce((a, b) => (b.miss < a.miss ? b : a));
      const r = geo.readers[Math.max(0, reader)]!;
      host.dropped(near.miss, (r.card.width / 2) * PICKUP, reader >= 0, ev);
      if (reader < 0) return false;
      if (m.readerSeat(reader) !== host.seat) {
        refused = { reader, until: performance.now() + REFUSED_MS };
        return false;
      }
      grab = { reader, dx: p.x - cardX[reader]! };
      lastT = host.now();
      return true;
    },
    move(p) {
      if (!grab) return;
      const r = geo.readers[grab.reader]!;
      travel(grab.reader, Math.max(r.min, Math.min(r.max, p.x - grab.dx)), host.now());
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
      bar.remove();
    },
  };
}

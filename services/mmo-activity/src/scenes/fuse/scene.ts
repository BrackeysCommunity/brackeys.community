import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  HIT,
  PICKUP,
  dropped,
  glyph,
  glyphName,
  letter,
  nearest,
  pieceColour,
  pointers,
  set,
  sizeOf,
  svg,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import type { FuseModel } from "./model.ts";

const HINT_MS = 3000;
// The line over the cards that says how to read one.
const KEY = 22;

/** Where the cards and the fuses sit, in CSS px of the surface. */
export interface Geometry {
  r: number;
  fuses: Point[];
  /** Each clue card's top left corner, and the size they share. */
  cards: Point[];
  card: Size;
}

export function geometry(n: number, clues: number, size: Size): Geometry {
  const pad = 8;
  const inner = size.width - pad * 2;
  const perRow = inner / n >= HIT * 2 + 8 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / perRow);
  const slot = inner / perRow;
  const r = Math.max(HIT, Math.min(40, slot / 2 - 4, size.height * 0.085));
  const rowH = r * 2.5 + 26;
  const top = size.height - pad - rows * rowH;
  const fuses = Array.from({ length: n }, (_, i) => {
    const row = Math.trunc(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    return {
      x: size.width / 2 + ((i % perRow) - (inRow - 1) / 2) * slot,
      y: top + row * rowH + r * 1.25 + 4,
    };
  });
  const cols = Math.max(1, Math.min(clues, Math.floor(inner / 118)));
  const lines = Math.max(1, Math.ceil(clues / cols));
  const card = {
    width: Math.min(150, inner / cols - 6),
    height: Math.max(24, Math.min(44, (top - pad - KEY - 6) / lines - 6)),
  };
  const cards = Array.from({ length: clues }, (_, i) => {
    const row = Math.trunc(i / cols);
    const inRow = Math.min(cols, clues - row * cols);
    return {
      x: size.width / 2 + ((i % cols) - inRow / 2) * (card.width + 6) + 3,
      y: pad + KEY + row * (card.height + 6),
    };
  });
  return { r, fuses, cards, card };
}

/** The fuse a pointer is on, among those still in the box. */
export function pick(geo: Geometry, out: (fuse: number) => boolean, p: Point): number | undefined {
  const hit = nearest(geo.fuses, p);
  return hit.distance <= geo.r * PICKUP && !out(hit.index) ? hit.index : undefined;
}

interface Card {
  group: SVGGElement;
  before: number;
  after: number;
}

/**
 * A fuse box under a board of clue cards. Each card shows two fuses: the
 * left one comes out before the right one. A tap pulls a fuse, and the
 * wrong fuse blows the box, so the order is worked out before a hand
 * goes near it.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as FuseModel;
  const n = host.layout.size;
  const clues = host.layout.clues ?? [];

  const root = svg("svg", {
    class: "board fuse",
    role: "img",
    "aria-label":
      "A fuse box under a board of clue cards. On each card the left fuse comes out before the right one. Tap the fuses in an order that fits every card.",
  });
  host.surface.append(root);

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, clues.length, { width: 1, height: 1 });
  let fuses: SVGGElement[] = [];
  let cards: Card[] = [];
  let pressed: number | undefined;
  let hint: { move: PuzzleMove; until: number } | undefined;

  // A fuse as a card shows it: its mark in a ring, its letter beside it.
  function badge(fuse: number, at: Point, g: number): SVGGElement {
    const colour = pieceColour(fuse);
    const tag = svg("text", { class: "tag", x: at.x + g + 3, y: at.y, "font-size": g * 1.2 });
    tag.textContent = letter(fuse);
    return svg(
      "g",
      { class: "badge" },
      svg("circle", { cx: at.x, cy: at.y, r: g, stroke: colour }),
      glyph(fuse, at, g * 0.55, colour),
      tag,
    );
  }

  function build(): void {
    root.replaceChildren();
    set(root, {
      viewBox: `0 0 ${size.width} ${size.height}`,
      width: size.width,
      height: size.height,
    });
    const { r, card } = geo;
    const key = svg("text", { class: "key", x: size.width / 2, y: 8 + KEY * 0.6 });
    key.textContent = "On each card, left comes out before right";
    root.append(key);
    cards = clues.map((clue, i) => {
      const at = geo.cards[i]!;
      const mid = at.y + card.height / 2;
      const g = Math.max(8, Math.min(13, card.height * 0.34));
      // A badge is its ring and, after it, its letter.
      const wide = g * 3;
      const left = { x: at.x + 6 + g, y: mid };
      const right = { x: at.x + card.width - 6 - wide + g, y: mid };
      const from = left.x - g + wide + 5;
      const to = right.x - g - 5;
      const group = svg(
        "g",
        {
          class: "card",
          "aria-label": `Fuse ${letter(clue.before)} before fuse ${letter(clue.after)}`,
        },
        svg("rect", { x: at.x, y: at.y, width: card.width, height: card.height }),
        badge(clue.before, left, g),
        svg("path", {
          class: "then",
          d: `M${from},${mid}H${to}M${to - 6},${mid - 5}L${to},${mid}L${to - 6},${mid + 5}`,
        }),
        badge(clue.after, right, g),
      );
      return { group, before: clue.before, after: clue.after };
    });
    root.append(...cards.map((c) => c.group));
    fuses = geo.fuses.map((at, f) => {
      const colour = pieceColour(f);
      const tag = svg("text", { class: "tag", x: at.x, y: at.y + r * 1.25 + 14, "font-size": 15 });
      tag.textContent = letter(f);
      return svg(
        "g",
        { class: "plug", "aria-label": `Fuse ${letter(f)}, ${glyphName(f)}` },
        svg("rect", {
          class: "socket",
          x: at.x - r * 0.78,
          y: at.y - r * 1.25,
          width: r * 1.56,
          height: r * 2.5,
          rx: 6,
        }),
        svg("rect", {
          class: "body",
          x: at.x - r * 0.6,
          y: at.y - r * 1.05,
          width: r * 1.2,
          height: r * 2.1,
          rx: r * 0.3,
          stroke: colour,
        }),
        svg("path", {
          class: "caps",
          d: `M${at.x - r * 0.6},${at.y - r * 0.7}h${r * 1.2}M${at.x - r * 0.6},${at.y + r * 0.7}h${r * 1.2}`,
          stroke: colour,
        }),
        glyph(f, at, r * 0.36, colour),
        svg("path", {
          class: "tick",
          d: `M${at.x - r * 0.3},${at.y}L${at.x - r * 0.05},${at.y + r * 0.28}L${at.x + r * 0.38},${at.y - r * 0.28}`,
        }),
        svg("circle", { class: "ring", cx: at.x, cy: at.y, r: r * 1.45 }),
        tag,
      );
    });
    root.append(...fuses);
  }

  function frame(): void {
    const now = sizeOf(host.surface);
    if (now.width !== size.width || now.height !== size.height) {
      size = now;
      geo = geometry(n, clues.length, size);
      build();
    }
    if (hint && performance.now() > hint.until) hint = undefined;
    const m = model();
    for (const [f, node] of fuses.entries()) {
      const state = [
        "plug",
        m.pulled(f) ? "out" : "",
        pressed === f ? "pressed" : "",
        hint?.move.a === f ? "hinted" : "",
        host.guide?.a === f && m.k === 0 ? "guided" : "",
      ];
      set(node, { class: state.filter(Boolean).join(" ") });
    }
    // A card whose two fuses are both out has nothing left to say.
    for (const c of cards)
      set(c.group, { class: m.pulled(c.before) && m.pulled(c.after) ? "card spent" : "card" });
  }

  const unbind = pointers(host.surface, {
    down(p) {
      const f = pick(geo, (x) => model().pulled(x), p);
      if (f === undefined) return false;
      pressed = f;
      return true;
    },
    up(p, ev) {
      const f = pressed;
      pressed = undefined;
      if (f === undefined) return;
      // A finger that slides off before it lifts has thought better of it.
      const still = pick(geo, (x) => model().pulled(x), p) === f;
      dropped(
        "fuse",
        Math.hypot(p.x - geo.fuses[f]!.x, p.y - geo.fuses[f]!.y),
        geo.r * PICKUP,
        still,
        ev,
      );
      if (still) host.move(f);
    },
    cancel() {
      pressed = undefined;
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

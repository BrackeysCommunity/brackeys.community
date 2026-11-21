import "./scene.css";
import type { PuzzleMove } from "../../api.ts";
import {
  HIT,
  PICKUP,
  board,
  letter,
  reach,
  pointers,
  say,
  set,
  svg,
  text,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene, SceneHost } from "../../shell/kit.ts";
import { plural } from "../../units.ts";
import type { LeakModel } from "./model.ts";

// How long a knock on a dry joint shows, and the share of the gauge under
// which it is marked low.
const KNOCK_MS = 260;
const LOW = 0.3;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  r: number;
  slots: Point[];
  /** The gauge: its left edge, top, width and height. */
  x: number;
  top: number;
  width: number;
  bar: number;
}

export function geometry(n: number, size: Size): Geometry {
  const pad = 8;
  const head = 62;
  const room = Math.max(1, size.height - head - 22);
  const pitch = (size.width - pad * 2) / n;
  // A narrow pipe zigzags, so each joint keeps a thumb's width.
  const zig = pitch < 84;
  // The joints at either end keep their collar and spray on the surface.
  const r = Math.max(
    HIT,
    Math.min(40, zig ? pitch / 2 - 10 + pad : pitch * 0.4, room * (zig ? 0.14 : 0.2)),
  );
  return {
    r,
    slots: Array.from({ length: n }, (_, i) => ({
      x: pad + pitch * (i + 0.5),
      y: head + room * (zig ? (i % 2 ? 0.74 : 0.3) : 0.5),
    })),
    x: pad,
    top: 26,
    width: size.width - pad * 2,
    bar: 14,
  };
}

/** The joint a tap lands on, if it is near one, and how far it was from the nearest. */
export function land(geo: Geometry, p: Point): { slot: number | undefined; miss: number } {
  const { index, miss } = reach(geo.slots, p, geo.r);
  return { slot: index, miss };
}

type State = "dry" | "leak" | "held" | "sealed";

interface Joint {
  g: SVGGElement;
  word: SVGTextElement;
  pips: SVGCircleElement[];
  slip: SVGCircleElement;
  ring: SVGCircleElement;
}

/**
 * The pipe: joints along it spring leaks, and each is tapped shut. A leak
 * that needs more than one tap is held by a tap for a while, then slips.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as LeakModel;
  const n = host.layout.size;

  const view = board(
    host,
    `A pipe with ${plural(n, "joint")}. Tap each leak shut as it springs, before the pressure runs out. A tap on a dry joint knocks pressure out.`,
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 });
  let joints: Joint[] = [];
  let sprung: SVGCircleElement[] = [];
  let label: SVGTextElement | undefined;
  let fill: SVGRectElement | undefined;
  let coming: PuzzleMove | undefined;
  const knocked: number[] = Array.from({ length: n }, () => 0);

  function build(): void {
    const { r, slots } = geo;
    label = text("label", geo.x, 18);
    fill = svg("rect", { class: "fill", x: geo.x, y: geo.top, width: 0, height: geo.bar });
    const leaks = model().leaks;
    sprung = Array.from({ length: leaks }, (_, i) =>
      svg("circle", { class: "count", cx: geo.x + 64 + i * 14, cy: geo.top + geo.bar + 14, r: 4 }),
    );
    const run = slots.map((s) => `L${s.x},${s.y}`).join("");
    root.append(
      label,
      svg("rect", { class: "track", x: geo.x, y: geo.top, width: geo.width, height: geo.bar }),
      fill,
      text("label small", geo.x, geo.top + geo.bar + 18, "Leaks"),
      ...sprung,
      svg("path", {
        class: "pipe",
        d: `M0,${slots[0]!.y}${run}L${size.width},${slots.at(-1)!.y}`,
        "stroke-width": r * 0.7,
      }),
      text(
        "legend",
        size.width / 2,
        size.height - 8,
        "Tap each leak shut. A dry joint tapped costs pressure.",
      ),
    );
    joints = slots.map((s, i) => {
      const spray = [-60, -30, 0, 30, 60]
        .map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const [x, y] = [Math.cos(rad), Math.sin(rad)];
          return `M${x * (r + 5)},${y * (r + 5)}L${x * (r + 18)},${y * (r + 18)}`;
        })
        .join("");
      const tag = text("tag", 0, 0, letter(i));
      set(tag, { "font-size": r * 0.7 });
      const pips = [0, 1, 2].map(() => svg("circle", { class: "pip", cy: r + 12, r: 4 }));
      const word = text("word", 0, r + 34);
      const slip = svg("circle", { class: "slip", r: r + 6, pathLength: 100 });
      const ring = svg("circle", { class: "ring", r: r + 12 });
      const g = svg(
        "g",
        { transform: `translate(${s.x} ${s.y})`, "aria-label": `Joint ${letter(i)}` },
        ring,
        svg("circle", { class: "collar", r }),
        svg("path", { class: "spray", d: spray }),
        svg("path", { class: "clamp", d: `M${-r - 4},${-r * 0.3}V${-r - 6}H${r + 4}V${-r * 0.3}` }),
        slip,
        svg("path", {
          class: "patch",
          d: `M${-r * 0.5},${-r * 0.5}L${r * 0.5},${r * 0.5}M${r * 0.5},${-r * 0.5}L${-r * 0.5},${r * 0.5}`,
        }),
        tag,
        ...pips,
        word,
      );
      root.append(g);
      return { g, word, pips, slip, ring };
    });
  }

  function state(m: LeakModel, slot: number): State {
    if (m.open(slot)) return "leak";
    if (m.left[slot]! > 0) return "held";
    return m.sealed(slot) ? "sealed" : "dry";
  }

  function frame(at: number): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(n, size);
      build();
    }
    const m = model();
    const clock = performance.now();
    // A hint names a leak to come, and stays until that leak has sprung.
    const lit = host.hinted();
    if (lit) coming = lit;
    else if (coming && at >= coming.at) coming = undefined;
    const hint = coming;
    const share = Math.max(0, m.gauge) / Math.max(1, m.full);
    say(label!, share < LOW ? "Pressure low!" : "Pressure");
    set(label!, { class: share < LOW ? "label low" : "label" });
    set(fill!, { width: geo.width * share, class: share < LOW ? "fill low" : "fill" });
    for (const [i, dot] of sprung.entries()) set(dot, { class: i < m.next ? "count on" : "count" });
    for (const [i, j] of joints.entries()) {
      const st = state(m, i);
      const marked =
        hint?.a === i ? " hinted" : host.guide?.a === i && m.next === 0 ? " guided" : "";
      set(j.g, { class: `joint ${st}${clock < knocked[i]! ? " knocked" : ""}${marked}` });
      say(j.word, st === "dry" ? (marked === " hinted" ? "next" : "") : st);
      // A pip for each tap the leak still needs, in a row under the joint.
      const taps = m.left[i]!;
      for (const [k, pip] of j.pips.entries())
        set(pip, { class: k < taps ? "pip on" : "pip", cx: (k - (taps - 1) / 2) * 12 });
      // The ring round a held leak runs down as its clamp slips.
      const hold = Math.max(1, m.holds(i));
      const left = st === "held" ? Math.max(0, m.until[i]! - m.n) / hold : 0;
      set(j.slip, { "stroke-dasharray": `${Math.round(left * 100)} 100` });
    }
  }

  const unbind = pointers(host.surface, {
    down(p, ev) {
      const { slot, miss } = land(geo, p);
      host.dropped(miss, geo.r * PICKUP, slot !== undefined, ev);
      if (slot === undefined) return false;
      // The first touch only starts the pipe groaning: nothing leaks yet.
      if (host.now() === 0) {
        host.arm();
        return false;
      }
      if (!model().open(slot)) knocked[slot] = performance.now() + KNOCK_MS;
      host.move(slot);
      // A tap holds nothing, so a second finger can tap while this one is down.
      return false;
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

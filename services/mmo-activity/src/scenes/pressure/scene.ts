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
import { GOING, type Model, type Scene, type SceneHost } from "../../shell/kit.ts";
import { plural, seconds } from "../../units.ts";
import type { PressureModel } from "./model.ts";

/** The px a wheel is dragged for one turn of its valve. */
export const NOTCH = 24;

// The degrees a wheel is drawn turning a notch, and how fast a drawn
// needle follows the model's.
const NOTCH_DEG = 30;
const EASE = 0.3;

/** Where everything sits, in CSS px of the surface. */
export interface Geometry {
  r: number;
  wheels: Point[];
  /** The gauges' tubes: the y of a full and of an empty needle, and their width. */
  top: number;
  bottom: number;
  tube: number;
  /** The baselines of the line above the gauges and the two under the wheels. */
  head: number;
  foot: number;
}

export function geometry(n: number, size: Size): Geometry {
  const pad = 8;
  const col = (size.width - pad * 2) / n;
  const r = Math.max(HIT, Math.min(40, col * 0.38, size.height * 0.11));
  const foot = size.height - 24;
  const y = foot - 32 - r;
  return {
    r,
    wheels: Array.from({ length: n }, (_, i) => ({ x: pad + col * (i + 0.5), y })),
    top: 44,
    bottom: Math.max(84, y - r - 40),
    tube: Math.max(16, Math.min(30, col * 0.34)),
    head: 20,
    foot,
  };
}

/** The y a needle at a value is drawn at. */
export function needleY(geo: Geometry, value: number, range: number): number {
  const share = Math.max(0, Math.min(1, value / Math.max(1, range)));
  return geo.bottom - (geo.bottom - geo.top) * share;
}

/** The valve whose wheel a pointer picks up, and how far it was from the nearest. */
export function pick(geo: Geometry, p: Point): { valve: number | undefined; miss: number } {
  const { index, miss } = reach(geo.wheels, p, geo.r);
  return { valve: index, miss };
}

interface Drag {
  valve: number;
  /** The y the next notch is measured from. */
  from: number;
  y: number;
}

interface Column {
  needle: SVGPathElement;
  state: SVGTextElement;
  wheel: SVGGElement;
  pull: SVGPathElement;
}

/**
 * The boiler: a row of gauges, each over the wheel of its valve. A wheel
 * dragged up opens the valve, which lifts its own needle and drops the
 * ones beside it; dragged down, it closes.
 */
export function mount(host: SceneHost): Scene {
  const model = () => host.model as PressureModel;
  const n = host.layout.size;
  const range = host.layout.range ?? 0;
  const goal = host.layout.goal;

  const view = board(
    host,
    `A boiler with ${plural(n, "valve")}. Drag a wheel up to open its valve: its needle rises and the needles beside it fall. Hold every needle in its band.`,
  );
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 });
  let columns: Column[] = [];
  let status: SVGTextElement | undefined;
  let holdBar: SVGRectElement | undefined;
  let guide: SVGPathElement | undefined;
  let lit: SVGPathElement | undefined;
  let drag: Drag | undefined;
  // What is drawn of a model: eased needles, and how far each wheel has turned.
  let seen: Model | undefined;
  let shown: number[] = [];
  let turned: number[] = [];
  let touched = false;

  // An arrowhead above a point (dir 1) or below it (dir -1).
  function chevron(at: Point, dir: number, w: number): string {
    const tip = at.y - dir * w * 0.6;
    const base = at.y + dir * w * 0.4;
    return `M${at.x - w},${base}L${at.x},${tip}L${at.x + w},${base}`;
  }

  function build(): void {
    const m = model();
    const { r, top, bottom, tube } = geo;
    status = text("status", size.width / 2, geo.head, "");
    holdBar = svg("rect", { class: "hold", x: 8, y: geo.head + 8, width: 0, height: 5 });
    root.append(
      status,
      svg("rect", {
        class: "hold-track",
        x: 8,
        y: geo.head + 8,
        width: size.width - 16,
        height: 5,
      }),
      holdBar,
      text("legend", size.width / 2, geo.foot, "Drag a wheel up to open its valve."),
      text("legend", size.width / 2, geo.foot + 16, "Its needle rises; the ones beside it fall."),
    );
    columns = geo.wheels.map((w, i) => {
      const x = w.x - tube / 2;
      const hi = needleY(geo, m.hi, range);
      const lo = needleY(geo, m.lo, range);
      // The top of the tube is where a needle bursts the machine.
      const burst = `M${x - 4},${top}l${(tube + 8) / 4},-6l${(tube + 8) / 4},6l${(tube + 8) / 4},-6l${(tube + 8) / 4},6`;
      root.append(
        svg("rect", { class: "tube", x, y: top, width: tube, height: bottom - top }),
        svg("path", { class: "burst", d: burst }),
        svg("rect", { class: "band", x: x - 5, y: hi, width: tube + 10, height: lo - hi }),
      );
      if (i === goal && m.leaks)
        root.append(
          svg("path", {
            class: "drip",
            "aria-label": "This needle leaks",
            d: `M${x + tube + 12},${bottom - 22}c-8,11 -8,18 0,18c8,0 8,-7 0,-18Z`,
          }),
        );
      const needle = svg("path", { class: "needle" });
      const pull = svg("path", { class: "pull" });
      const state = text("state", w.x, bottom + 20, "");
      const wheel = svg(
        "g",
        { class: "wheel", "aria-label": `Valve ${letter(i)}` },
        svg("circle", { r }),
        svg("path", { class: "spokes", d: `M${-r},0H${r}M0,${-r}V${r}` }),
        svg("circle", { class: "hub", r: r * 0.42 }),
      );
      const tag = text("tag", w.x, w.y, letter(i));
      set(tag, { "font-size": r * 0.55 });
      root.append(
        needle,
        pull,
        state,
        svg("path", { class: "way", d: chevron({ x: w.x, y: w.y - r - 9 }, 1, 7) }),
        svg("path", { class: "way", d: chevron({ x: w.x, y: w.y + r + 9 }, -1, 7) }),
        wheel,
        tag,
      );
      return { needle, state, wheel, pull };
    });
    guide = svg("path", { class: "guide" });
    lit = svg("path", { class: "hint" });
    root.append(guide, lit);
  }

  // The arrow a guide or a hint draws beside a wheel: which way to drag it.
  function arrow(move: PuzzleMove | undefined): string {
    const w = move && geo.wheels[move.a];
    if (!move || !w) return "";
    const dir = (move.b ?? 0) < 0 ? -1 : 1;
    const x = w.x + geo.r * 0.62;
    const tail = w.y + dir * geo.r * 0.6;
    const tip = w.y - dir * geo.r * 0.6;
    return `M${x},${tail}V${tip}${chevron({ x, y: tip + dir * 5 }, dir, 8)}`;
  }

  // One more turn of its valve would burst a needle marked "bursting".
  function label(v: number, m: PressureModel): string {
    if (v + m.nudge >= range) return "bursting";
    if (v > m.hi) return "high";
    return v < m.lo ? "low" : "ok";
  }

  function frame(): void {
    const now = view.fit();
    const m = model();
    if (m !== seen) {
      seen = m;
      shown = [...m.v];
      turned = m.v.map(() => 0);
      touched = false;
      drag = undefined;
    }
    if (now) {
      size = now;
      geo = geometry(n, size);
      build();
    }
    const tube = geo.tube;
    for (const [i, c] of columns.entries()) {
      const v = m.v[i]!;
      const gap = v - shown[i]!;
      shown[i] = Math.abs(gap) < 0.2 ? v : shown[i]! + gap * EASE;
      const w = geo.wheels[i]!;
      const y = needleY(geo, shown[i]!, range);
      const x = w.x - tube / 2;
      set(c.needle, { d: `M${x - 9},${y - 6}L${x - 1},${y}L${x - 9},${y + 6}ZM${x},${y}h${tube}` });
      const word = label(v, m);
      say(c.state, word);
      set(c.state, { class: `state ${word}` });
      const held = drag?.valve === i;
      const part = held ? ((drag!.from - drag!.y) / NOTCH) * NOTCH_DEG : 0;
      set(c.wheel, {
        class: held ? "wheel held" : "wheel",
        transform: `translate(${w.x} ${w.y}) rotate(${turned[i]! + part})`,
      });
      // While a wheel is held, each gauge shows which way opening it pushes.
      const pulls = drag ? (held ? 1 : Math.abs(drag.valve - i) === 1 ? -1 : 0) : 0;
      set(c.pull, {
        d: pulls
          ? chevron({ x: w.x + tube / 2 + 12, y: (geo.top + geo.bottom) / 2 }, pulls, 6)
          : "",
      });
    }
    const left = (m.hold - m.held) * (host.layout.step ?? 0);
    const line =
      m.held >= m.hold
        ? "Held in the band."
        : m.held > 0
          ? `In the band. Hold it for ${seconds(left)}.`
          : "Bring every needle into its band.";
    say(status!, line);
    set(holdBar!, {
      width: ((size.width - 16) * Math.min(m.held, m.hold)) / Math.max(1, m.hold),
    });
    set(guide!, { d: touched ? "" : arrow(host.guide) });
    const hint = host.hinted();
    set(lit!, { d: arrow(hint) });
  }

  function turn(valve: number, dir: number): boolean {
    touched = true;
    turned[valve]! += dir * NOTCH_DEG;
    return host.move(valve, dir) === GOING;
  }

  const unbind = pointers(host.surface, {
    down(p, ev) {
      const { valve, miss } = pick(geo, p);
      host.dropped(miss, geo.r * PICKUP, valve !== undefined, ev);
      if (valve === undefined) return false;
      drag = { valve, from: p.y, y: p.y };
      return true;
    },
    move(p) {
      if (!drag) return;
      drag.y = p.y;
      // Up the screen opens the valve, a notch at a time.
      while (drag && Math.abs(drag.from - drag.y) >= NOTCH) {
        const dir = drag.from > drag.y ? 1 : -1;
        drag.from -= dir * NOTCH;
        if (!turn(drag.valve, dir)) drag = undefined;
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
    },
  };
}

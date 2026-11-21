import "./party.css";
import type { PuzzleLayout, PuzzleMove } from "../api.ts";
import { board, say, set, svg, text, type Board, type Size } from "../shell/board.ts";
import { GOING, type Model, type SceneHost } from "../shell/kit.ts";
import type { PartySceneHost } from "../shell/party-registry.ts";

/** The strip under a family's board where a party scene says what this seat holds. */
export const BAR = 52;

/** The play area a family's board is given: the surface less the bar. */
export function playArea(size: Size): Size {
  return { width: size.width, height: Math.max(1, size.height - BAR) };
}

/** One seat's part of a family machine, as its family scene is shown it. */
export interface Part {
  /** What the family scene reads in place of the merged model. */
  model(): Model;
  /** The cut of the layout the family scene draws, when it is not the seat's whole part. */
  layout?: PuzzleLayout;
  /** Whether a family move is this seat's to make now. */
  mine(a: number, b: number, c: number): boolean;
  /** A family move as the merged machine numbers it. */
  out?(a: number, b: number, c: number): [number, number, number];
  /** A merged move as the family numbers it, or none when it is not on this seat's cut. */
  in?(m: PuzzleMove): PuzzleMove | undefined;
}

// The surface as a family scene sees it: the same element, measured short
// of the bar, so the family lays out above it and the bar stays clear.
function above(surface: HTMLElement): HTMLElement {
  return new Proxy(surface, {
    get(target, key) {
      if (key === "getBoundingClientRect")
        return () => {
          const r = target.getBoundingClientRect();
          return new DOMRect(r.left, r.top, r.width, Math.max(1, r.height - BAR));
        };
      const v: unknown = Reflect.get(target, key, target);
      return typeof v === "function" ? (v as (...xs: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/**
 * The host a family scene is mounted on for one seat: moves off the seat's
 * part are never made, so nothing a stale screen presses reaches the
 * machine, and the seat stamp and the ms are the party host's.
 */
export function familyHost(host: PartySceneHost, part: Part): SceneHost {
  const into = (m: PuzzleMove | undefined) => (m && part.in ? part.in(m) : m);
  return {
    surface: above(host.surface),
    layout: part.layout ?? host.layout,
    get model() {
      return part.model();
    },
    compact: host.compact,
    guide: into(host.guide),
    move(a, b = 0, c = 0) {
      if (!part.mine(a, b, c)) return GOING;
      const [x, y, z] = part.out ? part.out(a, b, c) : [a, b, c];
      return host.move(x, y, z);
    },
    arm: () => host.arm(),
    now: () => host.now(),
    hinted: () => into(host.hinted()),
    dropped: (miss, hit, landed, ev) => host.dropped(miss, hit, landed, ev),
  };
}

/** A seat's lamp in the bar: its number, lit or not, and marked when it is this screen's. */
export interface Lamp {
  group: SVGGElement;
  ring: SVGCircleElement;
}

/**
 * The bar under the family's board: one line saying what this seat holds
 * now, and a lamp for every seat. It is redrawn when the surface changes
 * size; the scene keeps what it puts in it in step each frame.
 */
export class PartyBar {
  readonly view: Board;
  size: Size = { width: 0, height: 0 };
  lamps: Lamp[] = [];
  private line: SVGTextElement | undefined;

  constructor(
    private readonly host: PartySceneHost,
    label: string,
  ) {
    this.view = board(host, label);
    this.view.root.classList.add("party-bar");
  }

  /** The bar's top edge, in CSS px of the surface. */
  get top(): number {
    return Math.max(0, this.size.height - BAR);
  }

  /** Fits the bar; true when it was rebuilt and a scene's own bar pieces must be added again. */
  fit(): boolean {
    const now = this.view.fit();
    if (!now) return false;
    this.size = now;
    const root = this.view.root;
    const { seats, seat } = this.host;
    const r = Math.min(13, BAR / 4);
    const gap = r * 2.6;
    root.append(
      svg("rect", { class: "pb-strip", x: 0, y: this.top, width: now.width, height: BAR }),
    );
    this.lamps = Array.from({ length: seats }, (_, s) => {
      const cx = now.width - 12 - r - (seats - 1 - s) * gap;
      const ring = svg("circle", { class: "pb-lamp", cx, cy: this.top + BAR / 2, r });
      const tag = text("pb-tag", cx, this.top + BAR / 2, String(s + 1));
      const group = svg("g", { class: s === seat ? "pb-seat you" : "pb-seat" }, ring, tag);
      root.append(group);
      return { group, ring };
    });
    this.line = text("pb-say", 12, this.top + BAR / 2);
    root.append(this.line);
    return true;
  }

  /** The line's text. */
  say(line: string): void {
    if (this.line) say(this.line, line);
  }

  /** Lights a seat's lamp, or puts it out. */
  light(s: number, on: boolean, cls = "on"): void {
    const lamp = this.lamps[s];
    if (lamp)
      set(lamp.group, {
        class: `pb-seat${s === this.host.seat ? " you" : ""}${on ? ` ${cls}` : ""}`,
      });
  }

  /** Where the line ends: room left of the lamps for a scene's own control. */
  get room(): number {
    return Math.max(0, this.size.width - 24 - this.lamps.length * Math.min(13, BAR / 4) * 2.6);
  }

  remove(): void {
    this.view.remove();
  }
}

/** "Seat 2": how a screen names another seat; seats count from one on screen. */
export function seatName(s: number): string {
  return `Seat ${s + 1}`;
}

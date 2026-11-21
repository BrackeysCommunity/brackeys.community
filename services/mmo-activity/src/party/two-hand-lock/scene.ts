import type { PuzzleMove } from "../../api.ts";
import lockDial from "../../scenes/lock-dial/index.ts";
import { geometry, holdAt } from "../../scenes/lock-dial/scene.ts";
import { letter, set, svg, text } from "../../shell/board.ts";
import type { Model, Scene, Status } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { PartyBar, familyHost, playArea, seatName } from "../wrap.ts";
import { dialHolder, type TwoHandModel } from "./model.ts";

// The merged lock as the family's dials read it for one seat: a dial set
// and waiting for its pair counts as turned, so the family shows no slip
// for it, and only this seat's dials click.
class Hands implements Model {
  constructor(
    private readonly merged: () => TwoHandModel,
    private readonly seat: number,
    private readonly seats: number,
  ) {}

  get k(): number {
    const m = this.merged();
    return m.k + m.click.filter((at) => at >= 0).length;
  }

  clicks(a: number, b: number, c: number): boolean {
    const m = this.merged();
    return (
      dialHolder(a, this.seats) === this.seat && m.clickedAt(a) === undefined && m.sets(a, b, c)
    );
  }

  run(at: number): [Status, number] {
    return this.merged().run(at);
  }

  apply(m: PuzzleMove): Status {
    return this.merged().apply({ ...m, seat: this.seat });
  }

  snapshot(): number[] {
    return this.merged().snapshot();
  }
}

/** Which dials stand open, which wait for their pair, and which are to turn now. */
export function dialState(m: TwoHandModel, d: number): "open" | "next" | "" {
  const { first, size } = m.pair();
  if (d < m.k) return "open";
  if (d < first || d >= first + size) return "";
  return m.clickedAt(d) === undefined ? "next" : "open";
}

/**
 * The safe for two hands: the family's dials, where each seat turns only
 * its own, and a pair holds only when both are set inside the window.
 * Every screen shows the pair to turn, who holds each dial, and a ring on
 * a dial that is set and waiting for its partner.
 */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as TwoHandModel;
  const layout = host.layout;
  const n = layout.size;
  const shape = layout.shape ?? 0;
  const hands = new Hands(merged, host.seat, host.seats);
  const lock = lockDial.mount(
    familyHost(host, {
      model: () => hands,
      mine: (a) => dialHolder(a, host.seats) === host.seat,
    }),
  );
  const bar = new PartyBar(
    host,
    "Safe dials for several hands. The dials open in pairs: each seat turns its own dial, and a pair holds only when both are set close together.",
  );
  let waits: SVGCircleElement[] = [];

  function build(): void {
    const geo = geometry(n, playArea(bar.size), shape);
    waits = geo.dials.map((c, d) => {
      const r = geo.bands ? holdAt(geo, d) : geo.r * 1.04;
      const band = geo.bands?.[d];
      const tagAt = band
        ? { x: c.x - (band.inner + band.outer) / 2, y: c.y }
        : { x: c.x + geo.r * 0.72, y: c.y - geo.r * 0.72 };
      bar.view.root.append(
        text("held-tag", tagAt.x, tagAt.y, String(dialHolder(d, host.seats) + 1)),
      );
      const ring = svg("circle", { class: "held", cx: c.x, cy: c.y, r, display: "none" });
      bar.view.root.append(ring);
      return ring;
    });
  }

  // The family draws a single dial in turn; a pair has two, set in any order.
  function mark(m: TwoHandModel): void {
    const root = host.surface.querySelector("svg.board:not(.party-bar)");
    const groups = root ? [...root.querySelectorAll(":scope > g.dial")] : [];
    for (const [d, g] of groups.entries()) {
      const keep = [...g.classList].filter((c) => c !== "open" && c !== "next");
      const state = dialState(m, d);
      set(g, { class: [...keep, state].filter(Boolean).join(" ") });
    }
  }

  function line(m: TwoHandModel): string {
    const { first, size } = m.pair();
    const pair = Array.from({ length: size }, (_, i) => first + i);
    const mine = pair.find((d) => dialHolder(d, host.seats) === host.seat);
    const others = pair.filter((d) => d !== mine).map((d) => dialHolder(d, host.seats));
    const partner = others.length > 0 ? ` with ${others.map(seatName).join(", ")}` : "";
    if (mine === undefined)
      return `${pair.map((d) => seatName(dialHolder(d, host.seats))).join(" and ")} turn ${pair.map(letter).join(" and ")}`;
    if (m.clickedAt(mine) !== undefined) return `Dial ${letter(mine)} set · waiting${partner}`;
    return `Turn dial ${letter(mine)}${partner}`;
  }

  return {
    frame(at) {
      lock.frame(at);
      if (bar.fit()) build();
      const m = merged();
      mark(m);
      for (const [d, ring] of waits.entries())
        set(ring, { display: m.clickedAt(d) === undefined ? "none" : "inline" });
      bar.say(line(m));
      const { first, size } = m.pair();
      for (let s = 0; s < host.seats; s++) {
        const dials = Array.from({ length: size }, (_, i) => first + i).filter(
          (d) => dialHolder(d, host.seats) === s,
        );
        const set = dials.some((d) => m.clickedAt(d) !== undefined);
        bar.light(s, dials.length > 0, set ? "on" : "holds");
      }
    },
    destroy() {
      lock.destroy();
      bar.remove();
    },
  };
}

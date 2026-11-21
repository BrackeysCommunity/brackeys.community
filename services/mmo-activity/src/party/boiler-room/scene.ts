import "./scene.css";
import { geometry, mount as mountPressure, pick } from "../../scenes/pressure/scene.ts";
import { letter, pointIn, set, sizeOf, svg, text, type Point } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { PartyBar, familyHost, playArea, seatName } from "../wrap.ts";
import { valveSeat } from "./model.ts";

// How long a touch on another seat's wheel is answered in the bar.
const REFUSED_MS = 1200;

// An arrowhead above a point (dir 1) or below it (dir -1).
function chevron(at: Point, dir: number, w: number): string {
  const tip = at.y - dir * w * 0.6;
  const base = at.y + dir * w * 0.4;
  return `M${at.x - w},${base}L${at.x},${tip}L${at.x + w},${base}`;
}

/**
 * The boiler room: Pressure's gauges and wheels with every needle coupled
 * to every valve, and each valve in one seat's hands. A seat turns only
 * its own wheels; while it holds one, every other gauge shows its needle
 * falling.
 */
export function mount(host: PartySceneHost): Scene {
  const n = host.layout.size;
  const mine = Array.from({ length: n }, (_, v) => v).filter(
    (v) => valveSeat(v, host.seats) === host.seat,
  );
  const yours = mine.map(letter).join(", ");

  // The wheel this seat holds, while a finger is on it. Caught before the
  // family scene sees the touch, so another seat's wheel never turns here.
  let holding: number | undefined;
  let refused: { valve: number; until: number } | undefined;
  const down = (ev: PointerEvent) => {
    const geo = geometry(n, playArea(sizeOf(host.surface)));
    const { valve } = pick(geo, pointIn(host.surface, ev));
    if (valve === undefined || valveSeat(valve, host.seats) === host.seat) {
      holding = valve;
      return;
    }
    refused = { valve, until: performance.now() + REFUSED_MS };
    ev.stopImmediatePropagation();
  };
  const up = () => {
    holding = undefined;
  };
  host.surface.addEventListener("pointerdown", down, { capture: true });
  host.surface.addEventListener("pointerup", up);
  host.surface.addEventListener("pointercancel", up);

  // Boiler room couples everyone on either shape, so the family draws its
  // line of valves.
  const family = mountPressure(
    familyHost(host, {
      model: () => host.model,
      layout: { ...host.layout, shape: 0 },
      mine: (a) => valveSeat(a, host.seats) === host.seat,
    }),
  );
  host.surface.querySelector("svg.board.pressure")?.classList.add("party-family");
  const bar = new PartyBar(
    host,
    `${seatName(host.seat)} of ${host.seats}. Your valves are ${yours}. A turn of any valve moves every needle: its own up, all the others down.`,
  );
  bar.view.root.classList.add("boiler-room");

  let pulls: SVGPathElement[] = [];

  function build(): void {
    const geo = geometry(n, playArea(bar.size));
    for (const [v, w] of geo.wheels.entries()) {
      const seat = valveSeat(v, host.seats);
      bar.view.root.append(
        svg(
          "g",
          { class: seat === host.seat ? "valve yours" : "valve" },
          svg("circle", { class: "theirs", cx: w.x, cy: w.y, r: geo.r + 4 }),
          text("held-tag", w.x, w.y + geo.r + 22, seat === host.seat ? "You" : seatName(seat)),
        ),
      );
    }
    pulls = geo.wheels.map(() => svg("path", { class: "every" }));
    bar.view.root.append(...pulls);
  }

  function frame(at: number): void {
    family.frame(at);
    if (bar.fit()) build();
    const geo = geometry(n, playArea(bar.size));
    // Opening the held valve lifts its needle and drops every other one.
    for (const [v, p] of pulls.entries()) {
      const w = geo.wheels[v]!;
      const dir = holding === undefined ? 0 : holding === v ? 1 : -1;
      const mid = { x: w.x + geo.tube / 2 + 12, y: (geo.top + geo.bottom) / 2 };
      set(p, { d: dir ? chevron(mid, dir, 6) : "" });
    }
    if (refused && performance.now() > refused.until) refused = undefined;
    bar.say(
      refused
        ? `${seatName(valveSeat(refused.valve, host.seats))} holds valve ${letter(refused.valve)}.`
        : `Your valves: ${yours}. Every turn moves every needle.`,
    );
  }

  return {
    frame,
    destroy() {
      host.surface.removeEventListener("pointerdown", down, { capture: true });
      host.surface.removeEventListener("pointerup", up);
      host.surface.removeEventListener("pointercancel", up);
      family.destroy();
      bar.remove();
    },
  };
}

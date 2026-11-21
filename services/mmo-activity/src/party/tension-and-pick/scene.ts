import lockPins from "../../scenes/lock-pins/index.ts";
import { pointers, say, set, svg, text, type Point } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { BAR, PartyBar, familyHost, seatName } from "../wrap.ts";
import { ON, PICK, PIN, TENSION, type TensionPickModel } from "./model.ts";

/** Where the tension lever sits in the bar: the room left of the lamps. */
export interface Lever {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function leverIn(bar: PartyBar): Lever {
  return { x: 8, y: bar.top + 6, width: Math.max(80, bar.room - 16), height: BAR - 12 };
}

function inside(l: Lever, p: Point): boolean {
  return p.x >= l.x && p.x <= l.x + l.width && p.y >= l.y && p.y <= l.y + l.height;
}

/** The family's lock for the pick seat, and the tension lever in the bar for the other. */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as TensionPickModel;
  const lock = lockPins.mount(
    familyHost(host, {
      model: () => merged(),
      mine: () => merged().role(PICK) === host.seat,
      in: (m) => ((m.c ?? PIN) === PIN ? m : undefined),
    }),
  );
  const bar = new PartyBar(
    host,
    "A pin lock for two hands at a time: one seat pulls the tension lever, another lifts the binding pin before the tension slips. Every pin set passes both roles on.",
  );
  let lever: Lever = leverIn(bar);
  let control: SVGGElement | undefined;
  let fill: SVGRectElement | undefined;
  let label: SVGTextElement | undefined;

  function build(): void {
    lever = leverIn(bar);
    fill = svg("rect", {
      class: "pb-fill",
      x: lever.x,
      y: lever.y,
      height: lever.height,
      width: 0,
    });
    label = text("", lever.x + lever.width / 2, lever.y + lever.height / 2);
    control = svg(
      "g",
      { class: "pb-control", "aria-label": "The tension lever" },
      svg("rect", { x: lever.x, y: lever.y, width: lever.width, height: lever.height, rx: 6 }),
      fill,
      label,
    );
    bar.view.root.append(control);
  }

  const unbind = pointers(host.surface, {
    down(p) {
      if (merged().role(TENSION) !== host.seat || !inside(lever, p)) return false;
      host.move(0, 0, ON);
      return true;
    },
  });

  return {
    frame(at) {
      lock.frame(at);
      if (bar.fit()) build();
      const m = merged();
      const now = host.now();
      const tense = m.tense(now);
      const tensioner = m.role(TENSION);
      const mine = tensioner === host.seat;
      const left = tense ? 1 - (now - m.ten) / Math.max(1, host.layout.window ?? 1) : 0;
      set(control!, {
        class: `pb-control${mine ? (tense ? " pressed" : " live") : " idle"}`,
        display: mine ? "inline" : "none",
      });
      set(fill!, { width: lever.width * Math.max(0, Math.min(1, left)) });
      say(label!, tense ? "Tension on" : "Pull tension");
      if (mine) bar.say("");
      else if (m.role(PICK) === host.seat)
        bar.say(tense ? "Lift the binding pin now" : `Wait for ${seatName(tensioner)}'s tension`);
      else bar.say(`${seatName(m.role(PICK))} picks, ${seatName(tensioner)} holds tension`);
      for (let s = 0; s < host.seats; s++)
        bar.light(
          s,
          s === tensioner ? tense : s === m.role(PICK),
          s === tensioner ? "on" : "holds",
        );
    },
    destroy() {
      unbind();
      lock.destroy();
      bar.remove();
    },
  };
}

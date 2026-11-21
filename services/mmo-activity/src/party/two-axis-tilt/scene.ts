import lockMaze from "../../scenes/lock-maze/index.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { PartyBar, familyHost, seatName } from "../wrap.ts";
import { HEX, type TwoAxisModel } from "./model.ts";

// Each axis by the sides it joins, as a tilt numbers them.
const SQUARE_AXES = ["east–west", "south–north"];
const HEX_AXES = ["east–west", "SE–NW", "SW–NE"];

/**
 * The tumbler maze tipped by several hands: the family's maze, where a
 * swipe only tips the box along the axis this seat holds. The bar says
 * which axis that is, and when the axes pass on.
 */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as TwoAxisModel;
  const layout = host.layout;
  const names = layout.shape === HEX ? HEX_AXES : SQUARE_AXES;
  const pass = layout.pass ?? 0;
  const maze = lockMaze.mount(
    familyHost(host, {
      model: () => merged().maze,
      mine: (a) => merged().tilter(a) === host.seat,
    }),
  );
  const bar = new PartyBar(
    host,
    `The maze is tipped by ${plural(host.seats, "seat")}, each along one axis. Swipe only along yours; the axes pass on as the bit rolls.`,
  );

  function line(m: TwoAxisModel): string {
    const mine = m.axesOf(host.seat);
    const left = pass > 0 ? pass - (m.rolls % pass) : 0;
    const then = pass > 0 ? ` · passes in ${plural(left, "roll")}` : "";
    if (mine.length > 0) return `You tilt ${mine.map((a) => names[a]).join(", ")}${then}`;
    return `${seatName(m.tilter(0))} tilts now${then}`;
  }

  return {
    frame(at) {
      maze.frame(at);
      bar.fit();
      const m = merged();
      bar.say(line(m));
      for (let s = 0; s < host.seats; s++) bar.light(s, m.axesOf(s).length > 0, "holds");
    },
    destroy() {
      maze.destroy();
      bar.remove();
    },
  };
}

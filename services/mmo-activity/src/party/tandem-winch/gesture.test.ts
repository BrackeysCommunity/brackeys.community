// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { partyStage, type Stage } from "../../../test/stage.ts";
import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { QUARTER } from "../../scenes/crank/scene.ts";
import type { Point } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import tandemWinch from "./index.ts";
import type { WinchModel } from "./model.ts";
import { geometry, grab } from "./scene.ts";

const cases = partyCases("tandem-winch");
const phone = { width: 360, height: 420 };
const geo = geometry(playArea(phone));
const seated = (m: PuzzleMove) => ({ ...m, seat: m.seat ?? 0 });

// A point on a crank's rim at an angle, clockwise from three o'clock.
function rim(crank: number, deg: number): Point {
  const hub = geo.hubs[crank]!;
  const rad = (deg * Math.PI) / 180;
  return { x: hub.x + geo.r * Math.cos(rad), y: hub.y + geo.r * Math.sin(rad) };
}

// Winds a crank from one angle to another in steps of 45 degrees at most.
function wind(s: Stage, crank: number, from: number, to: number): void {
  const steps = Math.ceil(Math.abs(to - from) / 45);
  for (let i = 1; i <= steps; i++) s.move(rim(crank, from + ((to - from) * i) / steps));
}

function table(layout: PuzzleLayout): Stage[] {
  const seats = layout.seats!;
  const first = partyStage(tandemWinch, layout, { ...phone, seat: 0, seats });
  const rest = Array.from({ length: seats - 1 }, (_, i) =>
    partyStage(tandemWinch, layout, { ...phone, seat: i + 1, seats, model: first.model }),
  );
  return [first, ...rest];
}

test("the merged solve played by pointer: each quarter turn on the crank its seat holds then", () => {
  for (const c of cases) {
    const stages = table(c.layout);
    // Where each seat's finger is: the crank it holds and its angle.
    const hands = stages.map(() => ({ crank: -1, angle: 0 }));
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      const seat = m.seat ?? 0;
      const s = stages[seat]!;
      const hand = hands[seat]!;
      for (const t of stages) t.at = m.at;
      if (hand.crank !== m.b) {
        if (hand.crank >= 0) s.up(rim(hand.crank, hand.angle));
        // A few degrees in hand, so each quarter lands inside a move.
        s.down(rim(m.b ?? 0, 0));
        s.move(rim(m.b ?? 0, 5));
        Object.assign(hand, { crank: m.b ?? 0, angle: 5 });
      }
      wind(s, hand.crank, hand.angle, hand.angle + QUARTER);
      hand.angle += QUARTER;
    }
    const made = stages
      .flatMap((s) => s.moves)
      .sort((x, y) => x.at - y.at || (x.b ?? 0) - (y.b ?? 0));
    expect(made, c.name).toEqual(solve.log.moves.map(seated));
    expect(stages[0]!.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
  }
});

test("the crank another seat holds does not wind, and the bar says whose it is", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const [mine] = table(c.layout);
  mine!.at = 100;
  mine!.down(rim(1, 0));
  wind(mine!, 1, 0, 360);
  mine!.up(rim(1, 360));
  mine!.frame();
  expect(mine!.moves).toEqual([]);
  expect((mine!.model as WinchModel).cranks[1]!.speed).toBe(0);
  expect(mine!.surface.querySelector(".pb-say")!.textContent).toBe("Seat 2 winds crank B now.");
});

test("the cranks change hands under a finger, and the next turn is not sent", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const [mine] = table(c.layout);
  const pass = c.layout.pass!;
  mine!.at = pass - 100;
  mine!.down(rim(0, 0));
  wind(mine!, 0, 0, QUARTER + 5);
  expect(mine!.moves).toEqual([{ at: pass - 100, a: 1, seat: 0 }]);
  mine!.at = pass + 100;
  wind(mine!, 0, QUARTER + 5, QUARTER * 3);
  expect(mine!.moves).toHaveLength(1);
  mine!.up(rim(0, QUARTER * 3));
  mine!.frame();
  expect(mine!.surface.querySelector(".pb-say")!.textContent).toBe("You wind crank B.");
  mine!.down(rim(1, 0));
  wind(mine!, 1, 0, QUARTER + 5);
  expect(mine!.moves.at(-1)).toEqual({ at: pass + 100, a: 1, b: 1, seat: 0 });
});

test("every screen shows both gauges and who winds each crank", () => {
  const c = cases.find((x) => x.name === "level-9-seats-3-shape-1")!;
  const stages = table(c.layout);
  const who = (s: Stage) => [...s.surface.querySelectorAll(".who")].map((n) => n.textContent);
  expect(who(stages[0]!)).toEqual(["You wind this", "Seat 2 winds this"]);
  expect(who(stages[1]!)).toEqual(["Seat 1 winds this", "You wind this"]);
  expect(who(stages[2]!)).toEqual(["Seat 1 winds this", "Seat 2 winds this"]);
  expect(stages[2]!.surface.querySelector(".pb-say")!.textContent).toBe(
    "Both cranks are in other hands: wait for yours.",
  );
  for (const s of stages) expect(s.surface.querySelectorAll(".needle").length).toBe(2);
});

test("a finger off both wheels picks nothing up", () => {
  expect(grab(geo, { x: geo.hubs[0]!.x, y: geo.top })).toBeUndefined();
  expect(grab(geo, rim(1, 30))).toBe(1);
});

test("the scene cleans up after itself", () => {
  const [s] = table(cases[0]!.layout);
  s!.scene.destroy();
  expect(s!.surface.children.length).toBe(0);
});

// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { centre, geometry } from "../../scenes/lock-maze/scene.ts";
import type { Point } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import twoAxisTilt from "./index.ts";
import type { TwoAxisModel } from "./model.ts";

const phone = { width: 360, height: 420 };
const pair = partyCases("two-axis-tilt").find((c) => c.name === "level-3-seats-2-shape-0")!;
const ACROSS = [1, 0, -1, 0];
const DOWN = [0, 1, 0, -1];

function seats() {
  const first = stage(twoAxisTilt, pair.layout, { ...phone, seat: 0 });
  const second = stage(twoAxisTilt, pair.layout, { ...phone, seat: 1, model: first.model });
  const geo = geometry(pair.layout.size, playArea(phone));
  const from = centre(geo, pair.layout.size, 0);
  // One swipe's length and a little more is one tilt.
  const swipe = (s: Stage, dir: number) => {
    const to: Point = {
      x: from.x + ACROSS[dir]! * geo.swipe * 1.2,
      y: from.y + DOWN[dir]! * geo.swipe * 1.2,
    };
    s.drag(from, to);
  };
  return { stages: [first, second], swipe, model: first.model as TwoAxisModel };
}

test("each seat swipes along its own axis, and together they roll the bit home", () => {
  const { stages, swipe, model } = seats();
  const solve = pair.logs.find((l) => l.name === "solve")!;
  for (const m of solve.log.moves) {
    swipe(stages[m.seat ?? 0]!, m.a);
    for (const s of stages) s.frame();
  }
  expect(solve.outcome.status).toBe(DONE);
  expect(stages[0]!.moves.length + stages[1]!.moves.length).toBe(solve.log.moves.length);
  expect(model.snapshot()).toEqual(solve.trace.at(-1)!.state);
});

test("a swipe along the other seat's axis tips nothing", () => {
  const { stages, swipe, model } = seats();
  const axis = model.axesOf(0)[0]!;
  swipe(stages[0]!, axis + 1);
  swipe(stages[0]!, axis + 3);
  expect(stages[0]!.moves).toEqual([]);
  swipe(stages[1]!, axis + 1);
  expect(stages[1]!.moves).toEqual([{ at: 0, a: axis + 1, seat: 1 }]);
});

test("the bar names the seat's axis and when it passes", () => {
  const { stages, model } = seats();
  const say = (s: Stage) => s.surface.querySelector(".pb-say")!.textContent;
  expect(say(stages[0]!)).toMatch(/^You tilt /);
  expect(say(stages[0]!)).not.toBe(say(stages[1]!));
  expect(stages[0]!.surface.querySelectorAll(".pb-seat.holds")).toHaveLength(2);
  expect(model.axesOf(0)).not.toEqual(model.axesOf(1));
});

test("with more seats than axes, a seat waits its turn", () => {
  const four = partyCases("two-axis-tilt").find((c) => c.name === "level-3-seats-4-shape-0")!;
  const s = stage(twoAxisTilt, four.layout, { ...phone, seat: 3 });
  expect(s.surface.querySelector(".pb-say")!.textContent).toMatch(/tilts now/);
  expect(s.surface.querySelectorAll(".pb-seat.holds")).toHaveLength(2);
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

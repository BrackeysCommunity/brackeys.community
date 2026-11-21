// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { geometry, slots } from "../../scenes/lock-pins/scene.ts";
import { DONE } from "../../shell/kit.ts";
import { BAR, playArea } from "../wrap.ts";
import tensionAndPick from "./index.ts";
import { ON, PICK, TENSION, type TensionPickModel } from "./model.ts";

const phone = { width: 360, height: 420 };
const pair = partyCases("tension-and-pick").find((c) => c.name === "level-3-seats-2-shape-0")!;
const pins = pair.layout.size + (pair.layout.false?.length ?? 0);
// The lever's middle: the left of the bar, clear of the lamps.
const lever = { x: 40, y: phone.height - BAR / 2 };

function seats() {
  const first = stage(tensionAndPick, pair.layout, { ...phone, seat: 0 });
  const second = stage(tensionAndPick, pair.layout, { ...phone, seat: 1, model: first.model });
  const geo = geometry(pins, playArea(phone));
  const lift = (s: Stage, pin: number, height: number) => {
    const col = geo.cols[slots(pair.layout)[pin]!]!;
    s.drag({ x: col.x, y: col.rest }, { x: col.x, y: col.rest - height * geo.notch });
  };
  return { stages: [first, second], lift, model: first.model as TensionPickModel };
}

test("one seat pulls the lever, the other lifts the pin, and the roles swap each pin", () => {
  const { stages, lift, model } = seats();
  let at = 0;
  for (const pin of pair.layout.order!) {
    const ten = stages[model.role(TENSION)]!;
    const pick = stages[model.role(PICK)]!;
    ten.at = at;
    ten.tap(lever);
    pick.at = at + 250;
    lift(pick, pin, pair.layout.target![pin]!);
    for (const s of stages) s.frame();
    at += 500;
  }
  expect(model.k).toBe(pair.layout.size);
  const solve = pair.logs.find((l) => l.name === "solve")!;
  expect(solve.outcome.status).toBe(DONE);
  const merged = [...stages[0]!.moves, ...stages[1]!.moves].sort((a, b) => a.at - b.at);
  expect(merged).toEqual(solve.log.moves.map((m) => ({ ...m, seat: m.seat ?? 0 })));
});

test("only the tension seat has a lever, and only the pick seat lifts", () => {
  const { stages, lift, model } = seats();
  const pick = model.role(PICK);
  stages[pick]!.tap(lever);
  expect(stages[pick]!.moves).toEqual([]);
  const ten = model.role(TENSION);
  lift(stages[ten]!, pair.layout.order![0]!, 1);
  expect(stages[ten]!.moves).toEqual([]);
  stages[ten]!.tap(lever);
  expect(stages[ten]!.moves).toEqual([{ at: 0, a: 0, c: ON, seat: ten }]);
  const shown = (i: number) =>
    stages[i]!.surface.querySelector(".pb-control")!.getAttribute("display");
  expect(shown(ten)).toBe("inline");
  expect(shown(pick)).toBe("none");
});

test("the pick seat is told when the tension is on", () => {
  const { stages, model } = seats();
  const say = () => stages[model.role(PICK)]!.surface.querySelector(".pb-say")!.textContent;
  expect(say()).toMatch(/^Wait for Seat/);
  stages[model.role(TENSION)]!.tap(lever);
  stages[model.role(PICK)]!.frame();
  expect(say()).toBe("Lift the binding pin now");
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

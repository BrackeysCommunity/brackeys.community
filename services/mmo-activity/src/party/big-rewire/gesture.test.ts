// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { geometry } from "../../scenes/rewire/scene.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import bigRewire from "./index.ts";
import { EMPTY, GRAB, type BigRewireModel } from "./model.ts";

const phone = { width: 360, height: 760 };
const pair = partyCases("big-rewire").find((c) => c.name === "level-3-seats-2-shape-0")!;
const n = pair.layout.size;

function seats() {
  const first = stage(bigRewire, pair.layout, { ...phone, seat: 0 });
  const second = stage(bigRewire, pair.layout, { ...phone, seat: 1, model: first.model });
  const model = first.model as BigRewireModel;
  const geo = geometry(n, playArea(phone));
  const plug = (s: Stage, wire: number, port: number) =>
    s.drag(geo.seats[model.at[wire]!]!, geo.seats[port]!);
  return { stages: [first, second], model, geo, plug };
}

test("each drag holds a wire and plugs it, and the seats wire the box between them", () => {
  const { stages, model, plug } = seats();
  const solve = pair.logs.find((l) => l.name === "solve")!;
  for (const [w, port] of pair.layout.target!.entries()) {
    if (model.at[w] === port) continue;
    const s = stages[w % 2]!;
    s.at = w * 500;
    plug(s, w, port);
    for (const st of stages) st.frame();
  }
  expect(solve.outcome.status).toBe(DONE);
  expect(model.at).toEqual(pair.layout.target);
  for (const [i, s] of stages.entries()) {
    expect(s.moves.every((m) => m.seat === i)).toBe(true);
    // Every plug is made by the hand that grabbed the wire just before.
    for (let k = 0; k < s.moves.length; k += 2) {
      expect(s.moves[k]!.c).toBe(GRAB);
      expect(s.moves[k + 1]!.a).toBe(s.moves[k]!.a);
    }
  }
});

test("a press holds the wire on every screen until it is dropped in a port", () => {
  const { stages, model, geo } = seats();
  stages[0]!.down(geo.seats[model.at[2]!]!);
  expect(stages[0]!.moves).toEqual([{ at: 0, a: 2, c: GRAB, seat: 0 }]);
  stages[0]!.cancel();
  for (const s of stages) s.frame();
  expect(model.hold).toEqual([2, EMPTY]);
  const ring = stages[1]!.surface.querySelector(".party-bar g[transform]");
  const at = geo.seats[model.at[2]!]!;
  expect(ring?.getAttribute("transform")).toBe(`translate(${at.x} ${at.y})`);
  expect(stages[1]!.surface.querySelector(".pb-say")!.textContent).toMatch(/^1 wire held/);
});

test("a wire held by another hand cannot be taken or plugged", () => {
  const { stages, model, geo, plug } = seats();
  stages[0]!.down(geo.seats[model.at[1]!]!);
  stages[0]!.cancel();
  plug(stages[1]!, 1, 0);
  expect(stages[1]!.moves).toEqual([]);
  expect(model.hold).toEqual([1, EMPTY]);
});

test("a tap on a plug, then a tap on a port, plugs the held wire", () => {
  const { stages, model, geo } = seats();
  const port = pair.layout.target![0]!;
  stages[0]!.tap(geo.seats[model.at[0]!]!);
  stages[0]!.tap(geo.seats[port]!);
  expect(stages[0]!.moves).toEqual([
    { at: 0, a: 0, c: GRAB, seat: 0 },
    { at: 0, a: 0, b: port, seat: 0 },
  ]);
  expect(model.hold[0]).toBe(EMPTY);
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

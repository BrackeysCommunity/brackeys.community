// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { stage } from "../../../test/stage.ts";
import { centre, geometry } from "../../scenes/circuit/scene.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import splitGrid from "./index.ts";
import { region, type SplitGridModel } from "./model.ts";

const phone = { width: 360, height: 420 };
const pair = partyCases("split-grid").find((c) => c.name === "level-3-seats-2-shape-0")!;

function seats(c = pair) {
  const first = stage(splitGrid, c.layout, { ...phone, seat: 0 });
  const second = stage(splitGrid, c.layout, { ...phone, seat: 1, model: first.model });
  const geo = geometry(c.layout.size, playArea(phone), c.layout.shape ?? 0);
  const at = (cell: number) => centre(geo, c.layout.size, cell);
  return { stages: [first, second], at, model: first.model as SplitGridModel };
}

test.each(["level-3-seats-2-shape-0", "level-3-seats-2-shape-1"])(
  "%s: each seat's taps turn its own tiles, and together they solve the board",
  (name) => {
    const c = partyCases("split-grid").find((x) => x.name === name)!;
    const { stages, at, model } = seats(c);
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      stages[m.seat ?? 0]!.tap(at(m.a));
      for (const s of stages) s.frame();
    }
    expect(solve.outcome.status).toBe(DONE);
    expect(stages[0]!.moves.length + stages[1]!.moves.length).toBe(solve.log.moves.length);
    expect(model.snapshot()).toEqual(solve.trace.at(-1)!.state);
  },
);

test("every seat's moves carry its seat", () => {
  const { stages, at } = seats();
  const solve = pair.logs.find((l) => l.name === "solve")!;
  for (const m of solve.log.moves) {
    stages[m.seat ?? 0]!.tap(at(m.a));
    for (const s of stages) s.frame();
  }
  expect(stages[0]!.moves.every((m) => m.seat === 0)).toBe(true);
  expect(stages[1]!.moves.every((m) => m.seat === 1)).toBe(true);
});

test("a tap on another seat's tile makes no move", () => {
  const { stages, at } = seats();
  const n = pair.layout.size;
  const theirs = Array.from({ length: n * n }, (_, c) => c).find(
    (c) => region(pair.layout, c) === 1,
  )!;
  stages[0]!.tap(at(theirs));
  expect(stages[0]!.moves).toEqual([]);
  stages[1]!.tap(at(theirs));
  expect(stages[1]!.moves).toEqual([{ at: 0, a: theirs, seat: 1 }]);
});

test("a relayed turn shows on the other seat's board", () => {
  const { stages, at, model } = seats();
  const n = pair.layout.size;
  const mine = Array.from({ length: n * n }, (_, c) => c).find(
    (c) => region(pair.layout, c) === 1,
  )!;
  const before = model.snapshot()[mine];
  stages[1]!.tap(at(mine));
  stages[0]!.frame();
  expect(model.snapshot()[mine]).toBe(((before ?? 0) + 1) % 4);
  expect(stages[0]!.surface.querySelectorAll(".party-bar .theirs").length).toBeGreaterThan(0);
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

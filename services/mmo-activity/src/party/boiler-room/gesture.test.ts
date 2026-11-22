// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { partyStage, type Stage } from "../../../test/stage.ts";
import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { NOTCH, geometry } from "../../scenes/pressure/scene.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import boilerRoom from "./index.ts";
import type { BoilerModel } from "./model.ts";

const cases = partyCases("boiler-room");
const phone = { width: 360, height: 420 };
const geo = (layout: PuzzleLayout) => geometry(layout.size, playArea(phone));
const seated = (m: PuzzleMove) => ({ ...m, seat: m.seat ?? 0 });

// A drag of a little over one notch, up the screen to open.
const by = (dir: number) => -(1.2 * NOTCH) * dir;

// One stage a seat, every one pressing the same machine.
function table(layout: PuzzleLayout): Stage[] {
  const seats = layout.seats!;
  const first = partyStage(boilerRoom, layout, { ...phone, seat: 0, seats });
  const rest = Array.from({ length: seats - 1 }, (_, i) =>
    partyStage(boilerRoom, layout, { ...phone, seat: i + 1, seats, model: first.model }),
  );
  return [first, ...rest];
}

test(
  "the merged solve played by pointer, each turn on its own seat's screen",
  { timeout: 60_000 },
  () => {
    for (const c of cases) {
      const stages = table(c.layout);
      const solve = c.logs.find((l) => l.name === "solve")!;
      for (const m of solve.log.moves) {
        const s = stages[m.seat ?? 0]!;
        for (const t of stages) t.at = m.at;
        const w = geo(c.layout).wheels[m.a]!;
        s.drag(w, { x: w.x, y: w.y + by(m.b!) });
      }
      const made = stages.flatMap((s) => s.moves).sort((x, y) => x.at - y.at);
      expect(made, c.name).toEqual(solve.log.moves.map(seated));
      expect(stages[0]!.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
    }
  },
);

test("another seat's wheel does not turn, and the bar says whose it is", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const [mine] = table(c.layout);
  const model = mine!.model as BoilerModel;
  const before = [...model.v];
  const theirs = geo(c.layout).wheels[1]!;
  mine!.drag(theirs, { x: theirs.x, y: theirs.y + by(1) });
  expect(mine!.moves).toEqual([]);
  expect(model.v).toEqual(before);
  expect(mine!.surface.querySelector(".pb-say")!.textContent).toBe("Seat 2 holds valve B.");
  expect(mine!.surface.querySelector(".wheel.held")).toBeNull();
});

test("a turn on one screen moves every needle on every screen", () => {
  const c = cases.find((x) => x.name === "level-3-seats-3-shape-1")!;
  const stages = table(c.layout);
  const model = stages[0]!.model as BoilerModel;
  const before = [...model.v];
  const w = geo(c.layout).wheels[0]!;
  stages[0]!.drag(w, { x: w.x, y: w.y + by(1) });
  expect(stages[0]!.moves).toEqual([{ at: 0, a: 0, b: 1, seat: 0 }]);
  for (const [i, v] of model.v.entries())
    expect(v).toBe(Math.max(0, before[i]! + (i === 0 ? model.nudge : -model.couple)));
  const words = (s: Stage) => [...s.surface.querySelectorAll(".state")].map((n) => n.textContent);
  for (const s of stages) s.frame();
  for (const s of stages.slice(1)) expect(words(s)).toEqual(words(stages[0]!));
});

test("a held wheel shows its own needle rising and every other falling", () => {
  const c = cases.find((x) => x.name === "level-9-seats-2-shape-0")!;
  const [s] = table(c.layout);
  const pulls = () => [...s!.surface.querySelectorAll(".every")].map((p) => p.getAttribute("d"));
  expect(pulls().every((d) => d === "")).toBe(true);
  const w = geo(c.layout).wheels[2]!;
  s!.down(w);
  s!.frame();
  expect(pulls().every((d) => d !== "")).toBe(true);
  s!.up(w);
  s!.frame();
  expect(pulls().every((d) => d === "")).toBe(true);
});

test("each wheel names the seat that holds it", () => {
  const c = cases.find((x) => x.name === "level-9-seats-3-shape-0")!;
  const stages = table(c.layout);
  const tags = [...stages[1]!.surface.querySelectorAll(".valve .held-tag")].map(
    (t) => t.textContent,
  );
  expect(tags).toEqual(
    Array.from({ length: c.layout.size }, (_, v) => (v % 3 === 1 ? "You" : `Seat ${(v % 3) + 1}`)),
  );
});

test("the scene cleans up after itself", () => {
  const [s] = table(cases[0]!.layout);
  s!.scene.destroy();
  expect(s!.surface.children.length).toBe(0);
});

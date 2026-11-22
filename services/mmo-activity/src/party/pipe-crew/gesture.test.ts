// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { partyStage, type Stage } from "../../../test/stage.ts";
import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { geometry } from "../../scenes/leak/scene.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import pipeCrew from "./index.ts";
import type { PipeModel } from "./model.ts";

const cases = partyCases("pipe-crew");
const phone = { width: 360, height: 420 };
const geo = (layout: PuzzleLayout) => geometry(layout.size, playArea(phone));
const seated = (m: PuzzleMove) => ({ ...m, seat: m.seat ?? 0 });

function table(layout: PuzzleLayout): Stage[] {
  const seats = layout.seats!;
  const first = partyStage(pipeCrew, layout, { ...phone, seat: 0, seats });
  const rest = Array.from({ length: seats - 1 }, (_, i) =>
    partyStage(pipeCrew, layout, { ...phone, seat: i + 1, seats, model: first.model }),
  );
  return [first, ...rest];
}

test(
  "the merged solve played by pointer, each leak tapped on its run's screen",
  { timeout: 60_000 },
  () => {
    for (const c of cases) {
      const stages = table(c.layout);
      const solve = c.logs.find((l) => l.name === "solve")!;
      for (const m of solve.log.moves) {
        for (const s of stages) s.at = m.at;
        stages[m.seat ?? 0]!.tap(geo(c.layout).slots[m.a]!);
      }
      const made = stages.flatMap((s) => s.moves).sort((x, y) => x.at - y.at);
      expect(made, c.name).toEqual(solve.log.moves.map(seated));
      expect(stages[0]!.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
    }
  },
);

test("a tap on another run's joint is not sent and costs nothing", () => {
  const c = cases.find((x) => x.name === "level-9-seats-3-shape-0")!;
  const [mine] = table(c.layout);
  const model = mine!.model as PipeModel;
  mine!.at = 400;
  mine!.tap(geo(c.layout).slots[1]!);
  expect(mine!.moves).toEqual([]);
  expect(model.g).toEqual([model.full, model.full, model.full]);
  expect(mine!.surface.querySelector(".pb-say")!.textContent).toBe("Joint B is on Seat 2's run.");
  // A dry joint of its own run costs that run alone.
  mine!.tap(geo(c.layout).slots[0]!);
  expect(mine!.moves).toEqual([{ at: 400, a: 0, seat: 0 }]);
  expect(model.g.slice(1)).toEqual([model.full, model.full]);
  expect(model.g[0]).toBeLessThan(model.full);
});

test("this seat's joints are lit and every other run's dimmed", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-1")!;
  const stages = table(c.layout);
  for (const [seat, s] of stages.entries()) {
    expect(s.surface.querySelectorAll(".pipe-crew .theirs").length).toBe(
      Array.from({ length: c.layout.size }, (_, i) => i).filter((i) => i % 2 !== seat).length,
    );
    expect(s.surface.querySelectorAll(".pipe-crew .run-ring").length).toBe(
      Array.from({ length: c.layout.size }, (_, i) => i).filter((i) => i % 2 === seat).length,
    );
  }
});

test("every screen shows every run's gauge, and its own one marked", () => {
  const c = cases.find((x) => x.name === "level-3-seats-3-shape-0")!;
  const stages = table(c.layout);
  const labels = (s: Stage) =>
    [...s.surface.querySelectorAll(".run-label")].map((n) => n.textContent);
  expect(labels(stages[2]!)).toEqual(["Seat 1's run", "Seat 2's run", "Your run"]);
  const tracks = [...stages[2]!.surface.querySelectorAll(".run-track")];
  expect(tracks.map((t) => t.classList.contains("yours"))).toEqual([false, false, true]);
  // A run drained low says so on every screen.
  const model = stages[0]!.model as PipeModel;
  model.g[1] = 1;
  for (const s of stages) s.frame();
  for (const s of stages) expect(labels(s)[1]).toMatch(/low!$/);
});

test("the scene cleans up after itself", () => {
  const [s] = table(cases[0]!.layout);
  s!.scene.destroy();
  expect(s!.surface.children.length).toBe(0);
});

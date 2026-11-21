// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { partyStage, type Stage } from "../../../test/stage.ts";
import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { centre, geometry } from "../../scenes/scrub/scene.ts";
import { playArea } from "../wrap.ts";
import panelArray from "./index.ts";
import { panelOf, type PanelModel } from "./model.ts";

const cases = partyCases("panel-array");
const phone = { width: 360, height: 420 };
const geo = (layout: PuzzleLayout) => geometry(layout.size, playArea(phone));
const seated = (m: PuzzleMove) => ({ ...m, seat: m.seat ?? 0 });

function table(layout: PuzzleLayout): Stage[] {
  const seats = layout.seats!;
  const first = partyStage(panelArray, layout, { ...phone, seat: 0, seats });
  const rest = Array.from({ length: seats - 1 }, (_, i) =>
    partyStage(panelArray, layout, { ...phone, seat: i + 1, seats, model: first.model }),
  );
  return [first, ...rest];
}

test("the merged solve played by pointer, each rub on its band's screen", () => {
  for (const c of cases) {
    const stages = table(c.layout);
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      for (const s of stages) s.at = m.at;
      stages[0]!.model.run(m.at);
      stages[m.seat ?? 0]!.tap(centre(geo(c.layout), m.a));
    }
    const made = stages.flatMap((s) => s.moves).sort((x, y) => x.at - y.at);
    expect(made, c.name).toEqual(solve.log.moves.map(seated));
    const model = stages[0]!.model as PanelModel;
    expect(
      model.cells.every((cell) => model.grit[cell] === 0),
      c.name,
    ).toBe(true);
  }
});

test("a finger rubbed across another seat's band takes nothing off it", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const [mine] = table(c.layout);
  const model = mine!.model as PanelModel;
  const n = c.layout.size;
  const theirs = Array.from({ length: n * n }, (_, i) => i).filter((i) => panelOf(i, n, 2) === 1);
  const before = [...model.grit];
  mine!.at = 200;
  mine!.down(centre(geo(c.layout), theirs[0]!));
  mine!.move(centre(geo(c.layout), theirs.at(-1)!));
  mine!.up(centre(geo(c.layout), theirs.at(-1)!));
  expect(mine!.moves).toEqual([]);
  expect(model.grit).toEqual(before);
});

test("grit blown next door is ringed on every screen, and the next band is told", () => {
  const c = cases.find((x) => x.name === "level-9-seats-3-shape-0")!;
  const stages = table(c.layout);
  const model = stages[0]!.model as PanelModel;
  const n = c.layout.size;
  const pass = c.layout.pass!;
  const mine = Array.from({ length: n * n }, (_, i) => i).filter(
    (i) => panelOf(i, n, 3) === 0 && model.grit[i]! > 1,
  );
  // Clean the first cell of the next band's reading, then rub until it blows.
  const target = model.cells.find((cell) => panelOf(cell, n, 3) === 1)!;
  model.grit[target] = 0;
  for (let i = 0; i < pass; i++) {
    for (const s of stages) s.at = 100 * (i + 1);
    stages[0]!.tap(centre(geo(c.layout), mine[i]!));
  }
  expect(model.grit[target]).toBe(1);
  for (const s of stages) {
    s.frame();
    const ring = s.surface.querySelector(".arrived.on")!;
    const at = centre(geo(c.layout), target);
    expect([Number(ring.getAttribute("cx")), Number(ring.getAttribute("cy"))]).toEqual([
      at.x,
      at.y,
    ]);
  }
  expect(stages[1]!.surface.querySelector(".pb-say")!.textContent).toBe(
    "Seat 1 blew grit onto your band.",
  );
  expect(stages[0]!.surface.querySelector(".pb-say")!.textContent).toBe(
    `${pass === 1 ? "1 rub" : `${pass} rubs`} until grit blows onto Seat 2's band.`,
  );
});

test("every band is drawn, this seat's marked and the others dimmed", () => {
  const c = cases.find((x) => x.name === "level-9-seats-4-shape-1")!;
  const stages = table(c.layout);
  for (const s of stages) {
    expect(s.surface.querySelectorAll(".panel-array .theirs").length).toBe(3);
    expect(s.surface.querySelectorAll(".panel-array .band.yours").length).toBe(1);
    expect(s.surface.querySelectorAll(".panel-array .seam").length).toBe(3);
  }
});

test("the scene cleans up after itself", () => {
  const [s] = table(cases[0]!.layout);
  s!.scene.destroy();
  expect(s!.surface.children.length).toBe(0);
});

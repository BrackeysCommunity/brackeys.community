// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT } from "../../shell/board.ts";
import { BROKE } from "../../shell/kit.ts";
import scrub from "./index.ts";
import type { ScrubModel } from "./model.ts";
import { INSET, cellAt, centre, geometry, settle } from "./scene.ts";

const cases = goldenCases("scrub");
const small = cases.find((c) => c.name === "level-1-full")!;
const phone = { width: 360, height: 420 };
const desk = { width: 900, height: 560 };
const sizeOf = (name: string) => (name.endsWith("compact") ? phone : desk);

test("the solve played by pointer: a rub on its cell for every move", () => {
  for (const c of cases) {
    const size = sizeOf(c.name);
    const s = stage(scrub, c.layout, size);
    const geo = geometry(c.layout.size, size);
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      s.at = m.at;
      // The shell has run the model to now by the time a finger lands:
      // grit that crept back is there to rub.
      s.model.run(s.at);
      s.tap(centre(geo, m.a));
    }
    expect(s.moves, c.name).toEqual(solve.log.moves);
    const model = s.model as ScrubModel;
    expect(model.cells.every((cell) => model.grit[cell] === 0)).toBe(true);
  }
});

test("a finger rubbed along a row takes a layer off each cell it enters", () => {
  const s = stage(scrub, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const model = s.model as ScrubModel;
  s.at = 300;
  s.down(centre(geo, 0));
  s.move(centre(geo, 3));
  expect(s.moves).toEqual([0, 1, 2, 3].map((a) => ({ at: 300, a })));
  // Back again is a second rub of each, and now they show what they are.
  s.move(centre(geo, 0));
  s.up(centre(geo, 0));
  expect(s.moves.slice(4).map((m) => m.a)).toEqual([2, 1, 0]);
  expect(model.grit.slice(0, 4)).toEqual([0, 0, 0, 1]);
});

test("a wobble on an edge is not a rub of each side in turn", () => {
  const s = stage(scrub, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const a = centre(geo, 0);
  const edge = geo.x + geo.cell;
  s.down(a);
  for (let i = 0; i < 6; i++) {
    s.move({ x: edge + geo.cell * INSET * 0.8, y: a.y });
    s.move({ x: edge - 2, y: a.y });
  }
  expect(s.moves).toEqual([{ at: 0, a: 0 }]);
  s.move({ x: edge + geo.cell * INSET + 1, y: a.y });
  expect(s.moves.map((m) => m.a)).toEqual([0, 1]);
});

test("a clean cell is not rubbed again, and a finger off the grid rubs nothing", () => {
  const s = stage(scrub, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const model = s.model as ScrubModel;
  const blank = model.grit.findIndex((_, i) => model.kind(i) === "blank");
  for (let i = 0; i < 5; i++) s.tap(centre(geo, blank));
  expect(s.moves).toHaveLength(small.layout.init![blank]!);
  s.tap({ x: geo.x - 4, y: geo.y - 4 });
  expect(s.moves).toHaveLength(small.layout.init![blank]!);
});

test("a cell shows what it is only on its last layer, and a crack breaks on the next rub", () => {
  const s = stage(scrub, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const model = s.model as ScrubModel;
  const crack = small.layout.false![0]!;
  const cls = () => s.surface.querySelectorAll("g")[crack]!.getAttribute("class")!;
  expect(cls()).toBe("cell hidden");
  for (let i = small.layout.init![crack]!; i > 1; i--) s.tap(centre(geo, crack));
  expect(cls()).toBe("cell hazy crack");
  expect(model.grit[crack]).toBe(1);
  // The rub that breaks it ends the drag where it happened.
  s.down(centre(geo, crack));
  expect(model.apply({ at: 0, a: crack })).toBe(BROKE);
  const sent = s.moves.length;
  s.move(centre(geo, crack === 0 ? 1 : crack - 1));
  expect(s.moves).toHaveLength(sent);
});

test("a cancelled pointer lifts the finger", () => {
  const s = stage(scrub, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  s.down(centre(geo, 5));
  s.cancel();
  s.move(centre(geo, 6));
  expect(s.moves).toEqual([{ at: 0, a: 5 }]);
});

test("the cell a finger is on is the one under it, once it is a little way in", () => {
  const geo = geometry(4, phone);
  const c = centre(geo, 5);
  expect(cellAt(geo, c)).toBe(5);
  expect(cellAt(geo, { x: geo.x - 1, y: c.y })).toBeUndefined();
  expect(cellAt(geo, { x: c.x, y: geo.y + geo.cell * 4 + 1 })).toBeUndefined();
  expect(settle(geo, undefined, c)).toBe(5);
  expect(settle(geo, 4, { x: c.x - geo.cell * 0.49, y: c.y })).toBe(4);
  expect(settle(geo, 4, c)).toBe(5);
  expect(settle(geo, 4, { x: geo.x - 1, y: c.y })).toBeUndefined();
});

test("a thumb covers one cell at a time on a phone and at full size", () => {
  for (const c of cases) {
    const size = sizeOf(c.name);
    const geo = geometry(c.layout.size, size);
    expect(geo.cell / 2).toBeGreaterThanOrEqual(HIT);
    expect(geo.x).toBeGreaterThanOrEqual(0);
    expect(geo.y + geo.cell * geo.n).toBeLessThan(size.height);
  }
  // The largest grid still fits a thumb on a phone that is not held to the cap.
  expect(geometry(7, phone).cell / 2).toBeGreaterThanOrEqual(HIT);
});

test("the phone's cap of six cells a side holds", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(6);
});

test("a hint warns of a cracked cell for good, and the guide rings a cell to rub", () => {
  const reading = small.layout.target![0]!;
  const crack = small.layout.false![0]!;
  const s = stage(scrub, small.layout, { ...phone, guide: { at: 100, a: reading } });
  const cls = (i: number) => s.surface.querySelectorAll("g")[i]!.getAttribute("class")!;
  expect(cls(reading)).toContain("guided");
  s.hint({ at: 0, a: crack });
  s.frame();
  expect(cls(crack)).toContain("warned");
  expect(cls(crack)).not.toContain("hinted");
  s.hint({ at: 0, a: reading });
  s.frame();
  expect(cls(reading)).toContain("hinted");
  expect(s.moves).toEqual([]);
});

test("the scene cleans up after itself", () => {
  const s = stage(scrub, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

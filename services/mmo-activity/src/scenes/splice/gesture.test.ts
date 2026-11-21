// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import type { PuzzleLayout } from "../../api.ts";
import { HIT } from "../../shell/board.ts";
import { BROKE } from "../../shell/kit.ts";
import splice from "./index.ts";
import { DOWN, DRAG, type SpliceModel } from "./model.ts";
import { cellAt, centre, geometry, outside, setDown } from "./scene.ts";

const cases = goldenCases("splice");
const small = cases.find((c) => c.name === "level-1-full")!;
const phone = { width: 360, height: 420 };
const desk = { width: 900, height: 560 };
const sizeOf = (name: string) => (name.endsWith("compact") ? phone : desk);
const board = (l: PuzzleLayout, size: { width: number; height: number }) =>
  geometry(l.size, l.range!, size);

// A board small enough to read: down the first column, then along the
// bottom row, with a gap at one position.
function made(extra: Partial<PuzzleLayout> = {}): PuzzleLayout {
  return {
    family: "splice",
    size: 5,
    decoys: 0,
    range: 3,
    step: 50,
    start: 0,
    goal: 0,
    order: [5, 10, 11, 12, 13, 14],
    par: [12],
    ...extra,
  };
}

test("the solve played by pointer: set down, drag and lift where the log does", () => {
  for (const c of cases) {
    const size = sizeOf(c.name);
    const s = stage(splice, c.layout, size);
    const geo = board(c.layout, size);
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      s.at = m.at;
      s.model.run(s.at);
      const p = centre(geo, m.a);
      if (m.c === DOWN) s.down(p);
      else if (m.c === DRAG) s.move(p);
      else s.up(p);
    }
    expect(s.moves, c.name).toEqual(solve.log.moves);
    const model = s.model as SpliceModel;
    expect(model.k, c.name).toBe(model.length);
  }
});

test("one finger down the trace solders it cell by cell", () => {
  const l = made();
  const s = stage(splice, l, phone);
  const geo = board(l, phone);
  s.at = 200;
  s.down(centre(geo, 5));
  for (const cell of l.order!.slice(1)) s.move(centre(geo, cell));
  expect(s.moves).toEqual([
    { at: 200, a: 5, c: DOWN },
    ...l.order!.slice(1).map((a) => ({ at: 200, a, c: DRAG })),
  ]);
  expect((s.model as SpliceModel).k).toBe(6);
});

test("a finger a little over the edge has not left the trace; further, it has", () => {
  const l = made();
  const s = stage(splice, l, phone);
  const geo = board(l, phone);
  const model = s.model as SpliceModel;
  const c = centre(geo, 5);
  s.down(c);
  // Just over the edge into the cell beside it, and back.
  s.move({ x: c.x + geo.w / 2 + geo.slack - 1, y: c.y });
  s.move(c);
  expect(s.moves).toHaveLength(1);
  s.move({ x: c.x + geo.w / 2 + geo.slack + 2, y: c.y });
  expect(s.moves.at(-1)).toEqual({ at: 0, a: 6, c: DRAG });
  expect(model.apply({ at: 0, a: 6, c: DRAG })).toBe(BROKE);
  // The break ended the drag.
  s.move(centre(geo, 10));
  expect(s.moves).toHaveLength(2);
});

test("the iron is lifted over a gap and set down past it", () => {
  const l = made({ false: [2] });
  const s = stage(splice, l, phone);
  const geo = board(l, phone);
  const model = s.model as SpliceModel;
  s.down(centre(geo, 5));
  s.move(centre(geo, 10));
  s.up(centre(geo, 10));
  expect(s.moves.at(-1)).toEqual({ at: 0, a: 10 });
  expect(model.on).toBe(false);
  s.down(centre(geo, 12));
  s.move(centre(geo, 13));
  s.move(centre(geo, 14));
  expect(s.moves.slice(3)).toEqual([
    { at: 0, a: 12, c: DOWN },
    { at: 0, a: 13, c: DRAG },
    { at: 0, a: 14, c: DRAG },
  ]);
  expect(model.k).toBe(6);
});

test("dragged into a gap, the iron bridges the board", () => {
  const l = made({ false: [2] });
  const s = stage(splice, l, phone);
  const geo = board(l, phone);
  s.down(centre(geo, 5));
  s.move(centre(geo, 10));
  s.move(centre(geo, 11));
  expect(s.moves.at(-1)).toEqual({ at: 0, a: 11, c: DRAG });
  expect((s.model as SpliceModel).k).toBe(2);
  expect(s.model.apply({ at: 0, a: 11, c: DRAG })).toBe(BROKE);
});

test("an iron set down near the trace lands on it; set down elsewhere it solders nothing", () => {
  const l = made();
  const s = stage(splice, l, phone);
  const geo = board(l, phone);
  const c = centre(geo, 5);
  s.down({ x: c.x + geo.w / 2 + geo.slack + 3, y: c.y });
  s.move(c);
  s.move(centre(geo, 10));
  s.up(centre(geo, 10));
  expect(s.moves).toEqual([]);
  s.down({ x: c.x + geo.w / 2 + geo.slack - 1, y: c.y });
  expect(s.moves).toEqual([{ at: 0, a: 5, c: DOWN }]);
  // Picked up where it left off, the iron flows again.
  s.up(c);
  s.down(c);
  s.move(centre(geo, 10));
  expect(s.moves.slice(1)).toEqual([
    { at: 0, a: 5 },
    { at: 0, a: 5, c: DOWN },
    { at: 0, a: 10, c: DRAG },
  ]);
});

test("a twitch that lands the trace under an iron held still is soldered there", () => {
  const l = made({ track: [10, -1] });
  const s = stage(splice, l, phone);
  const geo = board(l, phone);
  const model = s.model as SpliceModel;
  s.down(centre(geo, 5));
  s.at = 500;
  s.model.run(s.at);
  expect(model.cell(1)).toBe(5);
  s.frame();
  expect(s.moves.at(-1)).toEqual({ at: 500, a: 5, c: DRAG });
  expect(model.k).toBe(2);
  // What was soldered stays where it was laid; the rest has moved up a row.
  expect(model.cell(0)).toBe(5);
  expect(model.cell(2)).toBe(6);
});

test("the board says in words that a twitch is coming, and which way", () => {
  const l = made({ track: [40, -1, 80, 1] });
  const s = stage(splice, l, phone);
  const status = () => s.surface.querySelector(".status")!.textContent;
  expect(status()).toBe("Trace from the left end. Lift over gaps.");
  s.at = (40 - 12) * 50;
  s.model.run(s.at);
  s.frame();
  expect(status()).toBe("The loose end is about to twitch up.");
  expect(s.surface.querySelector(".twitch")!.getAttribute("d")).not.toBe("");
  s.at = (80 - 12) * 50;
  s.model.run(s.at);
  s.frame();
  expect(status()).toBe("The loose end is about to twitch down.");
});

test("a cancelled pointer lifts the iron", () => {
  const l = made();
  const s = stage(splice, l, phone);
  const geo = board(l, phone);
  s.down(centre(geo, 5));
  s.cancel();
  expect(s.moves.at(-1)).toEqual({ at: 0, a: 5 });
  s.move(centre(geo, 10));
  expect(s.moves).toHaveLength(2);
});

test("the cell under a point, how far outside one it is, and where an iron lands", () => {
  const geo = geometry(12, 8, phone);
  const c = centre(geo, 13);
  expect(cellAt(geo, c)).toBe(13);
  expect(cellAt(geo, { x: -50, y: -50 })).toBe(0);
  expect(cellAt(geo, { x: 5000, y: 5000 })).toBe(12 * 8 - 1);
  expect(outside(geo, 13, c)).toBe(0);
  expect(outside(geo, 13, { x: c.x + geo.w / 2 + 4, y: c.y })).toBeCloseTo(4);
  expect(setDown(geo, [13, 40], { x: c.x + geo.w / 2 + geo.slack - 1, y: c.y })).toBe(13);
  expect(setDown(geo, [13, 40], { x: c.x + geo.w / 2 + geo.slack + 1, y: c.y })).toBeUndefined();
});

test("the trace is a thumb wide on a phone at its cap, and at full size", () => {
  for (const c of cases) {
    const size = sizeOf(c.name);
    const geo = board(c.layout, size);
    expect(geo.w / 2 + geo.slack).toBeGreaterThanOrEqual(HIT);
    expect(geo.h / 2 + geo.slack).toBeGreaterThanOrEqual(HIT);
    // The slack never reaches the middle of the next cell.
    expect(geo.slack).toBeLessThan(Math.min(geo.w, geo.h) / 2);
    expect(geo.y + geo.h * geo.rows).toBeLessThanOrEqual(size.height);
  }
});

test("the phone's cap of twelve columns holds", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(12);
});

test("a hint marks the far side of a gap until the iron is past it, and the guide the start", () => {
  const l = made({ false: [2] });
  const s = stage(splice, l, { ...phone, guide: { at: 150, a: 5, c: DOWN } });
  const geo = board(l, phone);
  const d = (cls: string) => s.surface.querySelector(cls)!.getAttribute("d");
  expect(d(".guide")).not.toBe("");
  s.scene.hint({ at: 0, a: 12, b: 3, c: DOWN });
  s.frame();
  expect(d(".hint")).not.toBe("");
  s.down(centre(geo, 5));
  s.move(centre(geo, 10));
  s.up(centre(geo, 10));
  s.frame();
  expect(d(".guide")).toBe("");
  expect(d(".hint")).not.toBe("");
  s.down(centre(geo, 12));
  s.move(centre(geo, 13));
  s.frame();
  expect(d(".hint")).toBe("");
});

test("the scene cleans up after itself", () => {
  const s = stage(splice, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

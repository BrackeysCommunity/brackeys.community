// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { HIT, type Point } from "../../shell/board.ts";
import { step } from "../../shell/grid.ts";
import { DONE } from "../../shell/kit.ts";
import { play } from "../../shell/play.ts";
import maze from "./index.ts";
import type { MazeModel } from "./model.ts";
import { centre, geometry, tilts } from "./scene.ts";

const cases = goldenCases("lock-maze");
const small = cases.find((c) => c.name === "level-1-full")!;
const capped = cases.find((c) => c.name === "level-9-compact")!;
const phone = { width: 360, height: 420 };
const wide = { width: 900, height: 560 };
const mid = { x: 180, y: 210 };

const ACROSS = [1, 0, -1, 0];
const DOWN = [0, 1, 0, -1];

// The golden mazes a phone is given are four cells a side.
const REACH = geometry(4, phone).swipe;

// One drag from the middle of the surface, a little over so many tilts long.
function swipe(s: Stage, dir: number, swipes = 1): void {
  const far = REACH * (swipes + 0.3);
  s.drag(mid, { x: mid.x + ACROSS[dir]! * far, y: mid.y + DOWN[dir]! * far });
}

test("swiping the way out, tilt by tilt, rolls the bit home", () => {
  for (const c of [small, capped]) {
    const s = stage(maze, c.layout, phone);
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    for (const m of solve) swipe(s, m.a);
    expect(s.moves).toEqual(solve.map(({ a }) => ({ at: 0, a })));
    expect((s.model as MazeModel).cell).toBe(c.layout.goal);
    expect(play(maze, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("a swipe is one tilt, and a finger kept moving tilts again", () => {
  const s = stage(maze, small.layout, phone);
  s.at = 400;
  swipe(s, 0);
  expect(s.moves).toEqual([{ at: 400, a: 0 }]);
  swipe(s, 1, 2);
  expect(s.moves.slice(1)).toEqual([
    { at: 400, a: 1 },
    { at: 400, a: 1 },
  ]);
  swipe(s, 2);
  swipe(s, 3);
  expect(s.moves.slice(3).map((m) => m.a)).toEqual([2, 3]);
});

test("one drag can turn a corner", () => {
  const s = stage(maze, small.layout, phone);
  s.down(mid);
  s.move({ x: mid.x + REACH * 1.1, y: mid.y + 3 });
  s.move({ x: mid.x + REACH * 1.2, y: mid.y + REACH * 1.2 });
  s.up({ x: mid.x + REACH * 1.2, y: mid.y + REACH * 1.2 });
  expect(s.moves.map((m) => m.a)).toEqual([0, 1]);
});

test("a wall stops the bit where it is", () => {
  const s = stage(maze, small.layout, phone);
  const model = s.model as MazeModel;
  const blocked = [0, 1, 2, 3].find((d) => !model.open(small.layout.start, d))!;
  swipe(s, blocked);
  expect(s.moves).toEqual([{ at: 0, a: blocked }]);
  expect(model.cell).toBe(small.layout.start);
});

test("a touch or a short nudge tilts nothing", () => {
  const s = stage(maze, small.layout, phone);
  s.tap(mid);
  s.drag(mid, { x: mid.x + 10, y: mid.y - 8 });
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer ends the swipe", () => {
  const s = stage(maze, small.layout, phone);
  s.down(mid);
  s.cancel();
  s.move({ x: mid.x + 200, y: mid.y });
  s.up({ x: mid.x + 200, y: mid.y });
  expect(s.moves).toEqual([]);
});

test("tilts follow the stronger axis and forgive the drift across it", () => {
  expect(tilts({ x: 0, y: 0 }, { x: 100, y: 20 }, 40).dirs).toEqual([0, 0]);
  expect(tilts({ x: 0, y: 0 }, { x: -45, y: 44 }, 40).dirs).toEqual([2]);
  expect(tilts({ x: 0, y: 0 }, { x: 5, y: -90 }, 40).dirs).toEqual([3, 3]);
  expect(tilts({ x: 0, y: 0 }, { x: 39, y: 39 }, 40)).toEqual({ dirs: [], anchor: { x: 0, y: 0 } });
});

test("every wall in the drawing is a wall in the model, both ways", () => {
  for (const c of cases) {
    const n = c.layout.size;
    const model = maze.start(c.layout) as MazeModel;
    for (let cell = 0; cell < n * n; cell++)
      for (let d = 0; d < 4; d++) {
        const nb = step(cell, d, n);
        if (nb === undefined) expect(model.open(cell, d)).toBe(false);
        else expect(model.open(nb, (d + 2) % 4)).toBe(model.open(cell, d));
      }
  }
});

test("a cell is wide enough to see under a thumb, on a phone and at full size", () => {
  for (const c of cases) {
    const size = c.name.endsWith("compact") ? phone : wide;
    const n = c.layout.size;
    const geo = geometry(n, size);
    expect(geo.cell).toBeGreaterThanOrEqual(HIT * 2);
    expect(geo.swipe).toBeGreaterThanOrEqual(HIT);
    const first: Point = centre(geo, n, 0);
    const last: Point = centre(geo, n, n * n - 1);
    expect(first.x - geo.cell / 2).toBeGreaterThanOrEqual(0);
    expect(first.y - geo.cell / 2).toBeGreaterThanOrEqual(0);
    expect(last.x + geo.cell / 2).toBeLessThanOrEqual(size.width);
    expect(last.y + geo.cell / 2).toBeLessThanOrEqual(size.height);
  }
});

test("the phone's cap of four cells a side is kept", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(4);
});

test("the scene cleans up after itself", () => {
  const s = stage(maze, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.hint({ at: 0, a: 0 });
  s.frame();
  expect(s.surface.querySelector(".hint")!.getAttribute("d")).not.toBe("");
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

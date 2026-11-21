import { expect, test } from "vite-plus/test";

import type { PuzzleLog } from "../src/api.ts";
import rewire from "../src/scenes/rewire/index.ts";
import { BROKE, DONE, GOING } from "../src/shell/kit.ts";
import { play } from "../src/shell/play.ts";
import { goldenCases } from "./golden.ts";

const c = goldenCases("rewire").find((x) => x.name === "level-3-full")!;
const log = (name: string): PuzzleLog => c.logs.find((l) => l.name === name)!.log;

test("the solve log solves, at its last move", () => {
  const out = play(rewire, c.layout, undefined, log("solve"), c.horizon);
  expect(out).toEqual({ status: DONE, at: log("solve").moves.at(-1)!.at, master: false });
});

test("the moves after a solve go to the inner panel, on the panel's own clock", () => {
  const seen: number[] = [];
  const out = play(rewire, c.layout, c.inner, log("master"), c.horizon, (at) => seen.push(at));
  expect(out.master).toBe(true);
  expect(out.at).toBe(log("solve").moves.at(-1)!.at);
  // The trace is stamped in the log's own ms all the way through.
  expect(seen).toEqual(seen.toSorted((a, b) => a - b));
  expect(seen.at(-1)).toBe(log("master").moves.at(-1)!.at);
});

test("without an inner panel the spare moves are not played", () => {
  const out = play(rewire, c.layout, undefined, log("master"), c.horizon);
  expect(out).toEqual({ status: DONE, at: log("solve").moves.at(-1)!.at, master: false });
});

test("a move stamped past the horizon is never played", () => {
  const moves = log("solve").moves;
  const out = play(rewire, c.layout, undefined, log("solve"), moves.at(-1)!.at - 1);
  expect(out.status).toBe(GOING);
  expect(out.at).toBe(moves.at(-2)!.at);
});

test("a stamp that runs backwards stops the replay", () => {
  const moves = log("solve").moves.map((m, i) => (i === 1 ? { ...m, at: -5 } : m));
  expect(play(rewire, c.layout, undefined, { moves }, c.horizon).status).toBe(GOING);
});

test("a move the family does not know breaks the machine", () => {
  const out = play(rewire, c.layout, undefined, { moves: [{ at: 10, a: 99, b: 0 }] }, c.horizon);
  expect(out).toEqual({ status: BROKE, at: 10, master: false });
});

test("an empty log leaves the machine going at rest", () => {
  expect(play(rewire, c.layout, undefined, { moves: [] }, c.horizon)).toEqual({
    status: GOING,
    at: 0,
    master: false,
  });
});

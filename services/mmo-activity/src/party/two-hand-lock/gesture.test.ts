// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { geometry } from "../../scenes/lock-dial/scene.ts";
import type { Point } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import twoHandLock from "./index.ts";
import type { TwoHandModel } from "./model.ts";

const phone = { width: 360, height: 420 };
const pair = partyCases("two-hand-lock").find((c) => c.name === "level-9-seats-2-shape-0")!;
const RANGE = pair.layout.range!;

// A finger on a dial's rim at a number, counted like the needle: clockwise from the top.
function rim(c: Point, r: number, at: number): Point {
  const a = (at / RANGE) * Math.PI * 2;
  return { x: c.x + Math.sin(a) * r * 0.8, y: c.y - Math.cos(a) * r * 0.8 };
}

// Sweeps a dial from 0 onto a number, arriving the way asked, and lets go.
function dialTo(s: Stage, c: Point, r: number, to: number, way: number): void {
  const detents = (((to * way) % RANGE) + RANGE) % RANGE || RANGE;
  s.down(rim(c, r, 0));
  for (let i = 1; i <= detents * 2; i++) s.move(rim(c, r, (way * i) / 2));
  s.up(rim(c, r, way * detents));
  s.frame();
}

function seats() {
  const first = stage(twoHandLock, pair.layout, { ...phone, seat: 0 });
  const second = stage(twoHandLock, pair.layout, { ...phone, seat: 1, model: first.model });
  const geo = geometry(pair.layout.size, playArea(phone));
  const set = (s: Stage, d: number, at: number) => {
    s.at = at;
    dialTo(s, geo.dials[d]!, geo.r, pair.layout.target![d]!, pair.layout.turn![d]!);
  };
  return { stages: [first, second], set, model: first.model as TwoHandModel };
}

test("each seat sets its own dial of the pair at once, and the pairs open the safe", () => {
  const { stages, set, model } = seats();
  for (let d = 0; d < pair.layout.size; d++) {
    set(stages[d % 2]!, d, Math.trunc(d / 2) * 500);
    for (const s of stages) s.frame();
  }
  const solve = pair.logs.find((l) => l.name === "solve")!;
  expect(solve.outcome.status).toBe(DONE);
  expect(model.k).toBe(pair.layout.size);
  const moves = [...stages[0]!.moves, ...stages[1]!.moves].sort((a, b) => a.at - b.at || a.a - b.a);
  expect(moves).toEqual(solve.log.moves.map((m) => ({ ...m, seat: m.seat ?? 0 })));
});

test("a dial set alone waits for its pair on both screens, and slips past the window", () => {
  const { stages, set, model } = seats();
  set(stages[0]!, 0, 0);
  for (const s of stages) s.frame();
  expect(model.clickedAt(0)).toBe(0);
  for (const s of stages) {
    expect(s.surface.querySelector(".party-bar circle.held")!.getAttribute("display")).toBe(
      "inline",
    );
    expect(s.surface.querySelector("svg.board:not(.party-bar) g.dial")!.classList).toContain(
      "open",
    );
  }
  expect(stages[1]!.surface.querySelector(".pb-say")!.textContent).toBe("Turn dial B with Seat 1");
  set(stages[1]!, 1, (pair.layout.window ?? 0) + 1);
  expect(model.k).toBe(0);
  expect(model.clickedAt(0)).toBeUndefined();
});

test("a seat cannot turn its partner's dial", () => {
  const { stages, set, model } = seats();
  set(stages[0]!, 1, 0);
  expect(stages[0]!.moves).toEqual([]);
  expect(model.snapshot()).toEqual([0, -1, -1]);
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

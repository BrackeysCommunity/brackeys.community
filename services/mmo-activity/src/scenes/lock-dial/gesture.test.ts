// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { HIT, type Point } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import { play } from "../../shell/play.ts";
import dial from "./index.ts";
import type { DialModel } from "./model.ts";
import { geometry, pick, settle } from "./scene.ts";

const cases = goldenCases("lock-dial");
const small = cases.find((c) => c.name === "level-1-full")!;
const capped = cases.find((c) => c.name === "level-9-compact")!;
const phone = { width: 360, height: 420 };
const wide = { width: 900, height: 560 };
const RANGE = small.layout.range!;

// A finger on a dial's rim at a number, counted like the needle: clockwise from the top.
function rim(c: Point, r: number, at: number): Point {
  const a = (at / RANGE) * Math.PI * 2;
  return { x: c.x + Math.sin(a) * r * 0.8, y: c.y - Math.cos(a) * r * 0.8 };
}

// Drags round a dial by some detents (clockwise when positive) without lifting.
function turn(s: Stage, c: Point, r: number, detents: number, from = 0): number {
  const way = Math.sign(detents);
  for (let i = 1; i <= Math.abs(detents) * 2; i++) s.move(rim(c, r, from + (way * i) / 2));
  return from + detents;
}

// Sweeps a dial from its number to another, arriving the way asked, and lets go.
function dialTo(s: Stage, c: Point, r: number, from: number, to: number, way: number): void {
  const detents = ((((to - from) * way) % RANGE) + RANGE) % RANGE || RANGE;
  s.down(rim(c, r, 0));
  const end = turn(s, c, r, way * detents);
  s.up(rim(c, r, end));
  s.frame();
}

test("sweeping each dial onto its number, the way its arrow points, opens the safe", () => {
  for (const c of [small, capped]) {
    const s = stage(dial, c.layout, phone);
    const geo = geometry(c.layout.size, phone);
    for (const [d, target] of c.layout.target!.entries())
      dialTo(s, geo.dials[d]!, geo.r, 0, target, c.layout.turn![d]!);
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    expect(s.moves).toEqual(
      solve.map(({ a, b, c: way }) => ({ at: 0, a, ...(b ? { b } : {}), c: way })),
    );
    expect(play(dial, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("letting go is one move: the dial, its number, and the way it was last turned", () => {
  const s = stage(dial, small.layout, phone);
  const geo = geometry(1, phone);
  s.at = 700;
  dialTo(s, geo.dials[0]!, geo.r, 0, 7, 1);
  expect(s.moves).toEqual([{ at: 700, a: 0, b: 7, c: 1 }]);
  // Back four the other way, from where the needle was left.
  dialTo(s, geo.dials[0]!, geo.r, 7, 3, -1);
  expect(s.moves[1]).toEqual({ at: 700, a: 0, b: 3, c: -1 });
});

test("the dial in turn clicks only when its needle comes onto its number the right way", () => {
  const s = stage(dial, small.layout, phone);
  const geo = geometry(1, phone);
  const c = geo.dials[0]!;
  const target = small.layout.target![0]!;
  const said = () => s.surface.querySelector(".said")!.textContent;
  s.down(rim(c, geo.r, 0));
  let at = turn(s, c, geo.r, target - 1);
  s.frame();
  expect(said()).toBe("");
  at = turn(s, c, geo.r, 1, at);
  s.frame();
  expect(said()).toBe("Click");
  expect(s.surface.querySelectorAll(".dial.caught")).toHaveLength(1);
  // Past it and back: the number is the same, the way is wrong, and there is no click.
  at = turn(s, c, geo.r, 2, at);
  at = turn(s, c, geo.r, -2, at);
  s.frame();
  expect(said()).toBe("");
  s.up(rim(c, geo.r, at));
  expect(s.moves).toEqual([{ at: 0, a: 0, b: target, c: -1 }]);
  expect((s.model as DialModel).k).toBe(0);
});

test("turning a dial out of turn drops the ones already open", () => {
  const two = cases.find((x) => x.layout.size === 2)!;
  const s = stage(dial, two.layout, phone);
  const geo = geometry(2, phone);
  const model = s.model as DialModel;
  dialTo(s, geo.dials[0]!, geo.r, 0, two.layout.target![0]!, two.layout.turn![0]!);
  expect(model.k).toBe(1);
  dialTo(s, geo.dials[0]!, geo.r, 0, 3, 1);
  expect(model.k).toBe(0);
});

test("a dial held but not turned, or a touch off every dial, is no move", () => {
  const s = stage(dial, small.layout, phone);
  const geo = geometry(1, phone);
  const c = geo.dials[0]!;
  s.tap(rim(c, geo.r, 5));
  s.drag(rim(c, geo.r, 0), rim(c, geo.r, 0.3));
  s.drag({ x: 2, y: 2 }, { x: 30, y: 2 });
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer leaves the dial where it was", () => {
  const s = stage(dial, small.layout, phone);
  const geo = geometry(1, phone);
  const c = geo.dials[0]!;
  s.down(rim(c, geo.r, 0));
  const at = turn(s, c, geo.r, 6);
  s.cancel();
  s.up(rim(c, geo.r, at));
  expect(s.moves).toEqual([]);
});

test("a needle changes detent only well past halfway", () => {
  expect(settle(4, 4.6)).toBe(4);
  expect(settle(4, 4.7)).toBe(5);
  expect(settle(5, 4.4)).toBe(5);
  expect(settle(5, 4.3)).toBe(4);
  expect(settle(0, -3)).toBe(-3);
});

test("every dial is big enough to turn with a thumb, on a phone and at full size", () => {
  for (const c of cases) {
    const size = c.name.endsWith("compact") ? phone : wide;
    const n = c.layout.size;
    const geo = geometry(n, size);
    expect(geo.r).toBeGreaterThanOrEqual(HIT * 2);
    for (const [d, at] of geo.dials.entries()) {
      expect(at.x - geo.r).toBeGreaterThanOrEqual(0);
      expect(at.x + geo.r).toBeLessThanOrEqual(size.width);
      expect(at.y - geo.r).toBeGreaterThanOrEqual(0);
      expect(at.y + geo.r).toBeLessThanOrEqual(size.height);
      expect(pick(geo, { x: at.x + geo.r - 1, y: at.y })).toBe(d);
      for (const other of geo.dials.slice(d + 1))
        expect(Math.hypot(at.x - other.x, at.y - other.y)).toBeGreaterThanOrEqual(geo.r * 2 + 20);
    }
  }
});

test("the phone's cap of three dials is kept", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(3);
});

test("the scene cleans up after itself", () => {
  const s = stage(dial, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.hint({ at: 0, a: 0, b: 18, c: 1 });
  s.frame();
  expect(s.surface.querySelector(".hint")!.getAttribute("d")).not.toBe("");
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

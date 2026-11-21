// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT, PICKUP } from "../../shell/board.ts";
import { BROKE, DONE } from "../../shell/kit.ts";
import { play } from "../../shell/play.ts";
import fuse from "./index.ts";
import type { FuseModel } from "./model.ts";
import { geometry, pick } from "./scene.ts";

const cases = goldenCases("fuse");
const small = cases.find((c) => c.name === "level-1-full")!;
const capped = cases.find((c) => c.name === "level-9-compact")!;
const phone = { width: 360, height: 420 };
const wide = { width: 900, height: 560 };
const none = () => false;

test("tapping the fuses in the order the cards allow clears the box", () => {
  for (const c of [small, capped]) {
    const s = stage(fuse, c.layout, phone);
    const geo = geometry(c.layout.size, c.layout.clues!.length, phone);
    for (const f of c.layout.order!) s.tap(geo.fuses[f]!);
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    expect(s.moves).toEqual(solve.map(({ a }) => ({ at: 0, a })));
    expect(play(fuse, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("the cards alone give the order", () => {
  for (const c of cases) {
    // Pull whichever fuse no card still holds back; the cards leave one each time.
    const left = new Set(c.layout.order);
    const order: number[] = [];
    while (left.size) {
      const free = [...left].filter(
        (f) => !c.layout.clues!.some((clue) => clue.after === f && left.has(clue.before)),
      );
      expect(free).toHaveLength(1);
      order.push(free[0]!);
      left.delete(free[0]!);
    }
    expect(order).toEqual(c.layout.order);
  }
});

test("a tap is one move, and the wrong fuse blows the box", () => {
  const s = stage(fuse, small.layout, phone);
  const geo = geometry(small.layout.size, small.layout.clues!.length, phone);
  const [first, second] = small.layout.order!;
  s.at = 800;
  s.tap(geo.fuses[first!]!);
  expect(s.moves).toEqual([{ at: 800, a: first }]);
  expect((s.model as FuseModel).pulled(first!)).toBe(true);
  const wrong = small.layout.order!.find((f) => f !== first && f !== second)!;
  s.tap(geo.fuses[wrong]!);
  expect(play(fuse, small.layout, undefined, { moves: s.moves }, small.horizon).status).toBe(BROKE);
});

test("a pulled fuse, a clue card and a finger that slides off pull nothing", () => {
  const s = stage(fuse, small.layout, phone);
  const geo = geometry(small.layout.size, small.layout.clues!.length, phone);
  const first = small.layout.order![0]!;
  s.tap(geo.fuses[first]!);
  s.tap(geo.fuses[first]!);
  s.tap({ x: geo.cards[0]!.x + 20, y: geo.cards[0]!.y + 10 });
  const next = small.layout.order![1]!;
  s.drag(geo.fuses[next]!, { x: geo.fuses[next]!.x, y: geo.fuses[next]!.y - geo.r * 4 });
  expect(s.moves).toHaveLength(1);
});

test("a cancelled pointer pulls nothing", () => {
  const s = stage(fuse, small.layout, phone);
  const geo = geometry(small.layout.size, small.layout.clues!.length, phone);
  const first = small.layout.order![0]!;
  s.down(geo.fuses[first]!);
  s.cancel();
  s.up(geo.fuses[first]!);
  expect(s.moves).toEqual([]);
});

test("a card whose fuses are both out is spent", () => {
  const s = stage(fuse, small.layout, phone);
  const geo = geometry(small.layout.size, small.layout.clues!.length, phone);
  expect(s.surface.querySelectorAll(".card.spent")).toHaveLength(0);
  s.tap(geo.fuses[small.layout.order![0]!]!);
  s.tap(geo.fuses[small.layout.order![1]!]!);
  expect(s.surface.querySelectorAll(".card.spent")).toHaveLength(1);
});

test("a thumb can tap every fuse, and every card fits, on a phone and at full size", () => {
  for (const c of cases) {
    const size = c.name.endsWith("compact") ? phone : wide;
    const n = c.layout.size;
    const geo = geometry(n, c.layout.clues!.length, size);
    expect(geo.r).toBeGreaterThanOrEqual(HIT);
    for (const [f, at] of geo.fuses.entries()) {
      expect(pick(geo, none, at)).toBe(f);
      expect(pick(geo, none, { x: at.x - geo.r + 1, y: at.y })).toBe(f);
      expect(pick(geo, (x) => x === f, at)).toBeUndefined();
      expect(at.x - geo.r).toBeGreaterThanOrEqual(0);
      expect(at.x + geo.r).toBeLessThanOrEqual(size.width);
      expect(at.y + geo.r * 1.25 + 22).toBeLessThanOrEqual(size.height);
      for (const other of geo.fuses.slice(f + 1))
        expect(Math.hypot(at.x - other.x, at.y - other.y)).toBeGreaterThanOrEqual(geo.r * 2);
    }
    const top = Math.min(...geo.fuses.map((p) => p.y)) - geo.r * PICKUP;
    for (const at of geo.cards) {
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x + geo.card.width).toBeLessThanOrEqual(size.width);
      // No card sits where a tap would pull a fuse.
      expect(at.y + geo.card.height).toBeLessThanOrEqual(top);
    }
    expect(geo.card.width).toBeGreaterThanOrEqual(112);
    expect(geo.card.height).toBeGreaterThanOrEqual(24);
  }
});

test("the phone's cap of six fuses is kept", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(6);
});

test("the scene cleans up after itself", () => {
  const s = stage(fuse, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.hint({ at: 0, a: 1 });
  s.frame();
  expect(s.surface.querySelectorAll(".plug.hinted")).toHaveLength(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

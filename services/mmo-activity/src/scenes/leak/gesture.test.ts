// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { SHAPES_DIR, goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT, PICKUP, distance } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import leak from "./index.ts";
import type { LeakModel } from "./model.ts";
import { BRANCH_SHAPE, geometry, land } from "./scene.ts";

const cases = goldenCases("leak");
const small = cases.find((c) => c.name === "level-1-full")!;
const phone = { width: 360, height: 420 };
const desk = { width: 900, height: 560 };
const sizeOf = (name: string) => (name.endsWith("compact") ? phone : desk);

test("the solve played by pointer: a tap on its joint for every leak", () => {
  for (const c of cases) {
    const size = sizeOf(c.name);
    const s = stage(leak, c.layout, size);
    const geo = geometry(c.layout.size, size);
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      s.at = m.at;
      s.tap(geo.slots[m.a]!);
    }
    expect(s.moves, c.name).toEqual(solve.log.moves);
    expect(s.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
  }
});

test("a tap is sent the moment the finger lands, and one that misses every joint is not", () => {
  const s = stage(leak, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  s.at = 900;
  s.down(geo.slots[1]!);
  expect(s.moves).toEqual([{ at: 900, a: 1 }]);
  s.up(geo.slots[1]!);
  s.tap({ x: geo.slots[1]!.x, y: geo.top });
  expect(s.moves).toHaveLength(1);
});

test("a second finger taps while the first is still down", () => {
  const s = stage(leak, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  s.at = 50;
  s.down(geo.slots[0]!);
  s.down(geo.slots[2]!);
  expect(s.moves.map((m) => m.a)).toEqual([0, 2]);
});

test("a dry joint tapped knocks pressure out, and a leak tapped does not", () => {
  const s = stage(leak, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const model = s.model as LeakModel;
  const [at, slot] = small.layout.track!;
  s.at = at! * small.layout.step!;
  s.model.run(s.at);
  const before = model.gauge;
  s.tap(geo.slots[slot!]!);
  expect(model.gauge).toBe(before);
  s.tap(geo.slots[slot!]!);
  expect(model.gauge).toBe(before - small.layout.par![2]!);
});

test("each joint says in words whether it leaks, is held or is sealed", () => {
  const c = cases.find((x) => x.layout.track!.some((v, i) => i % 4 === 2 && v > 1))!;
  const s = stage(leak, c.layout, desk);
  const geo = geometry(c.layout.size, desk);
  const model = s.model as LeakModel;
  const t = c.layout.track!;
  const row = t.findIndex((v, i) => i % 4 === 2 && v > 1) - 2;
  const slot = t[row + 1]!;
  const word = () => s.surface.querySelectorAll(".word")[slot]!.textContent;
  s.frame();
  expect(word()).toBe("");
  s.at = t[row]! * c.layout.step!;
  s.model.run(s.at);
  s.frame();
  expect(word()).toBe("leak");
  s.tap(geo.slots[slot]!);
  expect(word()).toBe("held");
  expect(model.left[slot]).toBe(t[row + 2]! - 1);
  // The clamp slips after its hold, and the leak is open again.
  s.at += t[row + 3]! * c.layout.step!;
  s.model.run(s.at);
  s.frame();
  expect(word()).toBe("leak");
  for (let i = model.left[slot]!; i > 0; i--) {
    s.tap(geo.slots[slot]!);
    s.at += (t[row + 3]! + 1) * c.layout.step!;
    s.model.run(s.at);
  }
  s.frame();
  expect(word()).toBe("sealed");
});

test("the first tap only arms the machine, and costs nothing", () => {
  const s = stage(leak, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const model = s.model as LeakModel;
  s.tap(geo.slots[0]!);
  expect(s.arms).toBe(1);
  expect(s.moves).toEqual([]);
  expect(model.gauge).toBe(model.full);
  // Once the clock runs, a tap is a tap.
  s.at = 50;
  s.tap(geo.slots[0]!);
  expect(s.arms).toBe(1);
  expect(s.moves).toEqual([{ at: 50, a: 0 }]);
});

test("a thumb can tap every joint on a phone and at full size", () => {
  for (const c of cases) {
    const size = sizeOf(c.name);
    const geo = geometry(c.layout.size, size);
    expect(geo.r, c.name).toBeGreaterThanOrEqual(HIT);
    for (const [i, s] of geo.slots.entries()) {
      // Each joint is the nearest to its own edge, and sits on the surface.
      expect(land(geo, { x: s.x, y: s.y + geo.r * PICKUP - 1 }).slot, c.name).toBe(i);
      expect(s.x - geo.r, c.name).toBeGreaterThanOrEqual(0);
      expect(s.x + geo.r, c.name).toBeLessThanOrEqual(size.width);
      expect(s.y + geo.r, c.name).toBeLessThan(size.height);
      for (const other of geo.slots.slice(i + 1))
        expect(distance(s, other), c.name).toBeGreaterThanOrEqual(geo.r * 2);
    }
    expect(land(geo, { x: geo.slots[0]!.x, y: geo.top }).slot, c.name).toBeUndefined();
  }
});

test("the phone's cap of five joints holds", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(5);
});

test("a hint and the guide mark the joint that springs next", () => {
  const s = stage(leak, small.layout, { ...phone, guide: { at: 0, a: 1 } });
  const joint = (i: number) => s.surface.querySelectorAll(".joint")[i]!;
  s.frame();
  expect(joint(1).classList.contains("guided")).toBe(true);
  s.hint({ at: 0, a: 2 });
  s.frame();
  expect(joint(2).classList.contains("hinted")).toBe(true);
  expect(s.surface.querySelectorAll(".word")[2]!.textContent).toBe("next");
  // Once a leak has sprung the guide's first move is spent.
  s.at = small.layout.track![0]! * small.layout.step!;
  s.model.run(s.at);
  s.frame();
  expect(joint(1).classList.contains("guided")).toBe(false);
});

test("the scene cleans up after itself", () => {
  const s = stage(leak, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

const branches = goldenCases("leak", SHAPES_DIR);

test("on the branching pipe, the solve played by pointer: a tap on its joint for every leak", () => {
  for (const c of branches) {
    expect(c.layout.shape).toBe(1);
    const size = sizeOf(c.name);
    const s = stage(leak, c.layout, size);
    const geo = geometry(c.layout.size, size, c.layout.shape);
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      s.at = m.at;
      s.tap(geo.slots[m.a]!);
    }
    expect(s.moves, c.name).toEqual(solve.log.moves);
    expect(s.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
  }
});

test("the branching pipe has a trunk and two arms, every joint on one, and a thumb between any two", () => {
  for (const n of [4, 5, 6, 7]) {
    for (const size of [phone, desk]) {
      const geo = geometry(n, size, BRANCH_SHAPE);
      expect(geo.runs).toHaveLength(3);
      expect(geo.r).toBeGreaterThanOrEqual(HIT);
      const onRuns = geo.runs.flat();
      for (const [i, p] of geo.slots.entries()) {
        expect(onRuns).toContainEqual(p);
        expect(land(geo, p).slot).toBe(i);
        for (const q of geo.slots.slice(i + 1))
          expect(distance(p, q)).toBeGreaterThanOrEqual(geo.r * 2);
      }
    }
  }
  const s = stage(leak, branches[0]!.layout, phone);
  expect(s.surface.querySelector(".pipe")!.getAttribute("d")!.match(/M/g)).toHaveLength(3);
});

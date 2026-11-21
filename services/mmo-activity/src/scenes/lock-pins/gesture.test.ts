// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { SHAPES_DIR, goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT, distance } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import { play } from "../../shell/play.ts";
import pins from "./index.ts";
import type { PinsModel } from "./model.ts";
import { HEIGHTS, cuts, geometry, gripAt, heightOf, local, pick, slots } from "./scene.ts";

const cases = goldenCases("lock-pins");
const small = cases.find((c) => c.name === "level-1-full")!;
const capped = cases.find((c) => c.name === "level-9-compact")!;
const phone = { width: 360, height: 420 };
const wide = { width: 900, height: 560 };

const count = (c: (typeof cases)[number]) => c.layout.size + (c.layout.false?.length ?? 0);

// Lifts a pin by its grip to a height and lets go.
function lift(s: ReturnType<typeof stage>, c: (typeof cases)[number], pin: number, height: number) {
  const geo = geometry(count(c), phone);
  const col = geo.cols[slots(c.layout)[pin]!]!;
  s.drag({ x: col.x, y: col.rest }, { x: col.x, y: col.rest - height * geo.notch });
}

test("lifting each pin to the line, in the order they bind, opens the lock", () => {
  for (const c of [small, capped]) {
    const s = stage(pins, c.layout, phone);
    for (const pin of c.layout.order!) lift(s, c, pin, c.layout.target![pin]!);
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    expect(s.moves).toEqual(solve.map(({ a, b }) => ({ at: 0, a, b })));
    expect(play(pins, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("a lift is one move: the pin, then the height it was left at", () => {
  const s = stage(pins, small.layout, phone);
  s.at = 900;
  lift(s, small, 1, 3);
  expect(s.moves).toEqual([{ at: 900, a: 1, b: 3 }]);
});

test("the wrong pin, or the right pin at the wrong height, drops them all", () => {
  const s = stage(pins, small.layout, phone);
  const model = s.model as PinsModel;
  const [first, second] = small.layout.order!;
  lift(s, small, first!, small.layout.target![first!]!);
  expect(model.k).toBe(1);
  const wrong = (small.layout.target![second!]! % HEIGHTS) + 1;
  lift(s, small, second!, wrong);
  expect(model.k).toBe(0);
});

test("a pin put back down, or a touch beside the lock, is no move", () => {
  const s = stage(pins, small.layout, phone);
  const geo = geometry(count(small), phone);
  const col = geo.cols[0]!;
  s.drag({ x: col.x, y: col.rest }, { x: col.x, y: col.rest - geo.notch * 0.4 });
  s.drag({ x: col.x, y: col.rest }, { x: col.x, y: col.rest + 60 });
  s.drag({ x: 4, y: col.rest }, { x: 4, y: col.rest - geo.notch * 2 });
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer lets the pin fall", () => {
  const s = stage(pins, small.layout, phone);
  const geo = geometry(count(small), phone);
  const col = geo.cols[0]!;
  s.down({ x: col.x, y: col.rest });
  s.move({ x: col.x, y: col.rest - geo.notch * 2 });
  s.cancel();
  s.up({ x: col.x, y: col.rest - geo.notch * 2 });
  expect(s.moves).toEqual([]);
});

test("a set pin stays set under a finger", () => {
  const s = stage(pins, small.layout, phone);
  const first = small.layout.order![0]!;
  lift(s, small, first, small.layout.target![first]!);
  lift(s, small, first, 1);
  expect(s.moves).toHaveLength(1);
});

test("a held pin says whether it binds", () => {
  const s = stage(pins, small.layout, phone);
  const geo = geometry(count(small), phone);
  const slot = slots(small.layout);
  const tell = () => s.surface.querySelector(".tell")!.textContent;
  for (const [pin, want] of [
    [small.layout.order![0]!, "Binds"],
    [small.layout.order![1]!, "Loose"],
  ] as const) {
    const col = geo.cols[slot[pin]!]!;
    s.down({ x: col.x, y: col.rest });
    s.frame();
    expect(tell()).toBe(want);
    s.up({ x: col.x, y: col.rest });
    s.frame();
    expect(tell()).toBe("");
  }
  expect(s.moves).toEqual([]);
});

test("the false pins are drawn among the others, each with a cut", () => {
  for (const c of cases) {
    const slot = slots(c.layout);
    expect([...slot].sort((a, b) => a - b)).toEqual(slot.map((_, i) => i));
    expect(slots(c.layout)).toEqual(slot);
    const cut = cuts(c.layout);
    expect(cut.slice(0, c.layout.size)).toEqual(c.layout.target);
    for (const h of cut) expect(h >= 1 && h <= HEIGHTS).toBe(true);
  }
});

test("a thumb can pick every pin, and every height is a notch apart, on a phone and at full size", () => {
  for (const c of cases) {
    const size = c.name.endsWith("compact") ? phone : wide;
    const geo = geometry(count(c), size);
    expect(geo.r).toBeGreaterThanOrEqual(HIT);
    expect(geo.notch).toBeGreaterThanOrEqual(12);
    for (const [slot, col] of geo.cols.entries()) {
      expect(pick(geo, { x: col.x - geo.r + 1, y: col.rest })).toBe(slot);
      expect(pick(geo, { x: col.x + geo.r - 1, y: col.line })).toBe(slot);
      // The whole lift fits on the surface.
      expect(col.top).toBeGreaterThanOrEqual(0);
      expect(col.rest + geo.grip).toBeLessThanOrEqual(size.height);
      expect(col.x - geo.r).toBeGreaterThanOrEqual(0);
      expect(col.x + geo.r).toBeLessThanOrEqual(size.width);
    }
    for (let h = 0; h <= HEIGHTS; h++) expect(heightOf(geo, h * geo.notch)).toBe(h);
    expect(heightOf(geo, geo.notch * 0.4)).toBe(0);
    expect(heightOf(geo, geo.notch * 9)).toBe(HEIGHTS);
  }
});

test("the phone's cap of six pins is kept", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(6);
});

test("the scene cleans up after itself", () => {
  const s = stage(pins, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.hint({ at: 0, a: 0, b: 2 });
  s.frame();
  expect(s.surface.querySelectorAll(".pin.hinted")).toHaveLength(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

const wheels = goldenCases("lock-pins", SHAPES_DIR);

test("on the pin wheel, pushing each pin toward the hub, in the order they bind, opens the lock", () => {
  for (const c of [
    wheels.find((x) => x.name === "level-3-full")!,
    wheels.find((x) => x.name === "level-7-compact")!,
  ]) {
    expect(c.layout.shape).toBe(1);
    const s = stage(pins, c.layout, phone);
    const geo = geometry(count(c), phone, c.layout.shape);
    expect(geo.hub).toBeDefined();
    for (const pin of c.layout.order!) {
      const slot = slots(c.layout)[pin]!;
      s.drag(gripAt(geo, slot), gripAt(geo, slot, c.layout.target![pin]! * geo.notch));
    }
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    expect(s.moves).toEqual(solve.map(({ a, b }) => ({ at: 0, a, b })));
    expect(play(pins, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("on the pin wheel a thumb picks each pin by its spoke, and the hub picks none", () => {
  for (const c of wheels) {
    const size = c.name.endsWith("compact") ? phone : wide;
    const geo = geometry(count(c), size, c.layout.shape);
    for (let slot = 0; slot < count(c); slot++) {
      expect(pick(geo, gripAt(geo, slot))).toBe(slot);
      expect(local(geo, slot, gripAt(geo, slot)).x).toBeCloseTo(geo.cols[slot]!.x);
    }
    expect(pick(geo, geo.hub!)).toBeUndefined();
    // Every grip stays on the surface.
    for (let slot = 0; slot < count(c); slot++) {
      const g = gripAt(geo, slot);
      expect(g.x - geo.grip).toBeGreaterThanOrEqual(0);
      expect(g.y - geo.grip).toBeGreaterThanOrEqual(0);
      expect(g.x + geo.grip).toBeLessThanOrEqual(size.width);
      expect(g.y + geo.grip).toBeLessThanOrEqual(size.height);
    }
    // Neighbouring grips do not share a thumb.
    expect(distance(gripAt(geo, 0), gripAt(geo, 1))).toBeGreaterThanOrEqual(HIT * 2);
  }
});

test("on the pin wheel a pin pushed back out is no move", () => {
  const c = wheels[0]!;
  const s = stage(pins, c.layout, phone);
  const geo = geometry(count(c), phone, c.layout.shape);
  s.drag(gripAt(geo, 0), gripAt(geo, 0, -40));
  expect(s.moves).toEqual([]);
});

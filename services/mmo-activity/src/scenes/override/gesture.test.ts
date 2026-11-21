// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { SHAPES_DIR, goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT, type Point } from "../../shell/board.ts";
import { BROKE, DONE } from "../../shell/kit.ts";
import { play } from "../../shell/play.ts";
import override from "./index.ts";
import type { OverrideModel } from "./model.ts";
import { geometry, onScreen, pace, pick, showing } from "./scene.ts";

const cases = goldenCases("override");
const small = cases.find((c) => c.name === "level-1-full")!;
const long = cases.find((c) => c.name === "level-9-full")!;
const phone = { width: 360, height: 420 };
const wide = { width: 900, height: 560 };
const SYMBOLS = small.layout.range!;

const middle = (box: { x: number; y: number; width: number; height: number }): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

test("pressing every round back, one symbol longer each time, overrides the terminal", () => {
  for (const c of [small, long]) {
    const s = stage(override, c.layout, phone);
    const geo = geometry(SYMBOLS, phone);
    for (let round = 0; round < c.layout.size; round++)
      for (const symbol of c.layout.order!.slice(0, round + 1)) s.tap(middle(geo.pads[symbol]!));
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    expect(s.moves).toEqual(solve.map(({ a }) => ({ at: 0, a })));
    expect(play(override, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("a press takes the moment the finger lands, one move a press", () => {
  const s = stage(override, small.layout, phone);
  const geo = geometry(SYMBOLS, phone);
  const first = small.layout.order![0]!;
  s.at = 600;
  s.down(middle(geo.pads[first]!));
  expect(s.moves).toEqual([{ at: 600, a: first }]);
  s.up(middle(geo.pads[first]!));
  expect(s.moves).toHaveLength(1);
  expect((s.model as OverrideModel).progress()).toEqual({ round: 1, entered: 0 });
});

test("a wrong pad breaks the machine", () => {
  const s = stage(override, small.layout, phone);
  const geo = geometry(SYMBOLS, phone);
  const wrong = (small.layout.order![0]! + 1) % SYMBOLS;
  s.tap(middle(geo.pads[wrong]!));
  expect(play(override, small.layout, undefined, { moves: s.moves }, small.horizon).status).toBe(
    BROKE,
  );
});

test("a touch on the screen shows the round again and presses nothing", () => {
  const s = stage(override, small.layout, phone);
  const geo = geometry(SYMBOLS, phone);
  s.tap(middle(geo.screen));
  s.tap({ x: 2, y: 2 });
  expect(s.moves).toEqual([]);
  expect(s.surface.querySelector(".said")!.textContent).toBe("Watch");
  const first = small.layout.order![0]!;
  expect(s.surface.querySelectorAll(".pad.shown")).toHaveLength(1);
  expect(s.surface.querySelectorAll(".pad")[first]!.getAttribute("class")).toContain("shown");
});

test("a round is shown symbol by symbol, with a gap between two alike", () => {
  const order = [2, 2, 1];
  const slot = pace(2);
  expect(showing(order, 2, 0)).toBe(2);
  expect(showing(order, 2, slot * 0.9)).toBeUndefined();
  expect(showing(order, 2, slot)).toBe(2);
  expect(showing(order, 2, slot * 2)).toBe(1);
  expect(showing(order, 2, slot * 3)).toBeUndefined();
  expect(showing(order, 1, slot * 2.1)).toBeUndefined();
  expect(showing(order, 2, -50)).toBeUndefined();
  // Longer rounds are shown faster, and never too fast to read.
  expect(pace(11)).toBeLessThan(pace(0));
  expect(pace(40)).toBeGreaterThanOrEqual(180);
});

test("a thumb can drum every pad, on a phone and at full size", () => {
  for (const size of [phone, wide, { width: 640, height: 300 }]) {
    const geo = geometry(SYMBOLS, size);
    for (const [i, box] of geo.pads.entries()) {
      expect(Math.min(box.width, box.height) / 2).toBeGreaterThanOrEqual(HIT);
      expect(pick(geo, middle(box))).toBe(i);
      expect(pick(geo, { x: box.x + 1, y: box.y + 1 })).toBe(i);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }
    expect(pick(geo, middle(geo.screen))).toBeUndefined();
  }
});

test("the scene cleans up after itself", () => {
  const s = stage(override, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.hint({ at: 0, a: 2 });
  s.frame();
  expect(s.surface.querySelectorAll(".pad.hinted")).toHaveLength(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

const pads = goldenCases("override", SHAPES_DIR);

test("on the ring pad, pressing every round back round the ring overrides the terminal", () => {
  for (const c of [
    pads.find((x) => x.name === "level-3-full")!,
    pads.find((x) => x.name === "level-7-full")!,
  ]) {
    expect(c.layout.shape).toBe(1);
    expect(c.layout.range).toBe(6);
    const s = stage(override, c.layout, phone);
    const geo = geometry(c.layout.range!, phone, c.layout.shape);
    expect(geo.ring).toBeDefined();
    for (let round = 0; round < c.layout.size; round++)
      for (const symbol of c.layout.order!.slice(0, round + 1)) s.tap(middle(geo.pads[symbol]!));
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    expect(s.moves).toEqual(solve.map(({ a }) => ({ at: 0, a })));
    expect(play(override, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("on the ring pad each arc is its own pad out to the rim, and the round screen shows the round again", () => {
  for (const size of [phone, wide]) {
    const geo = geometry(6, size, 1);
    const ring = geo.ring!;
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2 - Math.PI / 2;
      for (const radius of [ring.inner + 2, (ring.inner + ring.outer) / 2, ring.outer - 2])
        expect(
          pick(geo, { x: ring.hub.x + radius * Math.cos(a), y: ring.hub.y + radius * Math.sin(a) }),
        ).toBe(p);
      expect(Math.min(geo.pads[p]!.width, ring.outer - ring.inner)).toBeGreaterThanOrEqual(HIT);
    }
    expect(pick(geo, ring.hub)).toBeUndefined();
    expect(onScreen(geo, ring.hub)).toBe(true);
    expect(onScreen(geo, middle(geo.pads[0]!))).toBe(false);
  }
  const s = stage(override, pads[0]!.layout, phone);
  const geo = geometry(6, phone, 1);
  s.tap(geo.ring!.hub);
  expect(s.moves).toEqual([]);
});

// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT, PICKUP } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import rewire from "./index.ts";
import type { RewireModel } from "./model.ts";
import { geometry, land, pick } from "./scene.ts";

const cases = goldenCases("rewire");
const small = cases.find((c) => c.name === "level-1-full")!;
const phone = { width: 360, height: 420 };

test("dragging each plug to its port solves the box", () => {
  const s = stage(rewire, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const model = s.model as RewireModel;
  for (const [w, port] of small.layout.target!.entries()) {
    if (model.at[w] === port) continue;
    s.drag(geo.seats[model.at[w]!]!, geo.seats[port]!);
  }
  expect(model.at).toEqual(small.layout.target);
  expect(s.moves.at(-1)).toEqual({ at: 0, a: expect.any(Number), b: expect.any(Number) });
  expect(model.apply({ at: 0, a: 0, b: model.at[0]! })).toBe(DONE);
});

test("a drag is one move: the wire, then the port", () => {
  const s = stage(rewire, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  s.at = 1200;
  s.drag(geo.seats[0]!, geo.seats[2]!);
  expect(s.moves).toEqual([{ at: 1200, a: 0, b: 2 }]);
});

test("a drop that misses every port moves nothing", () => {
  const s = stage(rewire, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  s.drag(geo.seats[0]!, { x: 40, y: 20 });
  s.drag(geo.seats[1]!, geo.seats[1]!);
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer drops the drag", () => {
  const s = stage(rewire, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  s.down(geo.seats[0]!);
  s.move(geo.seats[2]!);
  s.cancel();
  s.up(geo.seats[2]!);
  expect(s.moves).toEqual([]);
});

test("a plug can be tapped, then a port tapped", () => {
  const s = stage(rewire, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  s.tap(geo.seats[1]!);
  s.tap(geo.seats[2]!);
  expect(s.moves).toEqual([{ at: 0, a: 1, b: 2 }]);
  // The tap is spent: the next one picks a plug up again.
  s.tap(geo.seats[0]!);
  s.tap(geo.seats[0]!);
  expect(s.moves).toHaveLength(1);
});

test("a thumb can hit every piece on a phone and at full size", () => {
  for (const c of cases) {
    const size = c.name.endsWith("compact") ? phone : { width: 900, height: 560 };
    const n = c.layout.size;
    const geo = geometry(n, size);
    expect(geo.r).toBeGreaterThanOrEqual(HIT);
    // Neighbouring plugs do not share a hit circle.
    expect(geo.seats[1]!.y - geo.seats[0]!.y).toBeGreaterThanOrEqual(geo.r * 2);
    const at = Array.from({ length: n }, (_, i) => i);
    for (let p = 0; p < n; p++) {
      const off = { x: geo.seats[p]!.x - geo.r * PICKUP + 1, y: geo.seats[p]!.y };
      expect(pick(geo, at, off)).toBe(p);
      expect(land(geo, off).port).toBe(p);
    }
    expect(pick(geo, at, { x: geo.sources[0]!.x, y: geo.sources[0]!.y })).toBeUndefined();
  }
});

test("the phone's cap of six wires leaves room for a thumb", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(6);
});

test("the scene cleans up after itself", () => {
  const s = stage(rewire, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.hint({ at: 0, a: 0, b: 1 });
  s.frame();
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

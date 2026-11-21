// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT, PICKUP } from "../../shell/board.ts";
import { BROKE, DONE } from "../../shell/kit.ts";
import pressure from "./index.ts";
import type { PressureModel } from "./model.ts";
import { NOTCH, geometry, needleY, pick } from "./scene.ts";

const cases = goldenCases("pressure");
const small = cases.find((c) => c.name === "level-1-full")!;
const phone = { width: 360, height: 420 };
const desk = { width: 900, height: 560 };
const sizeOf = (name: string) => (name.endsWith("compact") ? phone : desk);

// A drag of a little over n notches, up the screen for n above 0.
const by = (n: number) => -(Math.abs(n) + 0.2) * NOTCH * Math.sign(n);

test("the solve played by pointer: a notch of drag on its wheel for every turn", () => {
  for (const c of cases) {
    const s = stage(pressure, c.layout, sizeOf(c.name));
    const geo = geometry(c.layout.size, sizeOf(c.name));
    const solve = c.logs.find((l) => l.name === "solve")!;
    for (const m of solve.log.moves) {
      s.at = m.at;
      const w = geo.wheels[m.a]!;
      s.drag(w, { x: w.x, y: w.y + by(m.b!) });
    }
    expect(s.moves, c.name).toEqual(solve.log.moves);
    expect(s.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
  }
});

test("a long drag turns the valve a notch at a time, and back again", () => {
  const s = stage(pressure, small.layout, phone);
  const w = geometry(small.layout.size, phone).wheels[1]!;
  s.down(w);
  s.move({ x: w.x, y: w.y + by(2) });
  s.move({ x: w.x + 30, y: w.y + by(2) });
  expect(s.moves).toEqual([
    { at: 0, a: 1, b: 1 },
    { at: 0, a: 1, b: 1 },
  ]);
  s.move({ x: w.x, y: w.y + 0.1 * NOTCH });
  s.up(w);
  expect(s.moves.slice(2)).toEqual([
    { at: 0, a: 1, b: -1 },
    { at: 0, a: 1, b: -1 },
  ]);
});

test("a wheel picked up and put down turns nothing, and a miss picks nothing up", () => {
  const s = stage(pressure, small.layout, phone);
  const geo = geometry(small.layout.size, phone);
  const w = geo.wheels[0]!;
  s.drag(w, { x: w.x, y: w.y - NOTCH + 2 });
  s.drag({ x: w.x, y: geo.top + 10 }, { x: w.x, y: geo.top + 10 + NOTCH * 3 });
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer drops the wheel", () => {
  const s = stage(pressure, small.layout, phone);
  const w = geometry(small.layout.size, phone).wheels[0]!;
  s.down(w);
  s.cancel();
  s.move({ x: w.x, y: w.y + by(3) });
  s.up(w);
  expect(s.moves).toEqual([]);
});

test("a burst ends the drag where it happened", () => {
  const s = stage(pressure, small.layout, phone);
  const model = s.model as PressureModel;
  const w = geometry(small.layout.size, phone).wheels[1]!;
  const turns = Math.ceil((small.layout.range! - model.v[1]!) / model.nudge);
  s.down(w);
  s.move({ x: w.x, y: w.y + by(turns + 4) });
  s.up(w);
  expect(s.moves).toHaveLength(turns);
  expect(model.apply({ at: 0, a: 1, b: 1 })).toBe(BROKE);
});

test("each gauge says where its needle is in words", () => {
  const s = stage(pressure, small.layout, phone);
  const model = s.model as PressureModel;
  const words = () => [...s.surface.querySelectorAll(".state")].map((n) => n.textContent);
  const said = (v: number) => (v > model.hi ? "high" : v < model.lo ? "low" : "ok");
  expect(words()).toEqual(model.v.map(said));
  const w = geometry(small.layout.size, phone).wheels[0]!;
  s.drag(w, { x: w.x, y: w.y + by(1) });
  expect(words()).toEqual(model.v.map(said));
  expect(s.surface.querySelector(".status")!.textContent).toMatch(/band/);
});

test("a thumb can hold every wheel on a phone and at full size", () => {
  for (const c of cases) {
    const size = sizeOf(c.name);
    const geo = geometry(c.layout.size, size);
    expect(geo.r).toBeGreaterThanOrEqual(HIT);
    expect(geo.wheels[1]!.x - geo.wheels[0]!.x).toBeGreaterThanOrEqual(geo.r * 2);
    for (const [i, w] of geo.wheels.entries()) {
      expect(pick(geo, { x: w.x, y: w.y + geo.r * PICKUP - 1 }).valve).toBe(i);
      expect(w.y + geo.r).toBeLessThan(size.height);
    }
    expect(pick(geo, { x: geo.wheels[0]!.x, y: geo.top }).valve).toBeUndefined();
    // The gauge has room to show a turn of a valve.
    expect(needleY(geo, 0, 100) - needleY(geo, 100, 100)).toBeGreaterThan(80);
  }
});

test("the phone's cap of four valves holds", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(4);
});

test("a hint and the guide draw which way to drag a wheel", () => {
  const s = stage(pressure, small.layout, { ...phone, guide: { at: 0, a: 0, b: 1 } });
  expect(s.surface.querySelector(".guide")!.getAttribute("d")).not.toBe("");
  s.hint({ at: 0, a: 2, b: -1 });
  s.frame();
  expect(s.surface.querySelector(".hint")!.getAttribute("d")).not.toBe("");
  // Once a valve has been turned the guide's first move is spent.
  const w = geometry(small.layout.size, phone).wheels[0]!;
  s.drag(w, { x: w.x, y: w.y + by(1) });
  expect(s.surface.querySelector(".guide")!.getAttribute("d")).toBe("");
});

test("the scene cleans up after itself", () => {
  const s = stage(pressure, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

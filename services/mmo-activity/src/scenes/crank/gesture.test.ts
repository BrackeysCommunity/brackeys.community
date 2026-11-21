// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { SHAPES_DIR, goldenCases } from "../../../test/golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { HIT, type Point } from "../../shell/board.ts";
import { angleOf, sweep } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import crank from "./index.ts";
import type { CrankModel } from "./model.ts";
import { DEAD, Pump, QUARTER, geometry } from "./scene.ts";

const cases = goldenCases("crank");
const small = cases.find((c) => c.name === "level-1-full")!;
const phone = { width: 360, height: 420 };
const desk = { width: 900, height: 560 };

// A point on the wheel's rim at an angle, clockwise from three o'clock.
function rim(size: { width: number; height: number }, deg: number): Point {
  const geo = geometry(size);
  const rad = (deg * Math.PI) / 180;
  return { x: geo.hub.x + geo.r * Math.cos(rad), y: geo.hub.y + geo.r * Math.sin(rad) };
}

// Winds from one angle to another in steps of 45 degrees at most.
function wind(s: Stage, size: { width: number; height: number }, from: number, to: number): void {
  const steps = Math.ceil(Math.abs(to - from) / 45);
  for (let i = 1; i <= steps; i++) s.move(rim(size, from + ((to - from) * i) / steps));
}

test("the solve played by pointer: a quarter turn clockwise for every pulse", () => {
  for (const [i, c] of cases.entries()) {
    const size = i % 2 ? phone : desk;
    const s = stage(crank, c.layout, size);
    const solve = c.logs.find((l) => l.name === "solve")!;
    // A few degrees in hand, so each quarter lands inside a move.
    let angle = 5;
    s.down(rim(size, 0));
    s.move(rim(size, angle));
    for (const m of solve.log.moves) {
      s.at = m.at;
      wind(s, size, angle, angle + QUARTER);
      angle += QUARTER;
    }
    s.up(rim(size, angle));
    expect(s.moves, c.name).toEqual(solve.log.moves);
    expect(s.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
  }
});

test("a full circle is four pulses", () => {
  const s = stage(crank, small.layout, phone);
  s.at = 400;
  s.down(rim(phone, -90));
  wind(s, phone, -90, 275);
  expect(s.moves).toEqual(Array.from({ length: 4 }, () => ({ at: 400, a: 1 })));
});

test("winding the wrong way, or wiggling, sends nothing", () => {
  const s = stage(crank, small.layout, phone);
  s.down(rim(phone, 0));
  wind(s, phone, 0, -400);
  s.up(rim(phone, -400));
  s.down(rim(phone, 0));
  for (let i = 0; i < 6; i++) {
    wind(s, phone, 0, 60);
    wind(s, phone, 60, 0);
  }
  expect(s.moves).toEqual([]);
  // One quarter forward is one pulse; rocking back over it earns no second.
  for (let i = 0; i < 4; i++) {
    wind(s, phone, 0, 100);
    wind(s, phone, 100, 0);
  }
  expect(s.moves).toHaveLength(1);
});

test("a finger on the hub has no angle, so crossing it winds nothing", () => {
  const s = stage(crank, small.layout, phone);
  const { hub } = geometry(phone);
  s.down(rim(phone, 180));
  s.move({ x: hub.x - DEAD + 2, y: hub.y });
  s.move({ x: hub.x + DEAD - 2, y: hub.y });
  s.move(rim(phone, 0));
  s.move(rim(phone, 180));
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer lets go of the crank", () => {
  const s = stage(crank, small.layout, phone);
  s.down(rim(phone, 0));
  s.cancel();
  wind(s, phone, 0, 360);
  expect(s.moves).toEqual([]);
});

test("the dynamo blows when it is wound past its mark, and the drag ends", () => {
  const s = stage(crank, small.layout, phone);
  const model = s.model as CrankModel;
  const kicks = Math.floor(model.blow / small.layout.par![3]!) + 1;
  s.down(rim(phone, 0));
  wind(s, phone, 0, QUARTER * (kicks + 6) + 5);
  expect(s.moves).toHaveLength(kicks);
  expect(model.speed).toBeGreaterThan(model.blow);
});

test("the gauge says in words where the speed is, and when a spike loads it", () => {
  const s = stage(crank, small.layout, phone);
  const model = s.model as CrankModel;
  const status = () => s.surface.querySelector(".status")!.textContent;
  expect(status()).toBe("Wind it clockwise.");
  let angle = 0;
  const quarter = () => {
    wind(s, phone, angle, angle + QUARTER);
    angle += QUARTER;
  };
  s.down(rim(phone, 0));
  for (let i = 0; i < 100 && model.speed + small.layout.par![3]! < model.lo; i++) quarter();
  expect(model.speed).toBeLessThan(model.lo);
  s.frame();
  expect(status()).toBe("Too slow.");
  quarter();
  s.frame();
  expect(status()).toBe("Charging.");
  for (let i = 0; i < 100 && model.speed <= model.hi; i++) quarter();
  s.frame();
  expect(status()).toBe("Too fast.");
  s.at = small.layout.track![0]! * small.layout.step!;
  s.frame();
  expect(status()).toMatch(/^Load spike! /);
  expect(s.surface.querySelector(".left")!.textContent).toMatch(/^\d+ s of charge to go$/);
});

test("a hint warns of a spike's start in seconds", () => {
  const s = stage(crank, small.layout, phone);
  const warn = () => s.surface.querySelector(".warn")!.textContent;
  expect(warn()).toBe("");
  s.hint({ at: 2700, a: 2 });
  s.frame();
  expect(warn()).toBe("Load spike in 3 s");
  s.at = 2700;
  s.frame();
  expect(warn()).toBe("");
  expect(s.moves).toEqual([]);
});

test("angles run clockwise on the screen and the sweep takes the short way", () => {
  const hub = { x: 0, y: 0 };
  expect(angleOf(hub, { x: 0, y: 10 })).toBeCloseTo(0.25);
  expect(sweep(350 / 360, 10 / 360)).toBeCloseTo(20 / 360);
  expect(sweep(10 / 360, 350 / 360)).toBeCloseTo(-20 / 360);
  expect(sweep(-170 / 360, 170 / 360)).toBeCloseTo(-20 / 360);
});

test("the handle is a thumb wide and the wheel fits, on a phone and at full size", () => {
  for (const size of [phone, desk, { width: 320, height: 300 }]) {
    const geo = geometry(size);
    expect(geo.knob).toBeGreaterThanOrEqual(HIT);
    expect(geo.r).toBeGreaterThanOrEqual(HIT * 2);
    expect(geo.hub.y + geo.r).toBeLessThanOrEqual(size.height);
    expect(geo.hub.y - geo.r).toBeGreaterThan(geo.top + geo.bar);
    expect(geo.hub.x - geo.r).toBeGreaterThanOrEqual(0);
  }
});

test("the scene cleans up after itself", () => {
  const s = stage(crank, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.hint({ at: 0, a: 1 });
  s.frame();
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

const pumps = goldenCases("crank", SHAPES_DIR);

// Pushes the handle down a whole stroke and lets it up again, without lifting the finger.
function stroke(s: Stage, geo: ReturnType<typeof geometry>, at: Point): void {
  const len = geo.stroke!;
  for (const t of [0.5, 1.05]) s.move({ x: at.x, y: at.y + len * t });
  for (const t of [0.5, 0]) s.move({ x: at.x, y: at.y + len * t });
}

test("on the pump, the solve played by pointer: a push down for every pulse", () => {
  for (const [i, c] of pumps.entries()) {
    expect(c.layout.shape).toBe(1);
    const size = i % 2 ? phone : desk;
    const geo = geometry(size, c.layout.shape);
    const s = stage(crank, c.layout, size);
    const solve = c.logs.find((l) => l.name === "solve")!;
    const handle = { x: geo.hub.x + geo.r, y: geo.hub.y - geo.stroke! / 2 };
    s.down(handle);
    for (const m of solve.log.moves) {
      s.at = m.at;
      stroke(s, geo, handle);
    }
    s.up(handle);
    expect(s.moves, c.name).toEqual(solve.log.moves);
    expect(s.model.run(solve.log.end!), c.name).toEqual([DONE, solve.outcome.at]);
  }
});

test("a pump stroke counts once: a wiggle at the bottom, or lifting short, sends no more", () => {
  const c = pumps[0]!;
  const geo = geometry(phone, 1);
  const s = stage(crank, c.layout, phone);
  const top = { x: geo.hub.x + geo.r, y: geo.hub.y - geo.stroke! / 2 };
  s.down(top);
  s.move({ x: top.x, y: top.y + geo.stroke! * 0.9 });
  expect(s.moves).toEqual([]);
  s.move({ x: top.x, y: top.y + geo.stroke! * 1.02 });
  expect(s.moves).toHaveLength(1);
  // Up a little and down again: not lifted far enough to pump again.
  s.move({ x: top.x, y: top.y + geo.stroke! * 0.6 });
  s.move({ x: top.x, y: top.y + geo.stroke! * 1.2 });
  expect(s.moves).toHaveLength(1);
  s.move({ x: top.x, y: top.y + geo.stroke! * 0.3 });
  s.move({ x: top.x, y: top.y + geo.stroke! * 1.3 });
  expect(s.moves).toHaveLength(2);
  s.up(top);
  // Pushing up sends nothing.
  s.down(top);
  s.move({ x: top.x, y: top.y - geo.stroke! * 2 });
  s.up(top);
  expect(s.moves).toHaveLength(2);
});

test("the pump's handle and its stroke fit the surface", () => {
  for (const size of [phone, desk]) {
    const geo = geometry(size, 1);
    expect(geo.stroke!).toBeGreaterThanOrEqual(HIT * 2);
    expect(geo.knob).toBeGreaterThanOrEqual(HIT);
    expect(geo.hub.x + geo.r + geo.knob).toBeLessThanOrEqual(size.width);
    expect(geo.hub.y + geo.stroke! / 2 + geo.knob).toBeLessThanOrEqual(size.height);
    const p = new Pump(geo.stroke!, 0);
    expect(p.depth(geo.stroke! / 2)).toBeCloseTo(0.5);
  }
});

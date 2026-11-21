// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import { play } from "../../shell/play.ts";
import signal from "./index.ts";
import type { SignalModel } from "./model.ts";
import { closeness, geometry, pick, slide, wave } from "./scene.ts";

const cases = goldenCases("signal");
const small = cases.find((c) => c.name === "level-1-full")!;
const capped = cases.find((c) => c.name === "level-9-compact")!;
const phone = { width: 360, height: 420 };
const wide = { width: 900, height: 560 };
const RANGE = small.layout.range!;

test("sliding each knob until the traces meet locks the signal", () => {
  for (const c of [small, capped]) {
    const n = c.layout.size;
    const s = stage(signal, c.layout, phone);
    const geo = geometry(n, RANGE, phone);
    const model = s.model as SignalModel;
    for (const [k, target] of c.layout.target!.entries()) {
      const from = { x: 120, y: geo.rows[k]! };
      s.drag(from, { x: from.x + (target - model.knobs[k]!) * geo.detent, y: from.y });
    }
    expect(model.knobs).toEqual(c.layout.target);
    expect(play(signal, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
    // The last detent of the last knob is the solving move of the kit's own log.
    expect(s.moves.at(-1)).toMatchObject({ a: n - 1, b: c.layout.target![n - 1] });
  }
});

test("every detent a knob crosses is a move that sets it there", () => {
  const s = stage(signal, small.layout, phone);
  const geo = geometry(1, RANGE, phone);
  const y = geo.rows[0]!;
  s.at = 250;
  s.down({ x: 100, y });
  s.move({ x: 100 + geo.detent, y });
  s.move({ x: 100 + geo.detent * 2, y });
  s.move({ x: 100 + geo.detent * 2.2, y });
  s.move({ x: 100 + geo.detent, y });
  s.up({ x: 100 + geo.detent, y });
  expect(s.moves).toEqual([
    { at: 250, a: 0, b: 1 },
    { at: 250, a: 0, b: 2 },
    { at: 250, a: 0, b: 1 },
  ]);
});

test("a knob stops at the ends of its scale", () => {
  const s = stage(signal, small.layout, phone);
  const geo = geometry(1, RANGE, phone);
  const y = geo.rows[0]!;
  s.drag({ x: 200, y }, { x: 200 - geo.detent * 5, y });
  expect(s.moves).toEqual([]);
  expect(slide(geo, RANGE, 20, geo.detent * 9)).toBe(RANGE - 1);
  expect(slide(geo, RANGE, 3, -geo.detent * 9)).toBe(0);
  expect(slide(geo, RANGE, 3, geo.detent * 0.4)).toBe(3);
});

test("a held knob, and a touch on the scope, send nothing", () => {
  const s = stage(signal, small.layout, phone);
  const geo = geometry(1, RANGE, phone);
  s.tap({ x: 200, y: geo.rows[0]! });
  s.drag({ x: 100, y: geo.scope.y + 40 }, { x: 300, y: geo.scope.y + 40 });
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer lets the knob go", () => {
  const s = stage(signal, small.layout, phone);
  const geo = geometry(1, RANGE, phone);
  const y = geo.rows[0]!;
  s.down({ x: 100, y });
  s.cancel();
  s.move({ x: 100 + geo.detent * 4, y });
  s.up({ x: 100 + geo.detent * 4, y });
  expect(s.moves).toEqual([]);
});

test("knobs that already match say how to lock on", () => {
  const flat = { ...small.layout, target: [0] };
  const s = stage(signal, flat, phone);
  const geo = geometry(1, RANGE, phone);
  const note = () => s.surface.querySelector(".note")!.textContent;
  expect(note()).not.toBe("");
  const y = geo.rows[0]!;
  s.down({ x: 100, y });
  s.move({ x: 100 + geo.detent, y });
  s.frame();
  expect(note()).toBe("");
  s.move({ x: 100, y });
  s.up({ x: 100, y });
  expect(s.moves).toEqual([
    { at: 0, a: 0, b: 1 },
    { at: 0, a: 0 },
  ]);
  expect(play(signal, flat, undefined, { moves: s.moves }, small.horizon).status).toBe(DONE);
});

test("no two settings of a knob draw the same trace", () => {
  const xs = Array.from({ length: 48 }, (_, i) => i / 47);
  for (let knob = 0; knob < 4; knob++) {
    const seen = new Set<string>();
    for (let v = 0; v < RANGE; v++) {
      const values = [5, 7, 11, 13].slice(0, knob + 1);
      values[knob] = v;
      seen.add(xs.map((x) => wave(values, RANGE, x).toFixed(3)).join());
    }
    expect(seen.size).toBe(RANGE);
  }
  for (const x of xs) expect(Math.abs(wave([23, 23, 23, 23], RANGE, x))).toBeLessThanOrEqual(1);
});

test("the meter is full only when every knob is on its value", () => {
  for (const c of cases) {
    expect(closeness(c.layout, c.layout.target!)).toBe(5);
    const off = c.layout.target!.map((t, i) => (i ? t : (t + 1) % RANGE));
    expect(closeness(c.layout, off)).toBeLessThan(5);
  }
});

test("a thumb can hold every knob, on a phone and at full size", () => {
  for (const c of cases) {
    const size = c.name.endsWith("compact") ? phone : wide;
    const n = c.layout.size;
    const geo = geometry(n, RANGE, size);
    expect(geo.half).toBeGreaterThanOrEqual(HIT);
    expect(geo.r).toBeGreaterThanOrEqual(HIT);
    expect(geo.detent).toBeGreaterThanOrEqual(11);
    expect(geo.scope.height).toBeGreaterThanOrEqual(120);
    for (const [k, y] of geo.rows.entries()) {
      expect(pick(geo, { x: 10, y: y - geo.half + 1 })).toBe(k);
      expect(pick(geo, { x: size.width - 10, y: y + geo.half - 1 })).toBe(k);
      expect(y + geo.half).toBeLessThanOrEqual(size.height);
    }
    expect(pick(geo, { x: 100, y: geo.scope.y + 5 })).toBeUndefined();
  }
  // A phone turned on its side, or a full machine on a small screen, still fits.
  expect(geometry(4, RANGE, { width: 640, height: 300 }).scope.height).toBeGreaterThanOrEqual(40);
});

test("the phone's cap of three knobs is kept", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(3);
});

test("the scene cleans up after itself", () => {
  const s = stage(signal, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.hint({ at: 0, a: 0, b: 11 });
  s.frame();
  expect(s.surface.querySelector(".hint")!.getAttribute("d")).not.toBe("");
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

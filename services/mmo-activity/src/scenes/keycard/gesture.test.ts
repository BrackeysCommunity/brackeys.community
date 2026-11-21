// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { HIT } from "../../shell/board.ts";
import keycard from "./index.ts";
import type { KeycardModel } from "./model.ts";
import { crossings, geometry, grabs } from "./scene.ts";

const cases = goldenCases("keycard");
const small = cases.find((c) => c.name === "level-1-full")!;
const phone = { width: 360, height: 420 };
const desk = { width: 900, height: 560 };

// One swipe of the card in hand that takes ms and ends at the stage's
// clock plus ms: out past a gate, in through it, and out by the other.
function swipe(s: Stage, size: { width: number; height: number }, ms: number, right: boolean) {
  const geo = geometry(size);
  const [from, to] = right ? geo.gates : [geo.gates[1], geo.gates[0]];
  s.move({ x: from + (right ? -20 : 20), y: geo.rail });
  s.move({ x: from, y: geo.rail });
  s.at += ms;
  s.move({ x: to, y: geo.rail });
}

function pickUp(s: Stage, size: { width: number; height: number }): void {
  const geo = geometry(size);
  s.down({ x: geo.min, y: geo.rail });
}

test("the solve played by pointer: a swipe of its own length for every pass", () => {
  for (const [i, c] of cases.entries()) {
    const size = i % 2 ? phone : desk;
    const s = stage(keycard, c.layout, size);
    const solve = c.logs.find((l) => l.name === "solve")!;
    pickUp(s, size);
    for (const [j, m] of solve.log.moves.entries()) {
      s.at = m.at - m.a;
      swipe(s, size, m.a, j % 2 === 0);
    }
    expect(s.moves, c.name).toEqual(solve.log.moves);
    expect((s.model as KeycardModel).k, c.name).toBe(c.layout.size);
  }
});

test("the reader says too fast or too slow, and counts the bad swipe", () => {
  const s = stage(keycard, small.layout, phone);
  const model = s.model as KeycardModel;
  const target = small.layout.target![0]!;
  const status = () => s.surface.querySelector(".status")!.textContent;
  expect(status()).toBe("Drag the card through both gates.");
  pickUp(s, phone);
  s.at = 2000;
  swipe(s, phone, target - model.width - 1, true);
  s.frame();
  expect(status()).toBe("Too fast. Swipe slower.");
  expect(model.bad).toBe(1);
  s.at += 500;
  swipe(s, phone, target + model.width + 1, false);
  s.frame();
  expect(status()).toBe("Too slow. Swipe faster.");
  expect(s.surface.querySelectorAll(".strike.on")).toHaveLength(2);
  s.at += 500;
  swipe(s, phone, target + model.width, true);
  s.frame();
  expect(status()).toBe("Pass read. Now the next.");
  expect(s.surface.querySelectorAll(".lamp.read")).toHaveLength(1);
  expect(s.moves.map((m) => m.a)).toEqual([
    target - model.width - 1,
    target + model.width + 1,
    target + model.width,
  ]);
});

test("the last forgiven bad swipe is said to be the last", () => {
  const s = stage(keycard, small.layout, phone);
  const model = s.model as KeycardModel;
  pickUp(s, phone);
  s.at = 1000;
  for (let i = 0; i < model.strikes; i++) {
    s.at += 400;
    swipe(s, phone, 300, i % 2 === 0);
  }
  s.frame();
  expect(s.surface.querySelector(".status")!.textContent).toBe(
    "Too fast. Swipe slower. One more bad swipe breaks it.",
  );
});

test("a swipe is timed between the gates, wherever the pointer events fall", () => {
  const s = stage(keycard, small.layout, phone);
  const geo = geometry(phone);
  const [g1, g2] = geo.gates;
  pickUp(s, phone);
  // Two events 100 ms apart straddle each gate evenly.
  s.at = 1000;
  s.move({ x: g1 - 10, y: geo.rail });
  s.at = 1100;
  s.move({ x: g1 + 10, y: geo.rail });
  s.at = 1700;
  s.move({ x: g2 - 10, y: geo.rail });
  s.at = 1800;
  s.move({ x: g2 + 10, y: geo.rail });
  expect(s.moves).toEqual([{ at: 1800, a: 700 }]);
});

test("a card that turns back, or is let go between the gates, was not swiped", () => {
  const s = stage(keycard, small.layout, phone);
  const geo = geometry(phone);
  const [g1, g2] = geo.gates;
  const mid = (g1 + g2) / 2;
  pickUp(s, phone);
  s.at = 1000;
  s.move({ x: mid, y: geo.rail });
  s.at = 1400;
  s.move({ x: g1 - 20, y: geo.rail });
  s.at = 1800;
  s.move({ x: mid, y: geo.rail });
  s.up({ x: mid, y: geo.rail });
  // Picked up again between the gates, leaving by either is no swipe.
  s.down({ x: mid, y: geo.rail });
  s.at = 2600;
  s.move({ x: g2 + 20, y: geo.rail });
  s.up({ x: g2 + 20, y: geo.rail });
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer drops the card and its swipe", () => {
  const s = stage(keycard, small.layout, phone);
  const geo = geometry(phone);
  pickUp(s, phone);
  s.at = 1000;
  s.move({ x: geo.gates[0] + 5, y: geo.rail });
  s.cancel();
  s.at = 1700;
  s.move({ x: geo.gates[1] + 5, y: geo.rail });
  expect(s.moves).toEqual([]);
});

test("a swipe made before the machine's clock runs is not sent", () => {
  const s = stage(keycard, small.layout, phone);
  pickUp(s, phone);
  swipe(s, phone, 0, true);
  expect(s.moves).toEqual([]);
});

test("the machine is armed as the card first passes a gate, not when it is picked up", () => {
  const s = stage(keycard, small.layout, phone);
  const geo = geometry(phone);
  pickUp(s, phone);
  s.move({ x: geo.gates[0] - 10, y: geo.rail });
  expect(s.arms).toBe(0);
  s.move({ x: geo.gates[0], y: geo.rail });
  expect(s.arms).toBe(1);
  // The clock started at the gate, so the swipe that follows fits it.
  s.at = 766;
  s.move({ x: geo.gates[1], y: geo.rail });
  expect(s.moves).toEqual([{ at: 766, a: 766 }]);
});

test("the card is a thumb wide and the gates are a swipe apart, on a phone and at full size", () => {
  for (const size of [phone, desk, { width: 320, height: 300 }]) {
    const geo = geometry(size);
    expect(geo.card.width / 2).toBeGreaterThanOrEqual(HIT);
    expect(geo.card.height / 2).toBeGreaterThanOrEqual(HIT);
    expect(geo.gates[1] - geo.gates[0]).toBeGreaterThanOrEqual(150);
    // The card rests clear of the gates at either end.
    expect(geo.min).toBeLessThan(geo.gates[0]);
    expect(geo.max).toBeGreaterThan(geo.gates[1]);
    expect(geo.rail + geo.card.height / 2).toBeLessThan(size.height);
    expect(geo.rail - geo.card.height / 2).toBeGreaterThan(geo.top + geo.bar);
    expect(grabs(geo, geo.min, { x: geo.min + geo.card.width / 2, y: geo.rail }).held).toBe(true);
    expect(grabs(geo, geo.min, { x: geo.max, y: geo.rail }).held).toBe(false);
  }
});

test("crossings are the gates met in order, in between first", () => {
  expect(crossings([10, 20], 0, 30)).toEqual([
    { enters: true, share: 1 / 3 },
    { enters: false, share: 2 / 3 },
  ]);
  expect(crossings([10, 20], 30, 15)).toEqual([{ enters: true, share: 2 / 3 }]);
  expect(crossings([10, 20], 15, 0)).toEqual([{ enters: false, share: 1 / 3 }]);
  expect(crossings([10, 20], 12, 18)).toEqual([]);
  expect(crossings([10, 20], 10, 10)).toEqual([]);
});

test("a hint and the guide bracket a swipe on the gauge", () => {
  const s = stage(keycard, small.layout, { ...phone, guide: { at: 1500, a: 766 } });
  expect(s.surface.querySelector(".guide")!.getAttribute("d")).not.toBe("");
  s.hint({ at: 1500, a: 766 });
  s.frame();
  expect(s.surface.querySelector(".hint")!.getAttribute("d")).not.toBe("");
  expect(s.moves).toEqual([]);
});

test("the scene cleans up after itself", () => {
  const s = stage(keycard, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});

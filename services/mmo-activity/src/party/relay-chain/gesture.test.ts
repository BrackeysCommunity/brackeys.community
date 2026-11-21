// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { geometry, knobAt } from "../../scenes/signal/scene.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import relayChain from "./index.ts";
import { UNLOCKED, type RelayChainModel } from "./model.ts";

const phone = { width: 360, height: 420 };
const pair = partyCases("relay-chain").find((c) => c.name === "level-3-seats-2-shape-0")!;
const range = pair.layout.range!;

function seats() {
  const first = stage(relayChain, pair.layout, { ...phone, seat: 0 });
  const second = stage(relayChain, pair.layout, { ...phone, seat: 1, model: first.model });
  const model = first.model as RelayChainModel;
  const geo = geometry(model.per, range, playArea(phone));
  // Slides a knob of a seat's own panel from where it stands to a value, a detent a step.
  const tune = (s: Stage, knob: number, from: number, to: number) => {
    const p = knobAt(geo, range, knob, from);
    s.drag(p, { x: p.x + (to - from) * geo.detent, y: p.y });
  };
  return { stages: [first, second], model, tune };
}

test("each seat tunes its own panel, and the chain holds when both lock together", () => {
  const { stages, model, tune } = seats();
  const solve = pair.logs.find((l) => l.name === "solve")!;
  for (const m of solve.log.moves) {
    const s = m.seat ?? 0;
    stages[s]!.at = m.at;
    tune(stages[s]!, m.a - s * model.per, model.knobs[m.a]!, m.b ?? 0);
    for (const st of stages) st.frame();
  }
  expect(solve.outcome.status).toBe(DONE);
  expect(model.knobs).toEqual(pair.layout.target);
  expect(model.lock.every((at) => at !== UNLOCKED)).toBe(true);
  for (const [i, st] of stages.entries())
    expect(st.moves.every((m) => m.seat === i && model.panelOf(m.a) === i)).toBe(true);
});

test("a seat's knobs are its own panel's, numbered as the machine numbers them", () => {
  const { stages, model, tune } = seats();
  stages[1]!.at = 300;
  tune(stages[1]!, 0, 0, 1);
  expect(stages[1]!.moves.at(-1)).toEqual({ at: 300, a: model.per, b: 1, seat: 1 });
  expect(stages[0]!.moves).toEqual([]);
});

test("a panel's lock lights on every seat's bar", () => {
  const { stages, model, tune } = seats();
  for (let k = 0; k < model.per; k++) tune(stages[1]!, k, 0, pair.layout.target![model.per + k]!);
  for (const s of stages) s.frame();
  const lit = (s: Stage) =>
    [...s.surface.querySelectorAll(".pb-seat")].map((g) => g.classList.contains("on"));
  expect(model.tuned(1)).toBe(true);
  expect(lit(stages[0]!)).toEqual([false, true]);
  expect(lit(stages[1]!)).toEqual([false, true]);
  expect(stages[1]!.surface.querySelector(".pb-say")!.textContent).toMatch(/^Locked/);
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

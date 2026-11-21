// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases, type PartyCase } from "../../../test/party-golden.ts";
import { partyStage, type Stage } from "../../../test/stage.ts";
import type { PuzzleMove } from "../../api.ts";
import { geometry } from "../../scenes/override/scene.ts";
import type { Point } from "../../shell/board.ts";
import { BROKE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import callAndAnswer from "./index.ts";
import { CALL, CallModel } from "./model.ts";

const cases = partyCases("call-and-answer");
const phone = { width: 360, height: 420 };
const middle = (box: { x: number; y: number; width: number; height: number }): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

// One screen a seat, each on its own dealt part, with every move relayed
// to the others as the gateway does.
interface Table {
  stages: Stage[];
  whole: CallModel;
  tap(seat: number, symbol: number, at: number): void;
}

function table(c: PartyCase): Table {
  const seats = c.spec.seats;
  const stages = c.parts.map((part, seat) =>
    partyStage(callAndAnswer, part, { ...phone, seat, seats }),
  );
  const whole = new CallModel(c.layout);
  const pads = geometry(c.layout.range!, playArea(phone)).pads;
  return {
    stages,
    whole,
    tap(seat, symbol, at) {
      const s = stages[seat]!;
      const sent = s.moves.length;
      for (const t of stages) t.at = at;
      s.tap(middle(pads[symbol]!));
      for (const m of s.moves.slice(sent)) {
        for (const other of stages) if (other !== s) other.model.apply(m);
        whole.apply(m);
      }
      for (const t of stages) t.frame();
    },
  };
}

test("the merged solve played by pointer: each symbol called by its seat, pressed by the keypad", () => {
  for (const c of cases) {
    const t = table(c);
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    // The keypad seat presses its own symbols without calling them.
    const want: PuzzleMove[] = [];
    for (let i = 0; i < solve.length; i += 2) {
      const call = solve[i]!;
      const press = solve[i + 1]!;
      const keypad = press.seat ?? 0;
      if ((call.seat ?? 0) !== keypad) {
        t.tap(call.seat ?? 0, call.a, call.at);
        want.push({ ...call, seat: call.seat ?? 0 });
      }
      t.tap(keypad, press.a, press.at);
      want.push({ at: press.at, a: press.a, seat: keypad });
    }
    const made = t.stages
      .flatMap((s) => s.moves)
      .sort((x, y) => x.at - y.at || (y.c ?? 0) - (x.c ?? 0));
    expect(made, c.name).toEqual(want);
    expect(t.whole.k, c.name).toBe((c.layout.size * (c.layout.size + 1)) / 2);
    // No dealt part can tell on its own that the machine is solved.
    for (const s of t.stages) expect((s.model as CallModel).blind, c.name).toBe(true);
  }
});

test("a pad off the keypad is a call: shown on every screen, and nothing is pressed", () => {
  const c = cases.find((x) => x.name === "level-3-seats-3-shape-0")!;
  const t = table(c);
  const model = t.stages[0]!.model as CallModel;
  t.tap(1, 2, 100);
  expect(t.stages[1]!.moves).toEqual([{ at: 100, a: 2, c: CALL, seat: 1 }]);
  expect(model.k).toBe(0);
  for (const s of t.stages) {
    expect(s.surface.querySelectorAll(".cs-call").length).toBe(1);
    expect(s.surface.querySelector(".cs-who")!.textContent).toBe(
      s === t.stages[1] ? "You" : "Seat 2",
    );
  }
});

test("the next symbol shows only on the screen of the seat dealt it", () => {
  const c = cases.find((x) => x.name === "level-9-seats-4-shape-1")!;
  const t = table(c);
  const said = (s: Stage) => s.surface.querySelector(".cs-said")!.textContent;
  const order = c.layout.order!;
  // Round 1 wants the first symbol, dealt to seat 1; seat 1 also holds the keypad.
  expect(t.stages[0]!.surface.querySelector(".cs-next.on")).not.toBeNull();
  expect(said(t.stages[0]!)).toMatch(/^Press .+: it is yours\.$/);
  for (const s of t.stages.slice(1)) {
    expect(s.surface.querySelector(".cs-next.on")).toBeNull();
    expect(said(s)).toBe("Seat 1 calls next.");
  }
  t.tap(0, order[0]!, 300);
  // Round 2 opens on the keypad of seat 2, with the first symbol again.
  expect(t.stages[1]!.surface.querySelector(".pb-say")!.textContent).toBe(
    "You hold the keypad: press what is called.",
  );
  expect(said(t.stages[1]!)).toBe("Seat 1 calls next. Press what is called.");
  expect(said(t.stages[0]!)).toMatch(/^Call .+: tap its pad\.$/);
});

test("a glimpse of the next seat's part shows its symbol before it is called", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const order = c.layout.order!;
  // Seat 2 is dealt the second symbol; seat 1, glimpsing seat 2's part, sees it coming.
  const s = partyStage(callAndAnswer, c.parts[0]!, {
    ...phone,
    seat: 0,
    seats: 2,
    glimpse: c.parts[1]!,
  });
  const model = s.model as CallModel;
  const pads = geometry(c.layout.range!, playArea(phone)).pads;
  s.at = 100;
  s.tap(middle(pads[order[0]!]!));
  // Round 2's keypad is seat 2's; its press arrives relayed.
  model.apply({ at: 200, a: order[0]!, seat: 1 });
  expect(model.progress()).toEqual({ round: 1, entered: 1 });
  s.frame();
  expect(s.surface.querySelector(".cs-next.glimpse")).not.toBeNull();
  expect(s.surface.querySelector(".cs-said")!.textContent).toMatch(/^Seat 2 calls .+ next\.$/);
});

test("a press by the keypad is sent as a press, and a wrong one breaks the machine", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const stages = c.parts.map((part, seat) =>
    partyStage(callAndAnswer, part, { ...phone, seat, seats: 2 }),
  );
  const pads = geometry(c.layout.range!, playArea(phone)).pads;
  const wrong = (c.layout.order![0]! + 1) % c.layout.range!;
  stages[0]!.at = 200;
  stages[0]!.tap(middle(pads[wrong]!));
  expect(stages[0]!.moves).toEqual([{ at: 200, a: wrong, seat: 0 }]);
  // Seat 1 holds the keypad and was dealt the first symbol: its own part
  // already knows the press is wrong, as the whole machine does.
  expect(new CallModel(c.parts[0]!).apply(stages[0]!.moves[0]!)).toBe(BROKE);
  expect(new CallModel(c.layout).apply(stages[0]!.moves[0]!)).toBe(BROKE);
});

test("the scene cleans up after itself", () => {
  const [s] = table(cases[0]!).stages;
  s!.scene.destroy();
  expect(s!.surface.children.length).toBe(0);
});

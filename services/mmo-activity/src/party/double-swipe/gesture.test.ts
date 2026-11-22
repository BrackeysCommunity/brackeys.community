// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { partyStage, type Stage } from "../../../test/stage.ts";
import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import doubleSwipe from "./index.ts";
import { SwipeModel } from "./model.ts";
import { geometry } from "./scene.ts";

const cases = partyCases("double-swipe");
const phone = { width: 360, height: 420 };
const geo = geometry(playArea(phone));
const seated = (m: PuzzleMove) => ({ ...m, seat: m.seat ?? 0 });

// One screen a seat on one machine, with where each screen's cards lie.
interface Table {
  stages: Stage[];
  cards: number[][];
  swipe(seat: number, reader: number, ms: number, end: number): void;
}

function table(layout: PuzzleLayout): Table {
  const seats = layout.seats!;
  const first = partyStage(doubleSwipe, layout, { ...phone, seat: 0, seats });
  const stages = [
    first,
    ...Array.from({ length: seats - 1 }, (_, i) =>
      partyStage(doubleSwipe, layout, { ...phone, seat: i + 1, seats, model: first.model }),
    ),
  ];
  const cards = stages.map(() => geo.readers.map((r) => r.min));
  return {
    stages,
    cards,
    // Picks the card up where it lies, swipes it through both gates in ms
    // ending at end, and lets go.
    swipe(seat, reader, ms, end) {
      const s = stages[seat]!;
      const r = geo.readers[reader]!;
      const at = cards[seat]![reader]!;
      const right = at < (r.gates[0] + r.gates[1]) / 2;
      const [from, to] = right ? r.gates : [r.gates[1], r.gates[0]];
      s.at = end - ms;
      s.down({ x: at, y: r.rail });
      s.move({ x: from + (right ? -20 : 20), y: r.rail });
      s.move({ x: from, y: r.rail });
      s.at = end;
      s.move({ x: to, y: r.rail });
      s.up({ x: to, y: r.rail });
      cards[seat]![reader] = to;
      for (const t of stages) t.frame();
    },
  };
}

test(
  "the merged solve played by pointer: both readers swiped together, each by its seat",
  { timeout: 60_000 },
  () => {
    for (const c of cases) {
      const t = table(c.layout);
      const solve = c.logs.find((l) => l.name === "solve")!;
      for (const m of solve.log.moves) t.swipe(m.seat ?? 0, m.b ?? 0, m.a, m.at);
      const made = t.stages
        .flatMap((s) => s.moves)
        .sort((x, y) => x.at - y.at || (x.b ?? 0) - (y.b ?? 0));
      expect(made, c.name).toEqual(solve.log.moves.map(seated));
      expect((t.stages[0]!.model as SwipeModel).k, c.name).toBe(c.layout.size);
      const fresh = new SwipeModel(c.layout);
      expect(made.map((m) => fresh.apply(m)).at(-1), c.name).toBe(DONE);
    }
  },
);

test("the card of the reader another seat holds does not move, and the bar says whose it is", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const t = table(c.layout);
  const r = geo.readers[1]!;
  t.stages[0]!.at = 3000;
  t.stages[0]!.down({ x: r.min, y: r.rail });
  t.stages[0]!.move({ x: r.max, y: r.rail });
  t.stages[0]!.frame();
  expect(t.stages[0]!.moves).toEqual([]);
  expect(t.stages[0]!.surface.querySelector(".pb-say")!.textContent).toBe(
    "Seat 2 swipes reader B this pass.",
  );
});

test("a pass read by one reader waits on the other, and the readers change hands after it", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const t = table(c.layout);
  const model = t.stages[0]!.model as SwipeModel;
  const say = (s: Stage) => s.surface.querySelector(".status")!.textContent;
  const names = (s: Stage) =>
    [...s.surface.querySelectorAll(".label")].slice(-2).map((n) => n.textContent);
  expect(names(t.stages[0]!)).toEqual(["Reader A: you swipe", "Reader B: Seat 2 swipes"]);
  t.swipe(0, 0, c.layout.target![0]!, 3000);
  expect(say(t.stages[1]!)).toBe("Reader A has read: B now, quick.");
  t.swipe(1, 1, c.layout.key![0]!, 3200);
  expect(model.k).toBe(1);
  expect(names(t.stages[0]!)).toEqual(["Reader A: Seat 2 swipes", "Reader B: you swipe"]);
  expect(t.stages[1]!.surface.querySelector(".pb-say")!.textContent).toBe("You swipe reader A.");
});

test("two swipes further apart than the window read no pass", () => {
  const c = cases.find((x) => x.name === "level-9-seats-3-shape-0")!;
  const t = table(c.layout);
  const model = t.stages[0]!.model as SwipeModel;
  t.swipe(0, 0, c.layout.target![0]!, 3000);
  t.swipe(1, 1, c.layout.key![0]!, 3000 + c.layout.window! + 1);
  expect(model.k).toBe(0);
  expect(model.good).toEqual([-1, 3000 + c.layout.window! + 1]);
});

test("the scene cleans up after itself", () => {
  const { stages } = table(cases[0]!.layout);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

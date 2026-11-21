// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { stage } from "../../../test/stage.ts";
import { geometry } from "../../scenes/fuse/scene.ts";
import { BROKE, DONE, GOING } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import bombSquad from "./index.ts";
import type { BombSquadModel } from "./model.ts";
import { dealt } from "./scene.ts";

const phone = { width: 360, height: 420 };
const pair = partyCases("bomb-squad").find((c) => c.name === "level-3-seats-2-shape-0")!;
const solve = pair.logs.find((l) => l.name === "solve")!;

// Each seat's screen holds its own dealt part; the model both draw is one.
function seats(whole = false) {
  const [p0, p1] = whole ? [pair.layout, pair.layout] : [pair.parts[0]!, pair.parts[1]!];
  const first = stage(bombSquad, p0, { ...phone, seat: 0 });
  const second = stage(bombSquad, p1, { ...phone, seat: 1, model: first.model });
  const fuseAt = (part: typeof p0, f: number) =>
    geometry(part.size, dealt(part).clues!.length, playArea(phone)).fuses[f]!;
  return { stages: [first, second], parts: [p0, p1], fuseAt, model: first.model as BombSquadModel };
}

test("the cutters pass round and each seat pulls in its turn", () => {
  const { stages, parts, fuseAt, model } = seats(true);
  for (const m of solve.log.moves) {
    const s = m.seat ?? 0;
    stages[s]!.tap(fuseAt(parts[s]!, m.a));
    for (const st of stages) st.frame();
  }
  expect(solve.outcome.status).toBe(DONE);
  expect(stages[0]!.moves.length + stages[1]!.moves.length).toBe(solve.log.moves.length);
  expect(model.snapshot()).toEqual(solve.trace.at(-1)!.state);
});

test("a seat without the cutters pulls nothing", () => {
  const { stages, parts, fuseAt, model } = seats();
  const other = 1 - model.cutter();
  stages[other]!.tap(fuseAt(parts[other]!, solve.log.moves[0]!.a));
  expect(stages[other]!.moves).toEqual([]);
});

test("on dealt parts the box only counts the pulls: right or wrong is the server's", () => {
  const { stages, parts, fuseAt, model } = seats();
  const cutter = model.cutter();
  const wrong = pair.layout.order!.at(-1)!;
  stages[cutter]!.tap(fuseAt(parts[cutter]!, wrong));
  expect(stages[cutter]!.moves).toHaveLength(1);
  expect(model.apply({ at: 0, a: wrong, seat: cutter })).toBe(GOING);
  expect(model.k).toBe(1);
  expect(bombSquad.start(pair.layout).apply({ at: 0, a: wrong, seat: cutter })).toBe(BROKE);
});

test("each seat is shown only the clue cards it was dealt", () => {
  const { stages, parts } = seats();
  const cards = (i: number) => stages[i]!.surface.querySelectorAll(".fuse .card").length;
  expect(cards(0)).toBe(dealt(parts[0]!).clues!.length);
  expect(cards(1)).toBe(dealt(parts[1]!).clues!.length);
  expect(cards(0) + cards(1)).toBe(pair.layout.clues!.length);
});

test("a glimpse of the next seat's part adds its cards", () => {
  const s = stage(bombSquad, pair.parts[0]!, { ...phone, seat: 0, glimpse: pair.parts[1]! });
  expect(s.surface.querySelectorAll(".fuse .card")).toHaveLength(pair.layout.clues!.length);
  expect(dealt(pair.parts[0]!, pair.parts[1]!).clues).toEqual(pair.layout.clues);
});

test("the bar says who holds the cutters", () => {
  const { stages, model } = seats();
  const say = (i: number) => stages[i]!.surface.querySelector(".pb-say")!.textContent;
  expect(say(model.cutter())).toMatch(/^You hold the cutters/);
  expect(say(1 - model.cutter())).toMatch(/read your clues/);
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

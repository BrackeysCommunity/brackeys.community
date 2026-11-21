// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases, partyPlay } from "../../../test/party-golden.ts";
import { stage, type Stage } from "../../../test/stage.ts";
import { geometry } from "../../scenes/rewire/scene.ts";
import { DONE, GOING } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import splitPanel from "./index.ts";
import { MARK, PLUG, type SplitPanelModel } from "./model.ts";
import { legend } from "./scene.ts";

const phone = { width: 360, height: 420 };
const cases = partyCases("split-panel");
const pair = cases.find((c) => c.name === "level-3-seats-2-shape-0")!;
const four = cases.find((c) => c.name === "level-3-seats-4-shape-0")!;

// Every seat's screen holds its dealt part; the model they share is one.
function seats(c = pair) {
  const stages: Stage[] = [];
  for (const [s, part] of c.parts.entries())
    stages.push(stage(splitPanel, part, { ...phone, seat: s, model: stages[0]?.model }));
  const model = stages[0]!.model as SplitPanelModel;
  const geo = geometry(c.layout.size, playArea(phone));
  return { stages, model, geo };
}

test("the ports seat lights each port, the wires seat plugs into it, and only the server knows it is done", () => {
  const { stages, model, geo } = seats();
  const solve = pair.logs.find((l) => l.name === "solve")!;
  const want = [];
  for (const m of solve.log.moves) {
    const s = stages[m.seat ?? 0]!;
    s.at = m.at;
    if ((m.c ?? 0) === MARK) s.tap(geo.seats[m.b ?? 0]!);
    // A wire already in its port is not dragged; the solver plugs it anyway.
    else if (model.at[m.a] === (m.b ?? 0)) continue;
    else s.drag(geo.seats[model.at[m.a]!]!, geo.seats[m.b ?? 0]!);
    want.push({ ...m, seat: m.seat ?? 0 });
    for (const st of stages) st.frame();
  }
  const moves = [...stages[0]!.moves, ...stages[1]!.moves].sort((a, b) => a.at - b.at);
  expect(moves).toEqual(want);
  expect(model.at).toEqual(pair.layout.target);
  // On the dealt parts nobody holds the answer, so the shared model never says done.
  expect(model.apply({ at: 0, a: 0, b: model.at[0]!, seat: 0 })).toBe(GOING);
  expect(partyPlay(splitPanel, pair.layout, { moves }, pair.horizon).outcome.status).toBe(DONE);
});

test("a lit port shows on the wires seat's panel with the seat that lit it", () => {
  const { stages, geo } = seats();
  stages[1]!.tap(geo.seats[3]!);
  stages[0]!.frame();
  expect(stages[1]!.moves).toEqual([{ at: 0, a: 0, b: 3, c: MARK, seat: 1 }]);
  const port = stages[0]!.surface.querySelectorAll(".rewire .port")[3]!;
  expect(port.getAttribute("class")).toBe("port lit");
  expect(stages[0]!.surface.querySelectorAll(".light-tag")[3]!.textContent).toBe("2");
  expect(stages[0]!.surface.querySelector(".pb-say")!.textContent).toBe("Lit · Seat 2: D");
});

test("a wires seat plugs only its own wires, and a ports seat plugs none", () => {
  const { stages, model, geo } = seats(four);
  const theirs = Array.from({ length: four.layout.size }, (_, w) => w).find(
    (w) => !model.holds(0, w),
  )!;
  stages[0]!.drag(geo.seats[model.at[theirs]!]!, geo.seats[0]!);
  stages[1]!.drag(geo.seats[model.at[0]!]!, geo.seats[1]!);
  expect(stages[0]!.moves).toEqual([]);
  expect(stages[1]!.moves.every((m) => m.c === MARK)).toBe(true);
  const own = Array.from({ length: four.layout.size }, (_, w) => w).find((w) => model.holds(2, w))!;
  stages[2]!.drag(geo.seats[model.at[own]!]!, geo.seats[0]!);
  expect(stages[2]!.moves).toEqual([{ at: 0, a: own, ...(PLUG ? { c: PLUG } : {}), seat: 2 }]);
});

test("each seat is drawn only what it was dealt", () => {
  const { stages } = seats();
  // The wires seat sees its colours and no glyph; the ports seat sees glyphs and its reading.
  expect(stages[0]!.surface.querySelectorAll(".rewire .swatch").length).toBe(pair.layout.size);
  expect(stages[0]!.surface.querySelectorAll(".rewire .reading")).toHaveLength(0);
  expect(stages[1]!.surface.querySelectorAll(".rewire .reading")).toHaveLength(
    legend(pair.parts[1]!.code).length,
  );
  expect(stages[1]!.surface.querySelectorAll(".rewire .source + .swatch")).toHaveLength(0);
});

test("a glimpse of the next seat's part shows a wires seat the ports' glyphs and readings", () => {
  const s = stage(splitPanel, pair.parts[0]!, { ...phone, seat: 0, glimpse: pair.parts[1]! });
  expect(s.surface.querySelectorAll(".rewire .reading")).toHaveLength(
    legend(pair.parts[1]!.code).length,
  );
  expect(s.surface.querySelectorAll(".rewire .swatch").length).toBeGreaterThan(pair.layout.size);
});

test("the scene cleans up after itself", () => {
  const { stages } = seats();
  expect(stages[0]!.surface.children.length).toBe(2);
  stages[0]!.scene.destroy();
  expect(stages[0]!.surface.children.length).toBe(0);
});

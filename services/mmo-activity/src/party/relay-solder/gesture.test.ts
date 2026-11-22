// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { partyCases } from "../../../test/party-golden.ts";
import { partyStage, type Stage } from "../../../test/stage.ts";
import type { PuzzleLayout } from "../../api.ts";
import { DOWN, DRAG } from "../../scenes/splice/model.ts";
import { centre, geometry } from "../../scenes/splice/scene.ts";
import { DONE } from "../../shell/kit.ts";
import { playArea } from "../wrap.ts";
import relaySolder from "./index.ts";
import { SolderModel } from "./model.ts";

const cases = partyCases("relay-solder");
const phone = { width: 360, height: 420 };
const geo = (l: PuzzleLayout) => geometry(l.size, l.range!, playArea(phone));

function table(layout: PuzzleLayout): Stage[] {
  const seats = layout.seats!;
  const first = partyStage(relaySolder, layout, { ...phone, seat: 0, seats });
  const rest = Array.from({ length: seats - 1 }, (_, i) =>
    partyStage(relaySolder, layout, { ...phone, seat: i + 1, seats, model: first.model }),
  );
  return [first, ...rest];
}

test(
  "the merged solve played by pointer: each seat solders its segments and hands the iron on",
  { timeout: 60_000 },
  () => {
    for (const c of cases) {
      const stages = table(c.layout);
      const model = stages[0]!.model as SolderModel;
      const g = geo(c.layout);
      const held = new Set<number>();
      const solve = c.logs.find((l) => l.name === "solve")!;
      for (const m of solve.log.moves) {
        const seat = m.seat ?? 0;
        const s = stages[seat]!;
        for (const t of stages) t.at = m.at;
        model.run(m.at);
        const p = centre(g, m.a);
        if (m.c === DOWN) {
          if (held.has(seat)) s.up(p);
          s.down(p);
          held.add(seat);
        } else if (m.c === DRAG) s.move(p);
        else if (held.has(seat)) {
          s.up(p);
          held.delete(seat);
        }
        // At a joint the iron lifts by itself, and the hand that held it lets go.
        if (!model.on) {
          for (const h of held) stages[h]!.up(p);
          held.clear();
        }
      }
      expect(model.k, c.name).toBe(model.length);
      // Every move sent was the sending seat's to make, and they solve it again.
      const made = stages.flatMap((s) => s.moves).sort((x, y) => x.at - y.at);
      const fresh = new SolderModel(c.layout);
      let st = 0;
      for (const m of made) {
        fresh.run(m.at);
        expect(m.seat, c.name).toBe(fresh.seatFor(m.c ?? 0));
        st = fresh.apply(m);
      }
      expect(st, c.name).toBe(DONE);
    }
  },
);

test("a finger put down while another seat has the iron solders nothing", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const [, theirs] = table(c.layout);
  const model = theirs!.model as SolderModel;
  theirs!.at = 300;
  theirs!.down(centre(geo(c.layout), model.cell(0)));
  theirs!.move(centre(geo(c.layout), model.cell(1)));
  theirs!.up(centre(geo(c.layout), model.cell(1)));
  theirs!.frame();
  expect(theirs!.moves).toEqual([]);
  expect(model.k).toBe(0);
  expect(theirs!.surface.querySelector(".pb-say")!.textContent).toBe("Wait: Seat 1 has the iron.");
});

test("the iron passes at the joint, and the bar says whose it is on every screen", () => {
  const c = cases.find((x) => x.name === "level-3-seats-2-shape-0")!;
  const [a, b] = table(c.layout);
  const model = a!.model as SolderModel;
  const say = (s: Stage) => s.surface.querySelector(".pb-say")!.textContent;
  expect(say(a!)).toBe("Set the iron down at the left end.");
  expect(say(b!)).toBe("Seat 1 has the iron.");
  // Seat 1 solders its segment: down at the left end, then along the trace.
  a!.at = 200;
  a!.down(centre(geo(c.layout), model.cell(0)));
  while (model.ironAt(model.across()) === 0 && model.on) {
    const i = model.across();
    if (model.gapAt(model.k)) {
      a!.up(centre(geo(c.layout), model.cell(i)));
      a!.down(centre(geo(c.layout), model.cell(i)));
    } else a!.move(centre(geo(c.layout), model.cell(i)));
  }
  expect(model.k).toBe(c.layout.pass);
  expect(model.on).toBe(false);
  a!.up(centre(geo(c.layout), model.cell(model.k)));
  a!.frame();
  b!.frame();
  expect(say(a!)).toBe("Seat 2 has the iron.");
  expect(say(b!)).toBe("The iron is yours: set it down at the joint.");
  b!.down(centre(geo(c.layout), model.cell(model.across())));
  b!.frame();
  expect(say(b!)).toBe("You have the iron.");
  expect(b!.moves.map((m) => m.seat)).toEqual([1]);
});

test("every segment's start is ringed and tagged with its seat", () => {
  const c = cases.find((x) => x.name === "level-9-seats-3-shape-1")!;
  const [s] = table(c.layout);
  const pass = c.layout.pass!;
  const length = c.layout.order!.length;
  const tags = [...s!.surface.querySelectorAll(".joint-tag")].map((t) => t.textContent);
  expect(tags).toEqual(
    Array.from({ length: Math.ceil(length / pass) }, (_, j) => String((j % 3) + 1)),
  );
  expect(s!.surface.querySelectorAll(".joint.yours").length).toBe(
    tags.filter((t) => t === "1").length,
  );
});

test("the scene cleans up after itself", () => {
  const [s] = table(cases[0]!.layout);
  s!.scene.destroy();
  expect(s!.surface.children.length).toBe(0);
});

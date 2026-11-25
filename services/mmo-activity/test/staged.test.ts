import { expect, test } from "vite-plus/test";

import type { Datum, Fact } from "../src/api.ts";
import { bareNumbers } from "../src/units.ts";
import { factLine, goodsLine, goodsNames, refusalLine, stagedLine } from "../src/words.ts";

const goods = goodsNames();

function fact(kind: string, data: Record<string, string | number>): Fact {
  const out: Datum[] = Object.entries(data).map(([k, v]) =>
    typeof v === "string" ? { k, s: v } : { k, n: v },
  );
  return { id: 1, tick: 1, kind, subjects: [], data: out, weight: 5 };
}

test("staged goods carry their tag, clean ones none", () => {
  const line = goodsLine([
    { material: "stalker-hide", units: 5, staged: { settlement: 3, name: "Old Rail" } },
    { material: "stalker-hide", units: 2 },
  ]);
  expect(line).toBe("5 treated hide (staged · local to Old Rail), 2 treated hide");
  expect(bareNumbers(line, goods)).toEqual([]);
});

test("a vault taken, or lost to a rival, reads as a line with its units", () => {
  const cases: [Fact, string][] = [
    [
      fact("machine.lost-race", { family: "circuit", haywire: "alarm", winner: "sh-2" }),
      "Circuit went haywire: a rival crew solved it first.",
    ],
    [
      fact("vault.taken", { stage: "st-4", family: "circuit", level: 2, seats: 2, goods: 14 }),
      "The vault is yours: 14 goods among your crew, staged here.",
    ],
    [fact("vault.taken", { stage: "st-4", family: "circuit", goods: 0 }), "The vault is yours."],
  ];
  for (const [f, want] of cases) {
    const line = factLine(f);
    expect(line, f.kind).toBe(want);
    expect(bareNumbers(line, goods), line).toEqual([]);
  }
});

test("staging's refusals say the rule in the player's words", () => {
  expect(refusalLine({ code: "staged-local", message: "staged goods stay local" })).toBe(
    "Staged goods stay where they were staged. They cannot go there.",
  );
  expect(refusalLine({ code: "staged-own", message: "the stager takes nothing" })).toBe(
    "You staged this. Nothing of it is yours to take.",
  );
});

test("a staging names its admins, or its staff with their event points", () => {
  expect(stagedLine({ by: "admins", label: "Lantern Hall" })).toBe(
    "Staged by the admins of Lantern Hall",
  );
  const staff = stagedLine({ by: "staff", label: "Lantern Hall", points: 80 });
  expect(staff).toBe("Staged by staff of Lantern Hall · 80 event points");
  expect(bareNumbers(staff, goods)).toEqual([]);
});

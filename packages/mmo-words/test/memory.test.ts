import { expect, test } from "vite-plus/test";

import { bareNumbers, type Names } from "../src/index.ts";
import { type DossierLike, memoryLines } from "../src/memory.ts";

const LEX: Record<string, string> = {
  "items.materials:copper-ore": "Copper wire",
  "creatures.archetypes:seam-crawler": "Rust crawler",
};
const names: Names = {
  name: (sheet, id) => LEX[`${sheet}:${id}`] ?? id.charAt(0).toUpperCase() + id.slice(1),
};

const DAY = 144;

const dossier: DossierLike = {
  oldest: [
    { kind: "greeted", tick: 3 * DAY + 5, who: "you" },
    { kind: "traded", tick: 4 * DAY, who: "a traveller from Iron Kin", thing: "Glass fibre" },
    { kind: "traded", tick: 5 * DAY, who: "you", thing: "copper-ore" },
    { kind: "fought", tick: 6 * DAY, who: "c-41", thing: "seam-crawler" },
    { kind: "resold", tick: 7 * DAY, who: "you", thing: "Scrap iron", n: 12, unit: "coin" },
    { kind: "fortune", tick: 1_200 * DAY },
    { kind: "rumoured", tick: 8 * DAY, thing: "a road cut" },
  ],
  folded: [
    { type: "greeted", count: 12 },
    { type: "traded", count: 1 },
    { type: "odd-kind", count: 2 },
    { type: "helped", count: 0 },
  ],
  names: { "guild:g1": "Iron Kin", "npc:n1": "Ada Mercer" },
};

test("the oldest entries are told by day, and the folded counts with their units", () => {
  expect(memoryLines(dossier, names)).toEqual([
    "Day 3: You greeted them.",
    "Day 4: A traveller from Iron Kin sold them Glass fibre.",
    "Day 5: You sold them Copper wire.",
    "Day 6: A traveller beat the Rust crawler beside them.",
    "Day 7: They sold on Scrap iron, 12 coin over what they paid.",
    "Day 1,200: They came into a fortune.",
    "Day 8: Rumoured: a road cut.",
    "Older memories folded away: greeted 12 times, traded with 1 time and odd kind 2 times.",
  ]);
});

test("a character id or an unnamed guild is never shown", () => {
  const lines = memoryLines(
    {
      oldest: [
        { kind: "helped", tick: 0, who: "c-77" },
        { kind: "helped", tick: 0, who: "a traveller from Nobody Named" },
        { kind: "helped", tick: 0 },
      ],
      names: {},
    },
    names,
  );
  expect(lines).toEqual([
    "Day 0: A traveller helped them.",
    "Day 0: A traveller helped them.",
    "Day 0: Someone helped them.",
  ]);
});

test("no line holds a bare number, and an empty dossier gives no lines", () => {
  for (const l of memoryLines(dossier, names)) expect(bareNumbers(l), l).toEqual([]);
  expect(memoryLines({ oldest: [], names: {} }, names)).toEqual([]);
});

// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { afterEach, expect, test } from "vite-plus/test";

import type { ActivityState, Datum, Fact, PatternPoint } from "../src/api.ts";
import { bareNumbers } from "../src/units.ts";
import { PatternStrip, patternParts } from "../src/views/pattern.ts";
import { clueLine, factLine, goodsNames, heldLine, pointName } from "../src/words.ts";

const state: ActivityState = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/state-pattern.json`, "utf8"),
);
const point = state.pattern as PatternPoint;

afterEach(() => document.body.replaceChildren());

function texts(root: Element): string[] {
  const out: string[] = [];
  for (const node of root.querySelectorAll("h2, h3, p, li")) {
    if (node.querySelector("h2, h3, p, li")) continue;
    const t = (node.textContent ?? "").trim();
    if (t) out.push(t);
  }
  return out;
}

function fact(kind: string, data: Record<string, string | number>): Fact {
  const out: Datum[] = Object.entries(data).map(([k, v]) =>
    typeof v === "string" ? { k, s: v } : { k, n: v },
  );
  return { id: 1, tick: 10, kind, subjects: [], data: out, weight: 60 };
}

function clue(says: string, point: number, other: number, n: number): Fact {
  return fact("pattern.clue", { board: "b@0,0", rule: "r", says, point, other, n });
}

test("the strip draws the fixture's point: the board's points, the mark here, the lapse and the clues", () => {
  const root = new PatternStrip().show(point, true);
  document.body.append(root);
  expect([...root.querySelectorAll(".pattern-points li")].map((li) => li.textContent)).toEqual([
    "A",
    "B",
    "C",
  ]);
  expect(root.querySelector(".pattern-points [aria-current]")?.textContent).toBe("B");
  expect(root.querySelector("h2")?.textContent).toBe("Pattern: settings");
  expect(texts(root)).toEqual([
    "Pattern: settings",
    "A",
    "B",
    "C",
    "This pylon is point B of points A to C.",
    "Point B holds setting #3.",
    "Other points show what they hold only where they stand.",
    "It is set in chat, and its Circuit machine commits it here.",
    "What a point holds lapses after 3 world days unless the pattern is solved.",
    "Clues found",
    "Point B's setting is point A's turned on 2 times, round past the last back to #0.",
    "Point C holds the same setting as point B.",
  ]);
});

const variants: [string, PatternPoint][] = [
  ["the fixture", point],
  ["nothing held, no clues", { ...point, held: undefined, clues: undefined }],
  ["solved", { ...point, solved: true }],
  [
    "a beacon set by delivery",
    { ...point, kind: "completion", place: "beacon", family: undefined, held: 1 },
  ],
  ["a lone point", { ...point, points: 1, point: 0, lapseDays: 1 }],
  [
    "a relay's facing",
    { ...point, kind: "alignment", place: "relay", family: "signal", values: 6, held: 5 },
  ],
  ["no lapse sent", { ...point, lapseDays: 0 }],
];

test.each(variants)("the strip holds no number without its unit: %s", (_, p) => {
  const root = patternParts(p, true);
  const goods = goodsNames();
  for (const t of texts(root)) expect(bareNumbers(t, goods), `"${t}"`).toEqual([]);
});

test("the strip shows only what the state sent: other points carry their letter alone", () => {
  const root = patternParts({ ...point, held: undefined, clues: undefined }, true);
  const pips = [...root.querySelectorAll(".pattern-points li")];
  expect(pips.map((li) => li.textContent)).toEqual(["A", "B", "C"]);
  expect(root.textContent).not.toMatch(/#\d/);
  expect(root.textContent).toContain("Nothing is held here yet.");
  expect(root.textContent).toContain("None yet.");
  expect(patternParts({ ...point, lapseDays: 0 }, true).textContent).not.toContain("lapses");
  expect(patternParts({ ...point, solved: true }, true).textContent).toContain("Solved.");
});

test("the strip keeps one node while redrawn, and the viewer's open or shut holds at its point", async () => {
  const strip = new PatternStrip();
  const root = strip.show(point, false);
  document.body.append(root);
  const first = root.querySelector("details")!;
  expect(first.open).toBe(false);
  expect(strip.show(point, false)).toBe(root);
  expect(root.querySelector("details")).toBe(first);
  first.open = true;
  first.dispatchEvent(new Event("toggle"));
  expect(strip.show({ ...point, held: 1 }, false).querySelector("details")!.open).toBe(true);
  // Another point starts as the screen asks again.
  expect(strip.show({ ...point, point: 2 }, false).querySelector("details")!.open).toBe(false);
});

test("a pattern's facts read as lines, each number with its unit", () => {
  const lines = [
    factLine(fact("pattern.set", { board: "b@0,0", point: 2, value: 3 })),
    factLine(fact("pattern.set", { board: "b@0,0", point: 0, value: 4, reach: 2 })),
    factLine(fact("pattern.set", { board: "b@0,0", point: 1, value: 0, reach: 0 })),
    factLine(fact("pattern.haywire", { board: "b@0,0", threat: 340, attempts: 2, wrong: 1 })),
    factLine(fact("pattern.solved", { board: "b@0,0", rule: "triangle", kind: "state" })),
    factLine(clue("offset", 0, 2, 1)),
  ];
  expect(lines).toEqual([
    "Point C of the pattern now holds #3.",
    "Point A of the pattern now holds #4. The signal runs from point A to point B.",
    "Point B of the pattern now holds #0. The signal stops at point A.",
    "The pattern answered wrong: +340 threat surged around it.",
    "The pattern is solved.",
    "Clue found: Point C's setting is point A's turned on 1 time, round past the last back to #0.",
  ]);
  for (const t of lines) expect(bareNumbers(t), t).toEqual([]);
});

test("every clue a board can give reads in its point letters", () => {
  const lines = [
    clueLine(clue("after", 2, 0, 0)),
    clueLine(clue("offset", 1, 2, 0)),
    clueLine(clue("facing", 3, 0, 5)),
    clueLine(clue("live", 1, 0, 1)),
    clueLine(clue("live", 2, 0, 0)),
    clueLine(clue("missing", 1, 3, 0)),
    clueLine(clue("missing", 2, 2, 0)),
    clueLine(clue("near", 1, 0, 2), 6),
    clueLine(clue("near", 5, 0, 1), 6),
    clueLine(clue("near", 3, 0, 0), 6),
  ];
  expect(lines).toEqual([
    "Point C comes before point A.",
    "Point C holds the same setting as point B.",
    "Point D faces #5.",
    "Point B's run is live.",
    "Point C's run is dead.",
    "The missing one lies from point B to point D.",
    "The missing one is point C.",
    "The hidden one lies from point A to point D.",
    "The hidden one lies from point E to point F.",
    "The hidden one is point D.",
  ]);
  for (const t of lines) expect(bareNumbers(t), t).toEqual([]);
});

test("points are lettered A onward, and a held value reads by its kind", () => {
  expect([0, 1, 25, 26, 27, 51, 52].map(pointName)).toEqual([
    "A",
    "B",
    "Z",
    "AA",
    "AB",
    "AZ",
    "BA",
  ]);
  expect(heldLine("state", 2)).toBe("holds setting #2");
  expect(heldLine("alignment", 4)).toBe("faces #4");
  expect(heldLine("completion", 1)).toBe("is raised");
  expect(heldLine("constellation", 0)).toBe("is found");
  expect(heldLine("constellation", 1)).toBe("is activated");
});

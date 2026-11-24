import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { proseProblem } from "../../mmo-narrate/src/check.ts";
import { POOL_LINES, poolLineProblem, poolProblems } from "../../mmo-narrate/src/uses/pool.ts";
import {
  AUTHORED,
  encounterLine,
  type EncounterPool,
  fillSlots,
  fnv1a32,
  WASTELAND_ENCOUNTERS,
} from "../src/encounters.ts";

const beats = JSON.parse(
  readFileSync(
    new URL("../../../services/mmo-world/sheets/fights/beats.json", import.meta.url),
    "utf8",
  ),
) as { rows: { id: string }[] };
const KINDS = beats.rows.map((r) => r.id);

/** Names as the cards fill them: pack creatures, a variant, places with and without an article. */
const CREATURES = ["Scav drone", "Rad-hound", "Plated Wire-eel", "The Grinder"];
const PLACES = ["The Ashfield", "Greywater", "The Pylon Field"];

const fight = (kind: string, beat = 0, id = "enc-7") => ({ id, beat, kind, creature: "reed-rat" });

describe("the committed wasteland pool", () => {
  test("holds the lines for every beat kind and nothing else", () => {
    expect(Object.keys(WASTELAND_ENCOUNTERS.lines).sort()).toEqual([...KINDS].sort());
    for (const k of KINDS) expect(WASTELAND_ENCOUNTERS.lines[k]).toHaveLength(POOL_LINES);
    expect(WASTELAND_ENCOUNTERS.pack).toBe("wasteland");
  });

  test("every line passes the pool check", () => {
    expect(poolProblems(WASTELAND_ENCOUNTERS)).toEqual([]);
  });

  test("every line, filled with real names, passes the prose check with only those names", () => {
    for (const lines of Object.values(WASTELAND_ENCOUNTERS.lines)) {
      for (const line of lines) {
        for (const creature of CREATURES) {
          for (const place of PLACES) {
            const filled = fillSlots(line, { creature, place });
            expect(filled).not.toMatch(/[{}]/);
            expect(proseProblem(filled, { names: [creature, place], maxChars: 240 })).toBeNull();
          }
        }
      }
    }
  });

  test("the authored line covers every beat kind and passes the check", () => {
    expect(Object.keys(AUTHORED).sort()).toEqual([...KINDS].sort());
    for (const line of Object.values(AUTHORED)) {
      expect(poolLineProblem(line)).toBeNull();
      expect(line).not.toContain("{place}");
    }
  });
});

describe("the pool check", () => {
  test("refuses numbers, stray names, other slots, the reader and long lines", () => {
    expect(poolLineProblem("The {creature} circles for three days.")?.reason).toBe("number");
    expect(poolLineProblem("The {creature} circles 3 times.")?.reason).toBe("number");
    expect(poolLineProblem("The {creature} circles Rustmarket.")?.reason).toBe("name");
    expect(poolLineProblem("The {monster} circles.")?.reason).toBe("markup");
    expect(poolLineProblem("The {creature} circles {.")?.reason).toBe("markup");
    expect(poolLineProblem("The {creature} circles your camp.")?.reason).toBe("word");
    expect(poolLineProblem("@everyone the {creature} is here.")?.reason).toBe("mention");
    expect(poolLineProblem(`The {creature} ${"waits ".repeat(30)}.`)?.reason).toBe("too-long");
    expect(poolLineProblem("The {creature} circles {place}.")).toBeNull();
  });
});

describe("the pick", () => {
  test("is FNV-1a 32", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  test("is stable for a fight and a beat", () => {
    const names = { creature: "Scav drone", place: "Greywater" };
    for (const k of KINDS) {
      const a = encounterLine(WASTELAND_ENCOUNTERS, fight(k, 1), names);
      expect(a).not.toBe("");
      expect(encounterLine(WASTELAND_ENCOUNTERS, fight(k, 1), names)).toBe(a);
      const n = fnv1a32(`${WASTELAND_ENCOUNTERS.version}|enc-7|1`) % POOL_LINES;
      expect(a).toBe(fillSlots(WASTELAND_ENCOUNTERS.lines[k]![n]!, names));
    }
  });

  test("moves across the beats of a fight, and across fights", () => {
    const names = { creature: "Scav drone", place: "Greywater" };
    const across = new Set(
      [0, 1, 2, 3, 4].map((b) => encounterLine(WASTELAND_ENCOUNTERS, fight("clash", b), names)),
    );
    expect(across.size).toBeGreaterThan(1);
    const fights = new Set(
      ["enc-1", "enc-2", "enc-3", "enc-4", "enc-5"].map((id) =>
        encounterLine(WASTELAND_ENCOUNTERS, fight("clash", 0, id), names),
      ),
    );
    expect(fights.size).toBeGreaterThan(1);
  });

  test("moves when the pool's version does", () => {
    const names = { creature: "Scav drone", place: "Greywater" };
    const picks = (version: number) =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((b) =>
        encounterLine({ ...WASTELAND_ENCOUNTERS, version }, fight("clash", b), names),
      );
    expect(picks(2)).not.toEqual(picks(1));
  });
});

describe("keys and fallbacks", () => {
  const pool: EncounterPool = {
    pack: "test",
    version: 1,
    lines: {
      clash: ["The {creature} charges."],
      "clash:reed-rat": ["The {creature} skitters in."],
      chase: ["The {creature} runs across {place}."],
    },
  };
  const names = { creature: "Scav drone", place: "Greywater" };

  test("an archetype's own key comes before its kind", () => {
    expect(encounterLine(pool, fight("clash"), names)).toBe("The Scav drone skitters in.");
    expect(encounterLine(pool, { ...fight("clash"), creature: "cinder-hound" }, names)).toBe(
      "The Scav drone charges.",
    );
  });

  test("a missing key gives the authored line", () => {
    expect(encounterLine(pool, fight("guardian"), names)).toBe(
      "The Scav drone stands guard and lets nobody pass.",
    );
    expect(encounterLine(null, fight("lock"), names)).toBe(AUTHORED.lock);
  });

  test("an unknown beat kind gives no line", () => {
    expect(encounterLine(pool, fight("dance"), names)).toBe("");
  });

  test("a line whose slot has no name is passed over", () => {
    expect(encounterLine(pool, fight("chase"), { ...names, place: "" })).toBe(
      "The Scav drone breaks away and runs.",
    );
  });
});

describe("filling the slots", () => {
  test("names keep their own article and lose its capital mid-sentence", () => {
    expect(
      fillSlots("Dust kicks up across {place}.", { creature: "", place: "The Ashfield" }),
    ).toBe("Dust kicks up across the Ashfield.");
    expect(fillSlots("{place} goes quiet.", { creature: "", place: "The Ashfield" })).toBe(
      "The Ashfield goes quiet.",
    );
    expect(fillSlots("Near the {creature}.", { creature: "The Grinder", place: "" })).toBe(
      "Near the Grinder.",
    );
    expect(fillSlots("The {creature} waits.", { creature: "The Grinder", place: "" })).toBe(
      "The Grinder waits.",
    );
    expect(
      fillSlots("The {creature} waits at {place}.", { creature: "Rad-hound", place: "Greywater" }),
    ).toBe("The Rad-hound waits at Greywater.");
  });
});

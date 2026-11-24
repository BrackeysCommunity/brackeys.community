import { describe, expect, test } from "bun:test";

import {
  Narrator,
  memoryStore,
  fixedSwitch,
  stubModel,
} from "../../../packages/mmo-narrate/src/index.ts";
import {
  POOL_LINES,
  poolProblems,
  poolUse,
  type PoolIn,
} from "../../../packages/mmo-narrate/src/uses/pool.ts";
import { encounterLine, WASTELAND_ENCOUNTERS } from "../../../packages/mmo-words/src/encounters.ts";
import {
  loadBook,
  parseArgs,
  poolNarrator,
  poolRequests,
  regenerate,
} from "../scripts/encounter-pool.ts";
import type * as api from "../src/api.ts";
import { problems } from "../src/card.ts";
import { Lexicon } from "../src/lexicon.ts";
import { dungeonName } from "../src/screens/dungeon.ts";
import { beatCard, creatureName, poolLine } from "../src/screens/fight.ts";
import { partyBeatCard } from "../src/screens/party.ts";
import * as mm8 from "./fixtures/mm8.ts";
import * as mm10 from "./fixtures/mm10.ts";
import samples from "./fixtures/world.json";

const w = samples as unknown as Record<string, unknown>;
const NUMBERS: api.Numbers = {
  ambushLine: 600,
  overrunLine: 900,
  crawlTicks: 6,
  woundedTicks: 1,
  freeTicks: 2,
  stepMin: 1,
  stepMax: 3,
  beatsMin: 3,
  beatsMax: 6,
  ruinTroubles: 3,
  cityStationCap: 3,
  roadEnterTicks: 1,
  campTier: 1,
  mastersEase: 1,
  customSeasons: 3,
  bandEdges: { notorious: -50, crooked: -10, decent: 10, upright: 50 },
  goodDay: 6,
  pairDay: 2,
  hotDays: 7,
  hotReach: 12,
  wantedDays: 3,
  fencePays: 60,
  backRoomPays: 70,
  gate: 25,
  trusted: 50,
  grudgeDays: 60,
  launderPercent: 10,
};
const lex = new Lexicon(
  mm10.lexicon({
    ...(w.lexicon as Omit<api.Lexicon, "numbers">),
    numbers: NUMBERS,
    starts: ["hook", "knife", "deck"],
  }),
);
const names = lex.goodsNames();
const fighting = w["options:fight"] as api.Options;
const here = w.here as api.Here;
const KINDS = Object.keys(WASTELAND_ENCOUNTERS.lines);

const withFight = (o: api.Options, f: Partial<api.Fight>): api.Options => ({
  ...o,
  fight: { ...o.fight!, ...f },
});

describe("the beat card opens with the pool line", () => {
  test("first in the description, picked for the fight and its beat", () => {
    const f = fighting.fight!;
    const line = encounterLine(WASTELAND_ENCOUNTERS, f, {
      creature: creatureName(f, lex),
      place: here.name,
    });
    expect(line).not.toBe("");
    const card = beatCard(fighting, here, lex);
    expect(card.description!.startsWith(`${line}\n\n`)).toBe(true);
    expect(card.description).toContain(lex.name("creatures.archetypes", f.creature));
    expect(problems(card, names)).toEqual([]);
  });

  test("the same after a press, and it moves with the beat", () => {
    const card = beatCard(fighting, here, lex, { pressed: [], facts: [] });
    const line = poolLine(fighting.fight!, here.name, lex);
    expect(card.description!.startsWith(line)).toBe(true);
    const lines = new Set(
      [0, 1, 2, 3, 4, 5].map((beat) => poolLine({ ...fighting.fight!, beat }, here.name, lex)),
    );
    expect(lines.size).toBeGreaterThan(1);
  });

  test("a variant is named by its own name", () => {
    const card = beatCard(mm10.onVariant, here, lex);
    expect(card.description!.split("\n\n")[0]).toContain(mm10.variant.name);
    expect(problems(card, names)).toEqual([]);
  });

  test("every committed line, on every beat kind, keeps the card standard", () => {
    for (const kind of KINDS) {
      const seen = new Set<string>();
      for (let i = 0; i < 200 && seen.size < POOL_LINES; i++) {
        const o = withFight(fighting, { id: `e-${i}`, kind });
        const card = beatCard(o, here, lex);
        seen.add(card.description!.split("\n\n")[0]!);
        expect(problems(card, names)).toEqual([]);
      }
      expect(seen.size).toBe(POOL_LINES);
    }
  });
});

describe("the party beat card opens with the pool line", () => {
  test("in a dungeon, the place is the dungeon", () => {
    const f = mm8.shared.fight!;
    const card = partyBeatCard(mm8.shared, mm8.inDungeon, mm8.choosing, lex);
    const line = encounterLine(WASTELAND_ENCOUNTERS, f, {
      creature: creatureName(f, lex),
      place: dungeonName(mm8.inDungeon.floor!, lex),
    });
    expect(line).not.toBe("");
    expect(card.description!.startsWith(`${line}\n\n`)).toBe(true);
    expect(problems(card, names)).toEqual([]);
  });

  test("after a pick, the line still comes first", () => {
    const card = partyBeatCard(mm8.shared, mm8.inDungeon, mm8.party, lex);
    const first = card.description!.split("\n\n")[0]!;
    expect(first).not.toContain("You picked");
    expect(card.description).toContain("You picked");
    expect(problems(card, names)).toEqual([]);
  });

  test("every beat kind keeps the card standard", () => {
    for (const kind of KINDS) {
      for (let i = 0; i < 12; i++) {
        const o = withFight(mm8.shared, { id: `e-${i}`, kind });
        expect(problems(partyBeatCard(o, mm8.inDungeon, mm8.choosing, lex), names)).toEqual([]);
        expect(problems(partyBeatCard(o, here, mm8.choosing, lex), names)).toEqual([]);
      }
    }
  });
});

describe("the pool use", () => {
  const input: PoolIn = {
    beat: "clash",
    tags: [],
    have: WASTELAND_ENCOUNTERS.lines.clash!,
    beatName: "Clash",
  };
  const narrator = (mode?: Parameters<typeof stubModel>[0]) =>
    new Narrator({
      model: stubModel(mode),
      store: memoryStore(),
      switch: fixedSwitch(true),
      dayUsd: 1_000,
      log: () => {},
    });

  test("the stub's reply passes the check: six new lines", async () => {
    const got = await narrator().narrate(poolUse, input, { day: 0 });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value).toHaveLength(POOL_LINES);
    for (const l of got.value) expect(input.have).not.toContain(l);
  });

  for (const mode of ["number", "name", "mention"] as const) {
    test(`a ${mode} in a line fails the check`, async () => {
      const got = await narrator({ mode }).narrate(poolUse, input, { day: 0 });
      expect(got).toEqual({ ok: false, reason: "check", check: mode });
    });
  }

  test("a repeat of a held line or a short list fails", () => {
    const six = poolUse.stub(input) as { lines: string[] };
    expect(poolUse.check(input, { lines: [input.have[0], ...six.lines.slice(1)] })).toMatchObject({
      ok: false,
      reason: "word",
    });
    expect(poolUse.check(input, { lines: six.lines.slice(1) })).toMatchObject({
      ok: false,
      reason: "bad-count",
    });
    expect(poolUse.check(input, { lines: "no" })).toMatchObject({ ok: false, reason: "schema" });
  });

  test("the prompt carries the held lines and asks for the slots", () => {
    const p = poolUse.prompt(input);
    expect(p.user).toContain("<held>");
    expect(p.user).toContain(input.have[0]!);
    expect(p.system).toContain("{creature}");
  });
});

describe("the regenerating script", () => {
  const book = loadBook();

  test("asks for every beat kind by default, and checks a key", () => {
    const all = poolRequests(WASTELAND_ENCOUNTERS, book, null);
    expect(typeof all).not.toBe("string");
    expect((all as PoolIn[]).map((r) => r.beat).sort()).toEqual([...KINDS].sort());
    const own = poolRequests(WASTELAND_ENCOUNTERS, book, ["guardian:barrow-warden"]) as PoolIn[];
    expect(own[0]).toMatchObject({ beat: "guardian", archetype: "barrow-warden" });
    expect(own[0]!.tags).toContain("guardian");
    expect(own[0]!.have).toEqual(WASTELAND_ENCOUNTERS.lines.guardian!);
    expect(own[0]!.creatureName).toBe("Tower guardian");
    expect(poolRequests(WASTELAND_ENCOUNTERS, book, ["dance"])).toBeTypeOf("string");
    expect(poolRequests(WASTELAND_ENCOUNTERS, book, ["clash:nobody"])).toBeTypeOf("string");
  });

  test("a stub run writes a candidate that passes the check, the version moved", async () => {
    const reqs = poolRequests(WASTELAND_ENCOUNTERS, book, null) as PoolIn[];
    const r = await regenerate(
      poolNarrator(stubModel(), 1_000, () => {}),
      WASTELAND_ENCOUNTERS,
      reqs,
    );
    expect(r.failed).toEqual([]);
    expect(r.done.sort()).toEqual([...KINDS].sort());
    expect(r.pool.version).toBe(WASTELAND_ENCOUNTERS.version + 1);
    expect(poolProblems(r.pool)).toEqual([]);
  });

  test("a failed key keeps its lines, and a run with nothing new keeps the version", async () => {
    const reqs = poolRequests(WASTELAND_ENCOUNTERS, book, ["clash"]) as PoolIn[];
    const r = await regenerate(
      poolNarrator(stubModel({ mode: "refusal" }), 1_000, () => {}),
      WASTELAND_ENCOUNTERS,
      reqs,
    );
    expect(r.failed).toEqual([{ key: "clash", reason: "refused" }]);
    expect(r.pool).toEqual(WASTELAND_ENCOUNTERS);
  });

  test("a real run is the owner's, and only it may write over the committed pool", () => {
    expect(parseArgs([])).toMatchObject({ mode: "stub", write: false });
    expect(parseArgs(["--write"])).toBeTypeOf("string");
    expect(parseArgs(["--stub", "--write"])).toBeTypeOf("string");
    expect(parseArgs(["--usd", "2"])).toBeTypeOf("string");
    expect(parseArgs(["--real", "--usd", "0"])).toBeTypeOf("string");
    expect(parseArgs(["--real", "--write", "--usd", "2"])).toMatchObject({
      mode: "real",
      write: true,
      usd: 2,
    });
    expect(parseArgs(["--out"])).toBeTypeOf("string");
    expect(parseArgs(["--keys", "clash,chase"])).toMatchObject({ keys: ["clash", "chase"] });
  });
});

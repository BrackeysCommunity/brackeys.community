import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type DayLedger,
  stubModel,
  type StubMode,
} from "../../../packages/mmo-narrate/src/index.ts";
import { digestUse } from "../../../packages/mmo-narrate/src/uses/digest.ts";
import {
  checkProposals,
  PROPOSALS_MOST,
  proposalsUse,
} from "../../../packages/mmo-narrate/src/uses/proposals.ts";
import {
  jobNarrator,
  parseProposalsArgs,
  type ProposalsArgs,
  runArcProposals,
  seasonDays,
  worldReader,
} from "../scripts/arc-proposals.ts";
import { checkoutBand, parseDigestArgs, runBalanceDigest } from "../scripts/balance-digest.ts";
import * as api from "../src/api.ts";
import samples from "./fixtures/world.json";

const OP = "op-token";
const PLAYER = "player-token";
const TICKS_A_DAY = 144;

const schema = readFileSync(
  new URL("../../mmo-world/sheets/schema/story.arcs.schema.json", import.meta.url),
  "utf8",
);
const effects = (
  JSON.parse(schema) as {
    properties: {
      rows: {
        items: {
          properties: {
            stages: {
              items: {
                properties: { lapse: { items: { properties: { kind: { enum: string[] } } } } };
              };
            };
          };
        };
      };
    };
  }
).properties.rows.items.properties.stages.items.properties.lapse.items.properties.kind.enum;

const kit: api.ArcKit = {
  season: 1,
  templates: ["the-dry-seam", "the-grudge", "proposed-season-0"],
  when: ["betrayal", "dry-region", "leader-died"],
  effects,
  schema,
};

const fact = (id: number, day: number, kind: string, data: api.Datum[] = []): api.Fact => ({
  id,
  tick: day * TICKS_A_DAY,
  kind,
  subjects: [],
  data,
  weight: 80,
});

// Season zero ran world days 0 to 13 and closed on day 14, where season 1
// began; world day 17 is running, so day 16 is the last closed.
const season1: api.Season = {
  n: 1,
  day: 4,
  days: 42,
  band: "opening",
  ends: (14 + 42) * TICKS_A_DAY,
};
const LAST = 16;

function chronicleOf(day: number): api.Chronicle {
  const lines: api.ChronicleLine[] =
    day === 14
      ? [
          {
            fact: fact(900, 14, "season.closed", [
              { k: "season", n: 0 },
              { k: "start", n: 0 },
              { k: "days", n: 14 },
            ]),
          },
          { fact: fact(901, 14, "season.began", [{ k: "season", n: 1 }]) },
        ]
      : day === 5
        ? [{ fact: fact(500, 5, "arc.stage-ended") }]
        : [];
  return { season: season1, day, lines, more: 0, earlier: [] };
}

const arc = (template: string, began: number, extra: Partial<api.Arc> = {}): api.Arc => ({
  id: `a-${template}`,
  template,
  title: `The ${template}`,
  scope: "region",
  cast: [],
  regions: [],
  seat: { q: 0, r: 0 },
  stage: 0,
  stages: 1,
  due: 0,
  dueDay: 0,
  sides: [],
  began: began * TICKS_A_DAY,
  ...extra,
});

const story: api.StoryView = {
  season: season1,
  arcs: [arc("the-grudge", 3, { outcome: "broker-peace" }), arc("the-dry-seam", 15)],
  boards: [],
};

const economy: api.Economy = { active: 40, supply: 15_200, perActive: 380, rate: 60, flagged: [] };

const emergence: api.Emergence = {
  day: 17,
  season: 1,
  active: 40,
  kindsPerMille: [120, 90],
  kindsHealthy: true,
  promotions: [
    { type: "style", count: 1 },
    { type: "variant", count: 0 },
  ],
  need: 1,
  promotionsHealthy: false,
  heavy: 12,
  heavyPlayer: 8,
  heavyHealthy: true,
  pairing: [],
  pairingHealthy: true,
  traces: [{ type: "reliance", count: 30 }],
  recent: [],
};

const forum: api.Forum = {
  day: LAST,
  posts: [
    {
      settlement: 0,
      name: "Pylon Camp",
      banner: "banner-x",
      trades: [],
      movers: [
        {
          material: "copper-wire",
          change: 18,
          last: 13,
          cause: "A raid closed the road to the camp.",
        },
        { material: "scrap-iron", change: -4, last: 7 },
      ],
    },
  ],
};

type Route = { status: number; body: unknown };

/** A world that answers the designer jobs' reads, checking each carries its path's token. */
function fakeWorld(over: Record<string, Route> = {}) {
  const seen: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    const path = url.pathname;
    seen.push(path + url.search);
    const want = path.startsWith(api.PathOperator) ? OP : PLAYER;
    const json = (r: Route) => new Response(JSON.stringify(r.body), { status: r.status });
    if (auth !== `Bearer ${want}`)
      return json({ status: 401, body: { code: "unauthorized", message: "no" } });
    if (over[path]) return json(over[path]);
    const ok = (body: unknown) => json({ status: 200, body });
    switch (path) {
      case api.PathArcKit:
        return ok(kit);
      case api.PathOperatorStory:
        return ok(story);
      case api.PathOperatorEconomy:
        return ok(economy);
      case api.PathOperatorEmergence:
        return ok(emergence);
      case api.PathLexicon:
        return ok(samples.lexicon);
      case api.PathForum:
        return ok(forum);
      case api.PathChronicle: {
        const day = url.searchParams.get("day");
        const d = day === null ? LAST : Number(day);
        if (d > LAST)
          return json({ status: 404, body: { code: api.CodeNotFound, message: "not closed" } });
        return ok(chronicleOf(d));
      }
    }
    return json({ status: 404, body: { code: api.CodeNotFound, message: path } });
  }) as typeof fetch;
  return { read: worldReader("http://world.test", fetcher), seen };
}

const quiet = () => {};
const outDir = () => mkdtempSync(join(tmpdir(), "designer-jobs-"));

function stubbed(mode: StubMode = "good") {
  const model = stubModel({ mode });
  return { model, narrator: jobNarrator("stub", { model, log: quiet }) };
}

describe("arc proposals", () => {
  const args = (out: string): ProposalsArgs => ({ season: 0, out, mode: "stub" });

  test("the stub writes rows the check and the harness read", async () => {
    const { read, seen } = fakeWorld();
    const { model, narrator } = stubbed();
    const out = join(outDir(), "season-0.json");
    const said: string[] = [];
    const code = await runArcProposals(args(out), {
      read,
      apiToken: PLAYER,
      operatorToken: OP,
      narrator,
      say: (l) => said.push(l),
    });
    expect(code).toBe(0);
    const file = JSON.parse(readFileSync(out, "utf8")) as { sheet: string; rows: unknown[] };
    expect(file.sheet).toBe("story.arcs");
    expect(file.rows.length).toBeGreaterThan(0);
    expect(file.rows.length).toBeLessThanOrEqual(PROPOSALS_MOST);
    const row = file.rows[0] as { id: string; when: string };
    expect(kit.templates).not.toContain(row.id);
    expect(kit.when).toContain(row.when);
    expect(said.join("\n")).toContain("season 0: world days 0 to 13");
    expect(said.join("\n")).toContain(`go run ./cmd/harness proposals -in ${out}`);
    expect(model.calls.length).toBe(1);
    const call = model.calls[0]!;
    expect([call.use, call.model, call.effort, call.stream]).toEqual([
      "proposals",
      "claude-opus-5-5",
      "high",
      true,
    ]);
    expect(call.user).toContain("Season 0: world days 0 to 13");
    expect(call.user).toContain("Templates cast: the-grudge 1");
    expect(call.user).toContain("Templates not cast: the-dry-seam, proposed-season-0");
    expect(row.id).toBe("proposed-season-0-2");
    expect(seen.filter((p) => p.startsWith(api.PathChronicle)).length).toBeGreaterThan(14);
  });

  test("a refusal writes nothing", async () => {
    const { read } = fakeWorld();
    const out = join(outDir(), "season-0.json");
    const said: string[] = [];
    const code = await runArcProposals(args(out), {
      read,
      apiToken: PLAYER,
      operatorToken: OP,
      narrator: stubbed("refusal").narrator,
      say: (l) => said.push(l),
    });
    expect(code).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(said.join("\n")).toContain("refused");
  });

  test("off and a failed check write nothing either", async () => {
    for (const narrator of [jobNarrator("off", { log: quiet }), stubbed("truncated").narrator]) {
      const { read } = fakeWorld();
      const out = join(outDir(), "season-0.json");
      const code = await runArcProposals(args(out), {
        read,
        apiToken: PLAYER,
        operatorToken: OP,
        narrator,
        say: quiet,
      });
      expect(code).toBe(1);
      expect(existsSync(out)).toBe(false);
    }
  });

  test("the check holds rows to the kit", () => {
    const input = { kit, ledger: "", season: 0 };
    const good = (proposalsUse.stub(input) as { rows: Record<string, unknown>[] }).rows[0]!;
    const one = (row: Record<string, unknown>) => checkProposals(input, { rows: [row] });
    expect(one(good).ok).toBe(true);
    const reasons = (row: Record<string, unknown>) => {
      const r = one(row);
      return r.ok ? "ok" : `${r.reason}: ${r.detail}`;
    };
    expect(reasons({ ...good, when: "no-such-predicate" })).toContain(
      "bad-id: row 1: when no-such-predicate",
    );
    expect(reasons({ ...good, id: "the-grudge" })).toContain("already a template");
    const famine = structuredClone(good) as { stages: { lapse: { kind: string }[] }[] };
    famine.stages[0]!.lapse = [{ kind: "famine" }];
    expect(reasons(famine)).toContain("schema");
    expect(reasons({ ...good, script: "run()" })).toContain("unknown field script");
    expect(reasons({ ...good, scope: "galaxy" })).toContain("schema");
    expect(reasons({ ...good, chance: 101 })).toContain("above 100");
    const twice = checkProposals(input, { rows: [good, good] });
    expect(twice.ok ? "ok" : twice.detail).toContain("already a template");
    const many = checkProposals(input, {
      rows: Array.from({ length: PROPOSALS_MOST + 1 }, (_, i) => ({
        ...good,
        id: `proposed-${i}`,
      })),
    });
    expect(many.ok ? "ok" : many.reason).toBe("bad-count");
    expect(checkProposals(input, { rows: [] }).ok).toBe(false);
  });

  test("an effect the kit does not list is refused even where the schema allows it", () => {
    const narrow = { ...kit, effects: kit.effects.filter((e) => e !== "nothing") };
    const input = { kit, ledger: "", season: 0 };
    const row = (proposalsUse.stub(input) as { rows: unknown[] }).rows[0];
    const r = checkProposals({ kit: narrow, ledger: "", season: 0 }, { rows: [row] });
    expect(r.ok ? "ok" : r.detail).toContain("effect nothing is not a story effect");
  });

  test("a season's days come from its clock or its close", async () => {
    const last = chronicleOf(LAST);
    const chronicle = async (d: number) => (d <= LAST ? chronicleOf(d) : null);
    expect(await seasonDays(1, last, chronicle)).toEqual({ from: 14, to: 55 });
    expect(await seasonDays(0, last, chronicle)).toEqual({ from: 0, to: 13 });
    await expect(seasonDays(2, last, chronicle)).rejects.toThrow("has not begun");
    // The first day of season 2 has not closed: season 1's close is not
    // readable yet, so its start comes from season zero's close.
    const s2: api.Season = {
      n: 2,
      day: 1,
      days: 42,
      band: "opening",
      ends: (56 + 42) * TICKS_A_DAY,
    };
    const day55 = { ...chronicleOf(LAST), season: s2, day: 55, lines: [] };
    const early = async (d: number) =>
      d === 55 ? day55 : d <= LAST ? chronicleOf(d) : { ...day55, day: d };
    expect(await seasonDays(1, day55, early)).toEqual({ from: 14, to: 55 });
  });

  test("arguments", () => {
    expect(parseProposalsArgs(["--season", "3", "--out", "x.json"])).toMatchObject({
      season: 3,
      mode: "stub",
    });
    expect(parseProposalsArgs(["--season", "3", "--out", "x.json", "--real"])).toMatchObject({
      mode: "real",
    });
    expect(
      parseProposalsArgs(["--season", "3", "--out", "x.json", "--from", "4", "--to", "9"]),
    ).toMatchObject({
      range: { from: 4, to: 9 },
    });
    expect(typeof parseProposalsArgs(["--out", "x.json"])).toBe("string");
    expect(typeof parseProposalsArgs(["--season", "3", "--out", "x", "--from", "4"])).toBe(
      "string",
    );
    expect(typeof parseProposalsArgs(["--season", "3", "--out", "x", "--stub", "--real"])).toBe(
      "string",
    );
  });
});

describe("balance digest", () => {
  const ledger = async (day: number): Promise<DayLedger> => ({
    day,
    usdMicros: day === LAST ? 1_234 : 0,
    uses:
      day === LAST
        ? {
            chronicle: {
              calls: 1,
              hits: 2,
              input: 900,
              output: 300,
              cacheRead: 0,
              cacheWrite: 0,
              usdMicros: 1_234,
              fallbacks: { off: 3 },
            },
          }
        : {},
  });

  async function digest(
    narrator = jobNarrator("off", { log: quiet }),
    over: Record<string, Route> = {},
  ) {
    const { read } = fakeWorld(over);
    const out = join(outDir(), "digest.md");
    let written = "";
    const said: string[] = [];
    const code = await runBalanceDigest(
      { out, mode: "stub" },
      {
        read,
        operatorToken: OP,
        apiToken: PLAYER,
        narrator,
        ledger,
        band: { low: 350, high: 450, from: "the test" },
        write: async (_p, body) => {
          written = body;
        },
        say: (l) => said.push(l),
      },
    );
    expect(code).toBe(0);
    return { md: written, said: said.join("\n") };
  }

  const beforeTables = (md: string) => md.slice(0, md.indexOf("\n## "));

  test("off gives the tables alone", async () => {
    const { md, said } = await digest();
    expect(beforeTables(md)).toBe("# Balance digest: World days 10 to 16\n");
    for (const heading of [
      "Coin per active character",
      "Movers and causes",
      "Faucets and sinks",
      "Promotions against need and the measures",
      "Season and arcs",
      "Narration cost per world day",
    ]) {
      expect(md).toContain(`## ${heading}\n`);
    }
    expect(md).toContain(
      "| coin per active character (the stabiliser's mean) | 380 | coin per active character |",
    );
    expect(md).toContain("| band | 350 to 450 | coin per active character, from the test |");
    expect(md).toContain("| reading | inside the band | against the band |");
    expect(md).toContain(
      "| Pylon Camp | Copper wire | +18% | 13 coin | A raid closed the road to the camp. |",
    );
    expect(md).toContain("| faucet budget at that rate | 2,400 | coin a world day |");
    expect(md).toContain("| style | 1 | 1 | promotions |");
    expect(md).toContain(`| ${LAST} | 1 | 2 | 3 | $0.001234 |`);
    expect(said).toContain("tables alone");
    expect(said).toContain("(off)");
  });

  test("the stub's paragraphs go above the tables and hold no number", async () => {
    const { model, narrator } = stubbed();
    const { md } = await digest(narrator);
    const top = beforeTables(md).split("\n\n").slice(1).filter(Boolean);
    expect(top.length).toBeGreaterThan(0);
    for (const p of top) expect(p).not.toMatch(/\d/);
    expect(md.indexOf(top[0]!)).toBeLessThan(md.indexOf("## Coin per active character"));
    expect(model.calls.map((c) => [c.use, c.model, c.effort])).toEqual([
      ["digest", "claude-sonnet-5-5", "medium"],
    ]);
    const off = await digest();
    expect(md.slice(md.indexOf("\n## "))).toBe(off.md.slice(off.md.indexOf("\n## ")));
  });

  test("a number in a paragraph drops them all", async () => {
    const off = await digest();
    for (const mode of [
      "number",
      "name",
      "mention",
      "refusal",
      "truncated",
      "error",
    ] as StubMode[]) {
      const { md, said } = await digest(stubbed(mode).narrator);
      expect(md).toBe(off.md);
      expect(said).toContain("tables alone");
    }
    expect((await digest(stubbed("number").narrator)).said).toContain("check: number");
  });

  test("emergence off reads as emergence off", async () => {
    const { md } = await digest(undefined, {
      [api.PathOperatorEmergence]: {
        status: 404,
        body: { code: api.CodeNotFound, message: "the world keeps no emergence" },
      },
    });
    expect(md).toContain(
      "## Promotions against need and the measures\n\nEmergence off: the world keeps no emergence.",
    );
    expect(md).toContain("# Balance digest: World days 10 to 16");
  });

  test("any other refusal of a read the digest needs stops it", async () => {
    const { read } = fakeWorld({
      [api.PathOperatorEmergence]: { status: 403, body: { code: "forbidden", message: "no" } },
    });
    await expect(
      runBalanceDigest(
        { out: "x", mode: "off" },
        { read, operatorToken: OP, narrator: jobNarrator("off"), say: quiet },
      ),
    ).rejects.toThrow("403 forbidden");
  });

  test("without the player token or Redis the tables say what was not read", async () => {
    const { read } = fakeWorld();
    let md = "";
    await runBalanceDigest(
      { out: "x", mode: "off" },
      {
        read,
        operatorToken: OP,
        narrator: jobNarrator("off"),
        band: null,
        write: async (_p, b) => {
          md = b;
        },
        say: quiet,
      },
    );
    expect(md).toContain("# Balance digest: World days 10 to 16");
    expect(md).toContain("| band | not read | coin per active character |");
    expect(md).toContain("Movers and causes\n\nNot read: MMO_API_TOKEN");
    expect(md).toContain("Not read: REDIS_URL is not set.");
  });

  test("the weekly ledger report fills faucets and sinks", async () => {
    const report: api.Report = {
      day: 14,
      supply: 15_000,
      active: 40,
      perActive: 375,
      low: 340,
      high: 460,
      rate: 58,
      velocity: 125,
      faucet: 16_000,
      fees: 1_100,
      top: [{ material: "copper-wire", units: 220 }],
      every: 7,
      audit: 0,
    };
    const market = { ...(samples.market as unknown as api.Market), report };
    const { read, seen } = fakeWorld({ [api.PathMarket]: { status: 200, body: market } });
    let md = "";
    await runBalanceDigest(
      { out: "x", mode: "off", character: "c-1" },
      {
        read,
        operatorToken: OP,
        apiToken: PLAYER,
        narrator: jobNarrator("off"),
        write: async (_p, b) => {
          md = b;
        },
        say: quiet,
      },
    );
    expect(seen).toContain(`${api.PathMarket}?characterId=c-1`);
    expect(md).toContain(
      "| band | 340 to 460 | coin per active character, from the weekly ledger report |",
    );
    expect(md).toContain("| fees taken, the same week | 1,100 | coin |");
    expect(md).toContain("| net into purses | 14,900 | coin |");
    expect(md).toContain("| velocity | 1.25 | coin changing hands per coin a world day |");
  });

  test("the stub's paragraphs pass the digest's own check", () => {
    const input = {
      week: "World days 10 to 16",
      tables: "## Coin per active character\n\n| a | b |",
    };
    const r = digestUse.check(input, digestUse.stub(input));
    expect(r.ok).toBe(true);
    expect(digestUse.check(input, { paragraphs: ["It rose by 12 coin."] })).toMatchObject({
      ok: false,
      reason: "number",
    });
  });

  test("the band comes from the checkout's economy.params", async () => {
    expect(await checkoutBand()).toMatchObject({ low: 350, high: 450 });
    expect(await checkoutBand(new URL("file:///no/such/params.json"))).toBeNull();
  });

  test("arguments", () => {
    expect(parseDigestArgs(["--out", "d.md"])).toMatchObject({ mode: "stub" });
    expect(parseDigestArgs(["--out", "d.md", "--off"])).toMatchObject({ mode: "off" });
    expect(parseDigestArgs(["--out", "d.md", "--band", "300-400", "--day", "9"])).toMatchObject({
      band: { low: 300, high: 400 },
      day: 9,
    });
    expect(typeof parseDigestArgs(["--out", "d.md", "--band", "400-300"])).toBe("string");
    expect(typeof parseDigestArgs(["--out", "d.md", "--off", "--real"])).toBe("string");
  });
});

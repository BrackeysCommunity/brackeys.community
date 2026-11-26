import { expect, test } from "bun:test";

import * as api from "../src/api.ts";
import type { Ctx } from "../src/flow.ts";
import { Houses, memoryHeldNames } from "../src/house.ts";
import {
  houseMisses,
  type HouseRun,
  houseRun,
  memoryRedis,
  type TwoServersOps,
  type TwoServersRun,
  twoServersMisses,
  twoServersRun,
} from "../src/scripted.ts";
import type { World } from "../src/world.ts";
import * as story from "./fixtures/mm11-story.ts";
import { house as sample, lex, lexicon, o } from "./fixtures/mm12.ts";
import samples from "./fixtures/world.json";

const A = "1111111111";
const B = "2222222222";
const look = (samples["act:look"] as { reply: api.ActionReply }).reply;

interface Who {
  id: string;
  user: string;
  server: string;
  at: api.Hex;
  version: number;
  goods: api.Goods[];
}

interface Rules {
  /** The world lets any server's staff stage anywhere. */
  scopeless?: boolean;
  /** The world debits admins' stagings too. */
  adminPays?: boolean;
  /** The world mints a crate's goods without the staged tag. */
  untagged?: boolean;
  /** No known way leads to the drop, so travel there is refused. */
  noWay?: boolean;
}

const DIRS: api.Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];
const beside = (at: api.Hex, dir: number): api.Hex => ({
  q: at.q + DIRS[dir]!.q,
  r: at.r + DIRS[dir]!.r,
});

/**
 * A world of two servers, each running one settlement with a staff pool,
 * that stages, opens crates, moves on travel and logs each staging, as
 * the house walk reads it.
 */
function twoServers(rules: Rules = {}) {
  const settlements = new Map<string, api.HouseSettlement>([
    [A, { ...sample.settlements[0]!, pool: 400, refill: 20 }],
    [
      B,
      {
        n: 4,
        name: "Low Wick",
        region: "Saltmarsh",
        pool: 400,
        poolCap: 400,
        refill: 20,
        sites: [{ at: { q: -6, r: 2 }, name: "Sunk barge" }],
      },
    ],
  ]);
  const homes = new Map<string, api.Hex>([
    [A, { q: 0, r: 0 }],
    [B, { q: -8, r: 3 }],
  ]);
  const chars: Who[] = [];
  const stages: (api.StageView & { server: string })[] = [];
  const log: api.LogRow[] = [];
  const acts: api.ActionRequest[] = [];
  let tick = 100;
  const who = (id: string) => {
    const c = chars.find((x) => x.id === id);
    if (!c) throw new Error(`no character ${id}`);
    return c;
  };
  const refuse = (code: string, message: string) => ({
    ok: false as const,
    refusal: { code, message },
  });
  const accept = (c: Who, facts: api.Fact[] = [], points?: number) => {
    c.version++;
    tick++;
    return {
      ok: true as const,
      reply: {
        ...look,
        tick,
        character: { ...look.character, id: c.id, version: c.version, at: c.at, goods: c.goods },
        facts,
        points,
      },
    };
  };
  const stage = (req: api.ActionRequest) => {
    const c = who(req.characterId!);
    const role = req.admin ? "admin" : req.staff ? "staff" : "";
    if (!role) return refuse(api.CodeHouseRole, "not staff or admin of this server");
    const s = [...settlements].find(([, x]) => x.n === req.stage?.settlement);
    if (!s || (s[0] !== req.server && !rules.scopeless))
      return refuse(api.CodeHouseScope, "not a settlement this server's guild runs");
    const t = sample.templates.find((x) => x.id === req.stage?.template);
    if (!t) return refuse(api.CodeStageTemplate, "no such template");
    const points = role === "staff" || rules.adminPays ? t.points : 0;
    if (s[1].pool < points) return refuse(api.CodePoolShort, "the pool is short");
    s[1].pool -= points;
    const at = req.stage!.at;
    const id = `st-${stages.length + 1}`;
    stages.push({
      id,
      server: req.server!,
      template: t.id,
      kind: t.kind,
      placed: {
        by: role === "admin" ? "admins" : "staff",
        label: "Rustwater Crew",
        ...(role === "staff" ? { points } : {}),
      },
      settlement: s[1].n,
      place: s[1].sites.find((x) => x.at.q === at.q && x.at.r === at.r)?.name ?? "",
      at,
      opens: tick,
      ends: tick + 288,
      open: true,
      crates: t.crates,
      hunt: req.stage?.hunt,
    });
    log.push({
      id: log.length + 1,
      server: req.server!,
      tick,
      at: 1_790_000_000_000 + tick,
      character: c.id,
      discord: req.discordId,
      role,
      kind: api.ActStage,
      what: `stage ${t.id} at settlement ${s[1].n} on ${at.q},${at.r}`,
      points,
    });
    return accept(c, [], points || undefined);
  };
  const crate = (req: api.ActionRequest) => {
    const c = who(req.characterId!);
    const st = stages.find((x) => x.id === req.target);
    if (!st?.crates) return refuse(api.CodeNoStage, "no crates left");
    if (c.at.q !== st.at.q || c.at.r !== st.at.r)
      return refuse(api.CodeBadArgs, "stand on the drop's tile to open a crate");
    st.crates--;
    const name = settlements.get(st.server)!.name;
    c.goods.push({
      material: "chips",
      units: 3,
      ...(rules.untagged ? {} : { staged: { settlement: st.settlement, name } }),
    });
    const fact: api.Fact = {
      id: tick,
      tick,
      kind: "crate.opened",
      subjects: [{ kind: "stage", id: st.id }],
      data: [
        { k: "stage", s: st.id },
        { k: "material", s: "chips" },
        { k: "units", n: 3 },
        { k: "left", n: st.crates },
      ],
      weight: 5,
    };
    return accept(c, [fact]);
  };
  const world = {
    async player(user: string) {
      return chars.find((x) => x.user === user)?.id ?? "";
    },
    async options(id: string) {
      const c = who(id);
      const moves = DIRS.map((_, dir) => ({
        ...o.moves[0]!,
        dir,
        to: beside(c.at, dir),
        open: true,
      }));
      return { ...o, characterId: id, version: c.version, tick, at: c.at, conditions: [], moves };
    },
    here: async () => samples.here as api.Here,
    async sheet(id: string) {
      const c = who(id);
      const s = samples.sheet as api.Sheet;
      return { ...s, character: { ...s.character, id, at: c.at, goods: c.goods } };
    },
    map: async () => samples.map as api.MapView,
    routeRisk: async () => ({ ok: true as const, reply: samples.routeRisk as api.RouteRisk }),
    recap: async () => ({ since: tick, tick, lines: [], more: 0 }),
    hunts: async () => ({ tick, every: 1, hunts: [] }),
    lexicon: async () => lexicon,
    board: async () => ({ tick, posts: [] }),
    async house(server: string, _character?: string, f?: { admin?: boolean; staff?: boolean }) {
      const s = settlements.get(server);
      if (!s)
        return { ok: false as const, refusal: { code: api.CodeNotFound, message: "no house" } };
      const reply: api.House = {
        server,
        label: server === A ? "Rustwater Crew" : "Far Crew",
        guild: server === A ? "g-1" : "g-2",
        arrival: s.n,
        settings: {},
        settlements: [{ ...s }],
        templates: sample.templates,
        hunts: sample.hunts,
        contests: sample.contests,
        stages: stages.filter((x) => x.server === server).map(({ server: _, ...v }) => v),
        role: f?.admin ? "admin" : f?.staff ? "staff" : "player",
        stagedXp: 150,
      };
      return { ok: true as const, reply };
    },
    async houseLog(server: string, after: number) {
      const rows = log.filter((r) => r.server === server && r.id > after).slice(0, 1);
      return { rows, next: rows.at(-1)?.id ?? after };
    },
    async act(req: api.ActionRequest) {
      acts.push(req);
      switch (req.kind) {
        case api.ActCreate: {
          const c: Who = {
            id: `c-${chars.length + 1}`,
            user: req.discordId!,
            server: req.server ?? "",
            at: homes.get(req.server ?? "") ?? { q: 0, r: 0 },
            version: 1,
            goods: [],
          };
          chars.push(c);
          return accept(c);
        }
        case api.ActStage:
          return stage(req);
        case api.ActCrateOpen:
          return crate(req);
        case api.ActTravel: {
          if (rules.noWay) return refuse(api.CodeNotHere, "no known way there");
          const c = who(req.characterId!);
          c.at = req.to!;
          return accept(c);
        }
        case api.ActStep: {
          const c = who(req.characterId!);
          c.at = beside(c.at, req.dir!);
          return accept(c);
        }
        default:
          return accept(who(req.characterId!));
      }
    },
  } as unknown as World;
  return { world, acts, log, stages, settlements };
}

async function walk(rules: Rules = {}) {
  const w = twoServers(rules);
  const ctx: Ctx = {
    world: w.world,
    lex,
    threatLine: 600,
    house: new Houses(w.world, { held: memoryHeldNames() }),
  };
  const run: HouseRun = await houseRun(ctx, { servers: [A, B], pass: async () => {} });
  return { ...w, run };
}

test("the house walk stages as admin and as staff, refuses server B, and opens a tagged crate", async () => {
  const { run, acts } = await walk();
  expect(run.problems).toEqual([]);
  expect(houseMisses(run)).toEqual([]);
  expect(run.noConsole).toEqual([
    "This console is for the server's admins",
    "This console is for the server's staff",
  ]);
  expect(run.staged).toEqual([
    "Staged: Large drop",
    "Staged: Hunt, tier 2, 80 event points from the pool",
  ]);
  expect(run.stages.map((s) => [s.template, s.by, s.points])).toEqual([
    ["drop-large", "admins", 0],
    ["hunt-2", "staff", 80],
  ]);
  expect(run.pool).toEqual({
    before: 400,
    afterAdmin: 400,
    afterStaff: 320,
    afterRefused: 320,
    points: 80,
  });
  // The bot itself sends nothing for B's press; only the walk's direct order reaches the world.
  expect(run.refused.card).toBe("Pick a settlement");
  expect(run.refused.code).toBe(api.CodeHouseScope);
  const staged = acts.filter((a) => a.kind === api.ActStage);
  expect(staged.map((a) => [a.server, a.admin ?? false, a.staff ?? false])).toEqual([
    [A, true, false],
    [A, false, true],
    [B, false, true],
  ]);
  // Every house write names its member for the log.
  expect(staged.every((a) => !!a.discordId)).toBe(true);
  expect(run.crate.title).toBe("You opened a crate");
  expect(run.crate.text).toContain("staged · local to");
  expect(run.crate.staged).toHaveLength(1);
  expect(run.houseLog.map((r) => [r.role, r.kind, r.points])).toEqual([
    ["admin", "stage", 0],
    ["staff", "stage", 80],
  ]);
  expect(run.otherLog).toBe(0);
  // The player walked to the drop before the crate opened.
  const kinds = acts.filter((a) => a.characterId === run.characters.player).map((a) => a.kind);
  expect(kinds).toEqual([api.ActCrateOpen, api.ActTravel, api.ActCrateOpen]);
});

test("the walk misses a world that lets server B stage in A", async () => {
  const { run } = await walk({ scopeless: true });
  expect(houseMisses(run)).toContain('the world answered B\'s staging "accepted"');
  expect(houseMisses(run)).toContain("the refused staging moved the pool");
  expect(houseMisses(run)).toContain("server B's log has 1 rows after a refused staging");
});

test("the walk misses an admin staging that pays from the pool", async () => {
  const { run } = await walk({ adminPays: true });
  expect(houseMisses(run)).toEqual(["the admin's staging moved the pool"]);
});

test("the walk misses a crate whose goods come out clean", async () => {
  const { run } = await walk({ untagged: true });
  expect(houseMisses(run)).toEqual(["the player carries no staged goods after the crate"]);
});

test("the walk steps to a drop no known way leads to", async () => {
  const { run, acts } = await walk({ noWay: true });
  expect(houseMisses(run)).toEqual([]);
  const kinds = acts.filter((a) => a.characterId === run.characters.player).map((a) => a.kind);
  expect(kinds).toEqual([
    api.ActCrateOpen,
    api.ActTravel,
    api.ActStep,
    api.ActStep,
    api.ActStep,
    api.ActCrateOpen,
  ]);
});

const DAY_TICKS = 144;
const SEASON_ZERO_ENDS = 14 * DAY_TICKS;

interface SharedRules {
  /** The world posts a staged event to every server's feed with no server tag. */
  untagged?: boolean;
  /** The world takes no rules epoch at the close. */
  noEpoch?: boolean;
  /** Every new server's guild lands at one settlement. */
  oneSettlement?: boolean;
}

/**
 * One world two servers share, as the two-servers walk reads it: each
 * server's first arrival installs its guild at the next settlement, admins
 * save settings and stage, crates and travel are left out, the feed
 * carries each staging under its server, and a manual clock runs the
 * season's close, its epoch and season one.
 */
function sharedWorld(rules: SharedRules = {}) {
  const places: api.HouseSettlement[] = [
    { ...sample.settlements[0]!, pool: 400 },
    { ...sample.settlements[1]!, pool: 400 },
  ];
  const houses = new Map<
    string,
    { guild: string; label: string; n: number; settings: api.HouseSettings }
  >();
  const chars: (Who & { forgotten?: boolean; kit: string[] })[] = [];
  const stages: (api.StageView & { server: string })[] = [];
  const feed: api.StoryEvent[] = [];
  const promos: api.StoryEvent[] = [];
  const acts: api.ActionRequest[] = [];
  let tick = 100;
  let facts = 0;
  let season = { n: 0, day: 1, days: 14, band: "opening", ends: SEASON_ZERO_ENDS };
  const who = (id: string) => {
    const c = chars.find((x) => x.id === id);
    if (!c) throw new Error(`no character ${id}`);
    return c;
  };
  const refuse = (code: string, message: string) => ({
    ok: false as const,
    refusal: { code, message },
  });
  const accept = (c: Who, facts: api.Fact[] = []) => {
    c.version++;
    return {
      ok: true as const,
      reply: {
        ...look,
        tick,
        character: { ...look.character, id: c.id, version: c.version, at: c.at, goods: c.goods },
        facts,
      },
    };
  };
  const event = (kind: string, data: api.Datum[], server?: string): api.StoryEvent => ({
    fact: { id: ++facts, tick, kind, subjects: [], data, weight: 5 },
    ...(server && !rules.untagged ? { server } : {}),
  });
  const houseOf = (server?: string) => {
    const h = houses.get(server ?? "");
    return h && places.find((p) => p.n === h.n)
      ? { h, place: places.find((p) => p.n === h.n)! }
      : null;
  };
  const advance = (to: number) => {
    for (; tick < to; ) {
      tick++;
      if (tick === season.ends && season.n === 0) {
        if (!rules.noEpoch)
          promos.push({
            fact: {
              id: ++facts,
              tick,
              kind: "season.epoch",
              subjects: [],
              data: [
                { k: "season", n: 1 },
                { k: "from", s: "a".repeat(64) },
                { k: "to", s: "b".repeat(64) },
                { k: "sheets", n: 2 },
              ],
              weight: 70,
            },
            epoch: {
              season: 1,
              from: "a".repeat(64),
              to: "b".repeat(64),
              sheets: 2,
              seen: [
                {
                  sheet: "items.materials",
                  row: "bog-iron",
                  name: "Bog iron",
                  column: "tier",
                  change: "changed",
                  before: "1",
                  after: "2",
                  unit: "tier",
                },
              ],
              unseen: 1,
            },
          });
        feed.push(
          event("season.began", [
            { k: "season", n: 1 },
            { k: "start", n: tick },
          ]),
        );
        season = { n: 1, day: 1, days: 42, band: "opening", ends: tick + 42 * DAY_TICKS };
      }
    }
  };
  const stage = (req: api.ActionRequest) => {
    const c = who(req.characterId!);
    const role = req.admin ? "admin" : req.staff ? "staff" : "";
    if (!role) return refuse(api.CodeHouseRole, "not staff or admin of this server");
    const own = houseOf(req.server);
    if (!own || own.place.n !== req.stage?.settlement)
      return refuse(api.CodeHouseScope, "not a settlement this server's guild runs");
    const t = sample.templates.find((x) => x.id === req.stage?.template);
    if (!t) return refuse(api.CodeStageTemplate, "no such template");
    const id = `st-${stages.length + 1}`;
    const at = req.stage!.at;
    stages.push({
      id,
      server: req.server!,
      template: t.id,
      kind: t.kind,
      placed: { by: role === "admin" ? "admins" : "staff", label: own.h.label },
      settlement: own.place.n,
      place: own.place.sites.find((x) => x.at.q === at.q && x.at.r === at.r)?.name ?? "",
      at,
      opens: tick,
      ends: tick + 2 * DAY_TICKS,
      open: true,
      crates: t.crates,
    });
    feed.push({
      ...event(
        "staged.opened",
        [
          { k: "stage", s: id },
          { k: "kind", s: t.kind },
          { k: "template", s: t.id },
        ],
        req.server,
      ),
      place: own.place.name,
    });
    feed.at(-1)!.fact.subjects = [{ kind: "stage", id }];
    return accept(c);
  };
  const world = {
    async player(user: string) {
      return chars.find((x) => x.user === user && !x.forgotten)?.id ?? "";
    },
    async options(id: string) {
      const c = who(id);
      return { ...o, characterId: id, version: c.version, tick, at: c.at, conditions: [] };
    },
    here: async () => samples.here as api.Here,
    async sheet(id: string) {
      const c = who(id);
      const s = samples.sheet as api.Sheet;
      const kit = c.kit.map((k, i) => ({
        ...s.kit[0]!,
        id: k,
        worn: i === 0 ? s.kit[0]!.worn : "",
      }));
      return { ...s, kit, pack: [], character: { ...s.character, id, at: c.at, goods: c.goods } };
    },
    recipes: async () => samples.recipes as api.Recipes,
    appraise: async () => ({ ok: true as const, reply: samples.appraise as api.Appraisal }),
    map: async () => samples.map as api.MapView,
    recap: async () => ({ since: tick, tick, lines: [], more: 0 }),
    hunts: async () => ({ tick, every: 1, hunts: [] }),
    lexicon: async () => lexicon,
    board: async () => ({ tick, posts: [] }),
    async arcs() {
      return { season: { ...season }, open: [], ended: [], backing: [] };
    },
    async storyEvents(after: number) {
      const events = feed.filter((e) => e.fact.id > after).slice(0, 3);
      return { events, last: events.at(-1)?.fact.id ?? Math.max(after, facts) };
    },
    async storyPromotions(after: number) {
      const events = promos.filter((e) => e.fact.id > after);
      return { events, last: events.at(-1)?.fact.id ?? Math.max(after, facts) };
    },
    async chronicle() {
      const day = Math.floor(tick / DAY_TICKS);
      if (day < 1)
        return { ok: false as const, refusal: { code: api.CodeNotFound, message: "no day yet" } };
      return { ok: true as const, reply: { ...story.chronicle, day: day - 1 } };
    },
    chronicleFact: async () => ({
      ok: false as const,
      refusal: { code: api.CodeNotFound, message: "no fact" },
    }),
    async house(server: string, _character?: string, f?: { admin?: boolean; staff?: boolean }) {
      const own = houseOf(server);
      if (!own)
        return { ok: false as const, refusal: { code: api.CodeNotFound, message: "no house" } };
      const reply: api.House = {
        server,
        label: own.h.label,
        guild: own.h.guild,
        arrival: own.place.n,
        settings: structuredClone(own.h.settings),
        settlements: [{ ...own.place }],
        templates: sample.templates,
        hunts: sample.hunts,
        contests: sample.contests,
        stages: stages.filter((x) => x.server === server).map(({ server: _, ...v }) => v),
        role: f?.admin ? "admin" : f?.staff ? "staff" : "player",
        stagedXp: 150,
      };
      return { ok: true as const, reply };
    },
    houseLog: async () => ({ rows: [], next: 0 }),
    async act(req: api.ActionRequest) {
      acts.push(req);
      switch (req.kind) {
        case api.ActCreate: {
          const server = req.server ?? "";
          if (server && !houses.has(server)) {
            const n = rules.oneSettlement ? places[0]!.n : places[houses.size]!.n;
            const guild = `g-${houses.size + 1}`;
            houses.set(server, { guild, label: req.note ?? guild, n, settings: {} });
          }
          const c = {
            id: `c-${chars.length + 1}`,
            user: req.discordId!,
            server,
            at: { q: 0, r: 0 },
            version: 1,
            goods: [] as api.Goods[],
            kit: [`it-${chars.length + 1}`],
          };
          chars.push(c);
          return accept(c);
        }
        case api.ActHouseSettings: {
          if (!req.admin) return refuse(api.CodeHouseRole, "only admins");
          houses.get(req.server ?? "")!.settings = req.settings ?? {};
          return accept(who(req.characterId!));
        }
        case api.ActStage:
          return stage(req);
        case api.ActCraft: {
          const c = who(req.characterId!);
          c.kit.push(`it-made-${c.kit.length}`);
          c.goods = [];
          return {
            ...(samples["act:craft"] as { ok: true; reply: api.ActionReply }),
            ok: true as const,
          };
        }
        case api.ActForget: {
          const c = who(req.characterId!);
          c.forgotten = true;
          return accept(c);
        }
        default:
          return accept(who(req.characterId!));
      }
    },
  } as unknown as World;
  const ops: TwoServersOps = {
    clock: async () => ({
      manual: true,
      tick: async () => tick,
      until: async (to: number) => advance(to),
    }),
    async stock(id, asset, units) {
      if (asset !== "coin") who(id).goods.push({ material: asset.replace(/^mat:/, ""), units });
    },
    audit: async () => [],
  };
  return { world, ops, acts, feed, chars, houses };
}

async function shared(rules: SharedRules = {}) {
  const w = sharedWorld(rules);
  const ctx: Ctx = { world: w.world, lex, threatLine: 600 };
  const redis = memoryRedis();
  const run = await twoServersRun(ctx, { ops: w.ops, servers: [A, B], redis });
  return { ...w, run, redis };
}

test("two servers on one world keep their settings, settlements, staging and channels apart", async () => {
  const { run, acts, redis } = await shared();
  expect(run.problems).toEqual([]);
  expect(twoServersMisses(run)).toEqual([]);
  const [a, b] = run.servers;
  expect([a!.guild, b!.guild]).toEqual(["g-1", "g-2"]);
  expect(a!.settlement).not.toBe(b!.settlement);
  expect(a!.characters.players).toHaveLength(3);
  // Every fake id the run made is snowflake-shaped.
  const users = acts.filter((x) => x.kind === api.ActCreate).map((x) => x.discordId!);
  expect(users).toHaveLength(10);
  for (const u of [...users, a!.mapped.events, b!.mapped.staffRole])
    expect(u).toMatch(/^\d{17,20}$/);
  // The admins installed the guilds: theirs were the first arrivals of each server.
  expect(
    acts
      .filter((x) => x.kind === api.ActCreate)
      .slice(0, 2)
      .map((x) => x.server),
  ).toEqual([A, B]);
  expect(acts.filter((x) => x.kind === api.ActHouseSettings).every((x) => x.admin)).toBe(true);
  // Each events channel holds its own staging and the world's season, never the other's staging.
  for (const s of run.servers) {
    const posted = run.posted[s.server]!;
    const staged = posted.events.filter((p) => p.kind === "staged.opened");
    expect(staged.map((p) => p.server)).toEqual([s.server]);
    expect(posted.events.filter((p) => p.kind === "season.began")).toHaveLength(1);
    expect(posted.promotions.map((p) => p.title)).toEqual(["Season 1 runs on new rules"]);
    expect(posted.chronicle.length).toBeGreaterThan(14);
  }
  expect(run.refused).toEqual({ card: run.refused.card, wrote: false, code: api.CodeHouseScope });
  expect(run.crafted.card).not.toBe("");
  expect(run.crafted.item).toMatch(/^it-made-/);
  expect(run.season.n).toBe(1);
  expect(run.season.to).toBeGreaterThanOrEqual(run.season.began + DAY_TICKS);
  expect(run.forget.asked).toBe("Forget you and your character?");
  expect(run.forget.done).toBe("You are forgotten");
  expect(run.forget.purged).toBeGreaterThanOrEqual(5);
  expect(run.forget.left).toEqual([]);
  expect(run.forget.othersKept).toBe(true);
  // What the step seeded of others is gone again.
  expect(redis.keys()).toEqual([]);
});

test("the walk misses a world that shows one server's staging in the other's channel", async () => {
  const { run } = await shared({ untagged: true });
  const misses = twoServersMisses(run);
  // Untagged, a staging reads as the world's own: both channels show both, and neither as its own.
  expect(misses).toContain(`${A}'s events channel holds none of its own staging`);
  expect(misses).toContain(`${B}'s events channel holds none of its own staging`);
});

test("the walk misses an epoch card that never came, unless none is expected", async () => {
  const { run } = await shared({ noEpoch: true });
  expect(twoServersMisses(run)).toEqual([
    `${A} posted the epoch card 0 times, not once`,
    `${B} posted the epoch card 0 times, not once`,
  ]);
  expect(twoServersMisses(run, false)).toEqual([]);
});

test("the walk misses two guilds at one settlement", async () => {
  const { run } = await shared({ oneSettlement: true });
  const misses = twoServersMisses(run);
  expect(misses).toContain(`both guilds run settlement ${run.servers[0]!.settlement}`);
});

test("a forget that leaves the bot's keys behind, or a foreign staging posted, is a miss", async () => {
  const { run } = await shared();
  const broken: TwoServersRun = structuredClone(run);
  broken.forget.left = ["mmo-bot:cd:1"];
  broken.posted[A]!.events.push({
    channel: run.servers[0]!.mapped.events,
    kind: "staged.opened",
    fact: 999,
    server: B,
    title: "x",
  });
  broken.audit = ["coin: off by 1"];
  expect(twoServersMisses(broken)).toEqual([
    `${A}'s events channel holds 1 events another server staged`,
    "the bot's Redis still holds mmo-bot:cd:1",
    "the audit found 1 discrepancies",
  ]);
});

test("the memory Redis matches SCAN patterns as Redis does", async () => {
  const r = memoryRedis();
  await r.set("mmo-narr:last:a:1*2", "x");
  await r.set("mmo-narr:last:a:132", "x");
  const [, keys] = await r.scan("0", "MATCH", "mmo-narr:last:*:1\\*2", "COUNT", 10);
  expect(keys).toEqual(["mmo-narr:last:a:1*2"]);
  await r.rpush("l", "a", "b", "a");
  expect(await r.lrange("l", 0, -1)).toEqual(["a", "b", "a"]);
  expect(await r.lrem("l", 0, "a")).toBe(2);
  expect(await r.del("l", "mmo-narr:last:a:132", "none")).toBe(2);
});

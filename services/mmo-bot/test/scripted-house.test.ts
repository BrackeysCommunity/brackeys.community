import { expect, test } from "bun:test";

import * as api from "../src/api.ts";
import type { Ctx } from "../src/flow.ts";
import { Houses, memoryHeldNames } from "../src/house.ts";
import { houseMisses, type HouseRun, houseRun } from "../src/scripted.ts";
import type { World } from "../src/world.ts";
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

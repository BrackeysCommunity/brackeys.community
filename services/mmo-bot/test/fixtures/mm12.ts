import * as api from "../../src/api.ts";
import { answer, type Ctx, type Press } from "../../src/flow.ts";
import { Houses, memoryHeldNames } from "../../src/house.ts";
import type { Id } from "../../src/ids.ts";
import { Lexicon } from "../../src/lexicon.ts";
import type { World } from "../../src/world.ts";
import { lex as namingLex } from "./mm11-naming.ts";
import samples from "./world.json";

/**
 * A server's house as its staff and admins read it: two settlements its
 * guild runs, each with a staff pool and known sites; the templates, hunts
 * and contests a console offers; a live drop by the admins and a hunt by
 * staff; open cases on a member, a goal and a post; a hold, a mask and a
 * hidden note; and the public log. A world that keeps every write serves
 * it, as the bot reads the world.
 */

export const o = samples.options as api.Options;
const here = samples.here as api.Here;

export const GUILD = "1111111111";

export const names: Record<string, string> = {
  "liveops.templates:drop-large": "Large drop",
  "liveops.contests:rat-cull": "Rat cull",
  "liveops.contests:hound-hunt": "Hound hunt",
  "fights.hunts:cinder-hound": "Cinder hounds",
  "story.pattern-puzzles:second-triangle": "The second triangle",
  "map.landmarks:old-pylon": "Old pylon",
  "map.landmarks:cut-mast": "Cut mast",
  "map.site-kinds:scrap-seam": "Scrap seam",
  "map.terrain:scrub": "Scrubland",
  "map.terrain:marsh": "Marsh",
};

export const lexicon: api.Lexicon = {
  ...(samples.lexicon as unknown as api.Lexicon),
  starts: namingLex.starts as string[],
  numbers: namingLex.numbers,
  names: { ...(samples.lexicon as unknown as api.Lexicon).names, ...names },
};
export const lex = new Lexicon(lexicon);

const sites: api.HouseSite[] = [
  { at: { q: 3, r: -1 }, name: "Old pylon" },
  { at: { q: 4, r: -2 }, name: "Cut mast" },
];

export const house: api.House = {
  server: GUILD,
  label: "Rustwater Crew",
  guild: "g-1",
  arrival: 0,
  settings: {
    channels: [{ kind: "events", id: "2222222222" }],
    staffRoles: ["3333333333"],
    alarmRoles: ["4444444444"],
    quietFrom: 22 * 60,
    quietTo: 6 * 60,
  },
  settlements: [
    { n: 0, name: "Old Rail", region: "Greywater", pool: 320, poolCap: 400, refill: 27, sites },
    {
      n: 4,
      name: "Low Wick",
      region: "Saltmarsh",
      pool: 40,
      poolCap: 400,
      refill: 20,
      sites: [{ at: { q: -6, r: 2 }, name: "Sunk barge" }],
    },
  ],
  templates: [
    { id: "contest", kind: "contest", points: 30, staff: true, days: 3 },
    { id: "hunt-2", kind: "hunt", points: 80, staff: true, tier: 2, days: 2 },
    { id: "drop-large", kind: "drop", points: 150, staff: true, crates: 120, days: 2 },
    {
      id: "pattern",
      kind: "pattern",
      points: 0,
      staff: false,
      days: 7,
      patterns: ["second-triangle"],
    },
  ],
  hunts: ["cinder-hound"],
  contests: ["rat-cull", "hound-hunt"],
  stages: [
    {
      id: "st-1",
      template: "drop-large",
      kind: "drop",
      placed: { by: "admins", label: "Rustwater Crew" },
      settlement: 0,
      place: "Old pylon",
      at: { q: 3, r: -1 },
      opens: 100,
      ends: 388,
      open: true,
      crates: 117,
    },
    {
      id: "st-2",
      template: "hunt-2",
      kind: "hunt",
      placed: { by: "staff", label: "Rustwater Crew", points: 80 },
      settlement: 0,
      place: "Cut mast",
      at: { q: 4, r: -2 },
      opens: 500,
      ends: 788,
    },
  ],
  cases: [
    { id: "case-1", ref: "character:c-14", reason: "abuse", state: "open", reporters: 3, tick: 90 },
    { id: "case-2", ref: "goal:goal-7", reason: "spam", state: "open", reporters: 1, tick: 95 },
    {
      id: "case-3",
      ref: "post:https://discord.com/channels/1111111111/2222222222/5555555555",
      reason: "other",
      state: "escalated",
      reporters: 1,
      tick: 80,
    },
    { id: "case-4", ref: "guild:g-9", reason: "name", state: "dismissed", reporters: 1, tick: 70 },
  ],
  holds: [{ char: "c-20", kind: "mute", ends: 30, case: "" }],
  masks: ["guild:g-8"],
  hidden: ["goal-5"],
  pins: [
    {
      id: "pin-4",
      at: { q: 3, r: -1 },
      reach: 0,
      fix: { landmark: "old-pylon" },
      as: "admin",
      server: GUILD,
      tick: 60,
    },
    {
      id: "pin-2",
      at: { q: 4, r: -2 },
      reach: 1,
      fix: { ground: { terrain: "marsh", ring: true } },
      as: "admin",
      server: GUILD,
      tick: 40,
      landed: 55,
    },
  ],
  role: "staff",
  stagedXp: 150,
};

export const logRows: api.LogRow[] = [
  {
    id: 3,
    server: GUILD,
    tick: 100,
    at: 1_790_000_000_000,
    character: "c-1",
    discord: "9999999999",
    role: "admin",
    kind: "stage",
    what: "stage drop-large at settlement 0 on 3,-1",
    points: 0,
  },
  {
    id: 7,
    server: GUILD,
    tick: 120,
    at: 1_790_000_600_000,
    character: "c-2",
    discord: "8888888888",
    role: "staff",
    kind: "stage",
    what: "stage hunt-2 at settlement 0 on 4,-2 · hunt cinder-hound · opens in 144 ticks",
    points: 80,
  },
  {
    id: 9,
    server: GUILD,
    tick: 130,
    at: 1_790_001_200_000,
    character: "c-1",
    discord: "9999999999",
    role: "admin",
    kind: "house-settings",
    what: "settings · 1 channel · 1 staff role · 2 alarm roles · quiet 22:00 to 06:00 UTC",
  },
  {
    id: 12,
    server: GUILD,
    tick: 140,
    at: 1_790_001_800_000,
    character: "c-2",
    discord: "8888888888",
    role: "staff",
    kind: "moderate",
    what: "mute c-14 · 7 days · case-1",
  },
  {
    id: 13,
    server: GUILD,
    tick: 150,
    at: 1_790_002_400_000,
    character: "c-1",
    role: "admin",
    kind: "house-pin",
    what: "pin 3,-1 · landmark old-pylon",
  },
];

/** One held name of this guild, one of another, and one held before names carried a guild. */
export const heldRaws = [
  JSON.stringify({
    use: "guild",
    user: "u-1",
    target: "",
    name: "Rude Name",
    day: 4,
    guild: GUILD,
  }),
  JSON.stringify({
    use: "kind",
    user: "u-2",
    target: "k-1",
    name: "Other Name",
    day: 5,
    guild: "7777777777",
  }),
  JSON.stringify({ use: "kind", user: "u-3", target: "k-2", name: "Old Name", day: 2 }),
];

export const channels = [
  { id: "2222222222", name: "events" },
  { id: "2222222223", name: "log" },
];
export const roles = [
  { id: "3333333333", name: "Mods" },
  { id: "4444444444", name: "Raid alarms" },
];

export interface HouseWorldOptions {
  house?: api.House | null;
  refusal?: api.Refusal;
  log?: api.LogRow[];
  /** The page size the world serves the log in. */
  logPage?: number;
}

/** A world that serves the house and keeps every write, with the solo reads the bot's cards need. */
export function houseWorld(opts: HouseWorldOptions = {}) {
  const writes: api.ActionRequest[] = [];
  const reads: string[] = [];
  const flags: ({ admin?: boolean; staff?: boolean } | undefined)[] = [];
  let current = opts.house === undefined ? house : opts.house;
  const rows = opts.log ?? logRows;
  const page = opts.logPage ?? 2;
  const read =
    <T>(name: string, v: T) =>
    async () => {
      reads.push(name);
      return v;
    };
  const world = {
    player: read("player", "c-1"),
    options: read("options", o),
    here: read("here", here),
    sheet: read("sheet", samples.sheet as api.Sheet),
    hunts: read("hunts", { tick: 13, every: 1, hunts: [] }),
    lexicon: read("lexicon", lexicon),
    board: read("board", { tick: 0, posts: [] }),
    async house(_server: string, _character?: string, f?: { admin?: boolean; staff?: boolean }) {
      reads.push("house");
      flags.push(f);
      if (!current)
        return {
          ok: false as const,
          refusal: { code: api.CodeNotFound, message: "this server has no house" },
        };
      return { ok: true as const, reply: current };
    },
    async houseLog(_server: string, after: number) {
      reads.push("houseLog");
      const next = rows.filter((r) => r.id > after).slice(0, page);
      return { rows: next, next: next.at(-1)?.id ?? after };
    },
    async act(req: api.ActionRequest) {
      writes.push(req);
      if (opts.refusal) return { ok: false as const, refusal: opts.refusal };
      if (req.kind === api.ActHouseSettings && current && req.settings)
        current = { ...current, settings: req.settings };
      return {
        ok: true as const,
        reply: {
          ...(samples["act:look"] as { reply: api.ActionReply }).reply,
          points: req.kind === api.ActStage && req.staff && !req.admin ? 80 : undefined,
        },
      };
    },
  } as unknown as World;
  const switched: [string, boolean][] = [];
  const held = memoryHeldNames([...heldRaws]);
  const houses = new Houses(world, {
    writeSwitch: async (g, on) => void switched.push([g, on]),
    held,
  });
  const ctx: Ctx = { world, lex, threatLine: 600, house: houses };
  const press = (id: Id | undefined, over: Partial<Press> & { values?: string[] } = {}) =>
    answer(ctx, {
      id,
      user: "someone",
      guild: GUILD,
      guildName: "Rustwater Crew",
      interaction: "event",
      ...over,
    });
  return { world, ctx, writes, reads, flags, press, switched, held, houses };
}

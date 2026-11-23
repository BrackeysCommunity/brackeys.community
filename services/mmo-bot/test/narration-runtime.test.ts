import { afterEach, beforeEach, expect, test } from "bun:test";
import { inspect } from "node:util";

import Anthropic from "@anthropic-ai/sdk";
import type { Redis } from "ioredis";

import {
  type DayLedger,
  type ModelCall,
  ModelTimeoutError,
  type NarrationModel,
  USES,
  type UseId,
} from "../../../packages/mmo-narrate/src/index.ts";
import { dollars, ledgerLines, parseDays } from "../scripts/narration-ledger.ts";
import { parseSwitch, statusLines } from "../scripts/narration-switch.ts";
import * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { loadConfig, NARRATION_DAY_USD } from "../src/config.ts";
import { answer, type Ctx } from "../src/flow.ts";
import { Lexicon } from "../src/lexicon.ts";
import { type MessagesClient, messagesModel, request } from "../src/narration/anthropic.ts";
import { splitLines, withProse } from "../src/narration/card.ts";
import {
  createNarration,
  dayClock,
  type Narration,
  narratorFor,
  offNarration,
} from "../src/narration/index.ts";
import { redisNarrationStore } from "../src/narration/redis.ts";
import { redisSwitch, SWITCH_CACHE_MS, SWITCH_KEY, switchOn } from "../src/narration/switch.ts";
import type { World } from "../src/world.ts";
import * as mm8 from "./fixtures/mm8.ts";
import * as mm9 from "./fixtures/mm9.ts";
import samples from "./fixtures/world.json";

// --- the switch -----------------------------------------------------------

test("the switch is on only when every level is on, and a server is off until it opts in", () => {
  const use: UseId = "chronicle";
  const rows: [boolean, Record<string, string>, string | undefined, boolean][] = [
    [false, { all: "on", [`use:${use}`]: "on", "server:1": "on" }, "1", false],
    [true, {}, "1", false],
    [true, { "server:1": "on" }, "1", true],
    [true, { "server:1": "off" }, "1", false],
    [true, { "server:1": "yes" }, "1", false],
    [true, { all: "off", "server:1": "on" }, "1", false],
    [true, { all: "on", "server:1": "on" }, "1", true],
    [true, { all: "anything", "server:1": "on" }, "1", true],
    [true, { [`use:${use}`]: "off", "server:1": "on" }, "1", false],
    [true, { "use:recap": "off", "server:1": "on" }, "1", true],
    [true, { "server:2": "on" }, "1", false],
    [true, { "server:": "on" }, "", false],
    // An offline job names no server, so it has no server level.
    [true, {}, undefined, true],
    [true, { all: "off" }, undefined, false],
    [true, { [`use:${use}`]: "off" }, undefined, false],
    [false, {}, undefined, false],
  ];
  for (const [master, levels, server, want] of rows)
    expect([master, levels, server, switchOn(master, levels, use, server)]).toEqual([
      master,
      levels,
      server,
      want,
    ]);
});

test("the switch reads Redis once a cache window, and is off while Redis is unreachable", async () => {
  let now = 1_000;
  let reads = 0;
  let levels: Record<string, string> | Error = { "server:9": "on" };
  const redis = {
    hgetall: async (key: string) => {
      expect(key).toBe(SWITCH_KEY);
      reads++;
      if (levels instanceof Error) throw levels;
      return levels;
    },
  };
  const sw = redisSwitch(redis as unknown as Redis, true, () => now);
  expect(await sw.on("voice", "9")).toBe(true);
  expect(await sw.on("recap", "9")).toBe(true);
  expect(await sw.on("voice", "8")).toBe(false);
  expect(reads).toBe(1);
  levels = { "server:9": "on", all: "off" };
  now += SWITCH_CACHE_MS - 1;
  expect(await sw.on("voice", "9")).toBe(true);
  now += 1;
  expect(await sw.on("voice", "9")).toBe(false);
  expect(reads).toBe(2);
  levels = new Error("connection is closed");
  now += SWITCH_CACHE_MS;
  expect(await sw.on("voice", "9")).toBe(false);
  levels = { "server:9": "on" };
  expect(await sw.on("voice", "9")).toBe(true);

  const off = redisSwitch(redis as unknown as Redis, false, () => now);
  const before = reads;
  expect(await off.on("voice", "9")).toBe(false);
  expect(reads).toBe(before);
});

// --- the narrator and the config -------------------------------------------

const FAKE_KEY = "sk-ant-test-0000-not-a-real-key";
const fakeRedis = {} as unknown as Redis;

test("the narrator exists only with the key, Redis and MMO_NARRATION=on", () => {
  const made: string[] = [];
  const model = (key: string): NarrationModel => {
    made.push(key);
    return { complete: async () => Promise.reject(new Error("no calls in tests")) };
  };
  const quiet = () => {};
  const on = { anthropicKey: FAKE_KEY, narration: true, narrationDayUsd: 1 };
  expect(narratorFor({ ...on, anthropicKey: undefined }, fakeRedis, quiet, model)).toBeNull();
  expect(narratorFor({ ...on, anthropicKey: "" }, fakeRedis, quiet, model)).toBeNull();
  expect(narratorFor(on, null, quiet, model)).toBeNull();
  expect(narratorFor({ ...on, narration: false }, fakeRedis, quiet, model)).toBeNull();
  expect(made).toEqual([]);
  expect(narratorFor(on, fakeRedis, quiet, model)).not.toBeNull();
  expect(made).toEqual([FAKE_KEY]);
});

const ENV = [
  "DISCORD_TOKEN",
  "DISCORD_APP_ID",
  "DISCORD_GUILD_ID",
  "ANTHROPIC_API_KEY",
  "MMO_NARRATION",
  "MMO_NARRATION_DAY_USD",
] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.DISCORD_TOKEN = "discord-token";
  process.env.DISCORD_APP_ID = "1";
  process.env.DISCORD_GUILD_ID = "2";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("the config reads the narration settings and never shows the key", () => {
  process.env.ANTHROPIC_API_KEY = ` ${FAKE_KEY} `;
  process.env.MMO_NARRATION = "on";
  delete process.env.MMO_NARRATION_DAY_USD;
  const c = loadConfig();
  expect(c.anthropicKey).toBe(FAKE_KEY);
  expect(c.narration).toBe(true);
  expect(c.narrationDayUsd).toBe(NARRATION_DAY_USD);
  const shown = [
    JSON.stringify(c),
    JSON.stringify({ config: c }),
    String(c),
    `${c as unknown as string}`,
    inspect(c, { depth: 5 }),
    Bun.inspect(c),
    JSON.stringify({ ...c }),
    Object.keys(c).join(","),
    Object.values(c).join(","),
  ];
  for (const s of shown) expect(s).not.toContain(FAKE_KEY);
  expect({ ...c }.anthropicKey).toBeUndefined();
});

test("narration is off unless MMO_NARRATION is exactly on, and the day budget is validated", () => {
  delete process.env.ANTHROPIC_API_KEY;
  for (const v of [undefined, "", "off", "true", "1", "ON"]) {
    if (v === undefined) delete process.env.MMO_NARRATION;
    else process.env.MMO_NARRATION = v;
    expect(loadConfig().narration).toBe(false);
  }
  expect(loadConfig().anthropicKey).toBeUndefined();
  process.env.MMO_NARRATION_DAY_USD = "2.5";
  expect(loadConfig().narrationDayUsd).toBe(2.5);
  for (const bad of ["0", "-1", "abc", "Infinity", "NaN"]) {
    process.env.MMO_NARRATION_DAY_USD = bad;
    expect(() => loadConfig()).toThrow("MMO_NARRATION_DAY_USD must be a positive number");
  }
});

// --- withProse ----------------------------------------------------------------

const template: Card = {
  context: "In the chronicle channel",
  author: "Season one · day four",
  title: "The fourth day",
  description: "• A raid on the Saltworks was held.\n• The well at Ditchend ran dry.",
  picture: { media: "banner-abc", alt: "The Saltworks under raid" },
  fields: [{ name: "Earlier days", value: "the third day", inline: true }],
  footer: "Open a line to see what caused it.",
  rows: [
    {
      select: {
        customId: "chronicle-fact",
        placeholder: "A line and what caused it",
        options: [{ label: "The raid", value: "12" }],
      },
    },
  ],
  colour: 0xa4482a,
};

test("withProse keeps every field, row and the footer, and moves the lines into The record", () => {
  const prose = "The Saltworks held against the raiders, and the well at Ditchend ran dry.";
  const card = withProse(template, prose);
  expect(card.description).toBe(prose);
  expect(card.fields).toEqual([
    { name: "The record", value: template.description! },
    ...template.fields!,
  ]);
  const { description: _a, fields: _b, ...rest } = card;
  const { description: _c, fields: _d, ...was } = template;
  expect(rest).toEqual(was);
  expect(withProse(template, prose, "What happened").fields![0]!.name).toBe("What happened");
  expect(withProse({ ...template, description: undefined }, prose).fields).toEqual(template.fields);
  expect(template.description).toContain("Saltworks");
  expect(template.fields).toHaveLength(1);
  expect(problems(card, new Set())).toEqual(problems(template, new Set()));
});

test("the record splits at 1,024 characters on line boundaries", () => {
  const lines = Array.from(
    { length: 60 },
    (_, i) => `• Line ${"x".repeat(40)} ${"y".repeat(i % 7)}`,
  );
  const text = lines.join("\n");
  const parts = splitLines(text, 1024);
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.length).toBeLessThanOrEqual(1024);
  expect(parts.join("\n")).toBe(text);
  const long = "z".repeat(2500);
  const cut = splitLines(long, 1024);
  expect(cut.map((p) => p.length)).toEqual([1024, 1024, 452]);
  expect(cut.join("")).toBe(long);
  const card = withProse({ ...template, description: text }, "Told.");
  expect(card.fields!.filter((f) => f.name === "The record").map((f) => f.value)).toEqual(parts);
});

// --- offNarration and createNarration ------------------------------------------------

const conv = samples.npc as api.Conversation;
const story = mm9.chronicle;

test("offNarration gives every template unchanged and asks for no dossier", async () => {
  const made = () => structuredClone(template);
  expect(await offNarration.chronicle(story, "1", "post", made)).toEqual(template);
  expect(await offNarration.event({} as api.StoryEvent, "1", "cached", made)).toEqual(template);
  expect(await offNarration.recap(samples.recap as api.Recap, "u", "1", made)).toEqual(template);
  const talked = await offNarration.talk(conv, "u", "1");
  expect(talked.conv).toBe(conv);
  expect(talked.remembers).toBeUndefined();
  expect(await offNarration.wantsDossier("u", "1")).toBe(false);
});

test("createNarration fills the gaps from offNarration, and a part that throws gives the template", async () => {
  const lines: string[] = [];
  const told = { ...template, description: "Told." };
  const n = createNarration(
    {
      chronicle: async () => told,
      recap: async () => {
        throw new Error("store down");
      },
      talk: () => {
        throw new Error("sync throw");
      },
      wantsDossier: async () => {
        throw new Error("no");
      },
    },
    (l) => lines.push(l),
  );
  const made = () => template;
  expect(await n.chronicle(story, "1", "post", made)).toBe(told);
  expect(await n.event({} as api.StoryEvent, "1", "post", made)).toBe(template);
  expect(await n.recap(samples.recap as api.Recap, "u", "1", made)).toBe(template);
  expect((await n.talk(conv, "u", "1")).conv).toBe(conv);
  expect(await n.wantsDossier("u", "1")).toBe(false);
  expect(lines).toEqual([
    "[narration] recap: Error: store down",
    "[narration] talk: Error: sync throw",
    "[narration] wantsDossier: Error: no",
  ]);
  const off = createNarration({});
  expect(await off.chronicle(story, "1", "post", made)).toBe(template);
});

test("the day clock keeps the newest day it saw", () => {
  const c = dayClock();
  expect(c.today()).toBe(0);
  c.saw(4);
  c.saw(2);
  c.saw(Number.NaN);
  expect(c.today()).toBe(4);
});

// --- the flow -----------------------------------------------------------------

const lex = new Lexicon({
  ...samples.lexicon,
  starts: ["hook", "knife", "deck"],
  numbers: {
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
  },
});

const recap = { ...(samples.recap as api.Recap), day: 6, awayHours: 9 } as api.Recap;

function world(npcs: { dossier?: boolean }[]): World {
  const recorded = (samples["act:look"] as { reply: api.ActionReply }).reply;
  return {
    act: async () => ({ ok: true, reply: recorded }),
    player: async () => "c-1",
    options: async () => mm8.o,
    sheet: async () => samples.sheet as api.Sheet,
    here: async () => mm8.here,
    map: async () => samples.map as api.MapView,
    appraise: async () => ({ ok: true, reply: samples.appraise as api.Appraisal }),
    recipes: async () => samples.recipes as api.Recipes,
    recap: async () => recap,
    npc: async (_id, _npc, opts) => {
      npcs.push(opts ?? {});
      return { ok: true, reply: conv };
    },
    lexicon: async () => samples.lexicon as unknown as api.Lexicon,
    media: async () => new Uint8Array([1]),
    market: async () => ({ ok: true, reply: samples.market as api.Market }),
    history: async () => ({ ok: true, reply: samples.history as api.History }),
    routeRisk: async () => ({ ok: true, reply: samples.routeRisk as api.RouteRisk }),
    forum: async () => samples.forum as api.Forum,
    goals: async () => ({ ok: true, reply: samples.goals as unknown as api.Goals }),
    board: async () => samples.board as api.Board,
    guild: async () => samples.guild as unknown as api.Guild,
    classes: async () => samples.classes as api.Classes,
    party: async () => mm8.alone,
    parties: async () => ({ tick: 13, parties: [] }),
    hunts: async () => ({ tick: 13, every: 1, hunts: [] }),
    chronicle: async () => ({ ok: true, reply: story }),
    chronicleFact: async () => ({ ok: false, refusal: { code: api.CodeNotFound, message: "" } }),
    arcs: async () => ({ season: story.season, open: [], ended: [], backing: [] }),
    storyEvents: async () => ({ events: [], last: 0 }),
    storyPromotions: async () => ({ events: [], last: 0 }),
  };
}

const presses = {
  play: { command: "play" },
  chronicle: { command: "chronicle" },
  talk: { id: { action: "talk" as const, target: conv.npc.id, version: mm8.o.version } },
};

async function cardsOf(ctx: Ctx): Promise<Record<keyof typeof presses, Card>> {
  const out: Partial<Record<keyof typeof presses, Card>> = {};
  for (const [name, p] of Object.entries(presses))
    out[name as keyof typeof presses] = (
      await answer(ctx, { ...p, user: "u-1", guild: "g-1", interaction: "i-1" })
    ).card;
  return out as Record<keyof typeof presses, Card>;
}

test("a Ctx without narration and one with offNarration give the same cards", async () => {
  const plain = await cardsOf({ world: world([]), lex, threatLine: 600 });
  const off = await cardsOf({
    world: world([]),
    lex,
    threatLine: 600,
    narration: offNarration,
    narrator: null,
    day: dayClock(),
  });
  expect(off).toEqual(plain);
  expect(plain.play.title).not.toBe(plain.chronicle.title);
});

test("the flow narrates the recap and the chronicle, and voices the talk through the hooks", async () => {
  const calls: string[] = [];
  const npcs: { dossier?: boolean }[] = [];
  const narration: Narration = {
    chronicle: async (ch, server, mode, t) => {
      calls.push(`chronicle ${ch.day} ${server} ${mode}`);
      return { ...t(), description: "Told." };
    },
    event: offNarration.event,
    recap: async (r, user, server, t) => {
      calls.push(`recap ${r.day} ${user} ${server}`);
      return withProse(t(), "Since you left, they held.");
    },
    talk: async (c, user, server) => {
      calls.push(`talk ${c.npc.id} ${user} ${server}`);
      return { conv: c, remembers: "They remember the salt you sold." };
    },
    wantsDossier: async (user, server) => {
      calls.push(`dossier? ${user} ${server}`);
      return true;
    },
  };
  const day = dayClock();
  const ctx: Ctx = { world: world(npcs), lex, threatLine: 600, narration, narrator: null, day };
  const plain = await cardsOf({ world: world([]), lex, threatLine: 600 });
  const told = await cardsOf(ctx);
  expect(calls).toEqual([
    "recap 6 u-1 g-1",
    `chronicle ${story.day} g-1 cached`,
    "dossier? u-1 g-1",
    `talk ${conv.npc.id} u-1 g-1`,
  ]);
  expect(npcs).toEqual([{ dossier: true }]);
  expect(day.today()).toBe(Math.max(6, story.day + 1));
  expect(told.chronicle.description).toBe("Told.");
  expect(told.play.fields![0]).toEqual({ name: "The record", value: plain.play.description! });
  expect(told.talk.fields!.at(-1)).toEqual({
    name: "Remembers",
    value: "They remember the salt you sold.",
  });
  const names = lex.goodsNames();
  for (const c of Object.values(told)) expect(problems(c, names)).toEqual([]);
});

// --- the Anthropic client -------------------------------------------------------------

// The real client fits the shape the model uses, with no client made.
type Fits<T> = T extends MessagesClient ? true : false;
const fits: Fits<Anthropic> = true;

const call: ModelCall = {
  use: "chronicle",
  model: "claude-haiku-5-5",
  effort: "low",
  maxTokens: 2000,
  timeoutMs: 30_000,
  stream: false,
  system: "You retell the record.",
  user: "#1 raid.held The raid was held.",
  schema: { type: "object", properties: { sentences: { type: "array" } } },
  stub: null,
};

function message(over: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "s" } as unknown as Anthropic.ContentBlock,
      { type: "text", text: '{"sentences":', citations: null } as Anthropic.TextBlock,
      { type: "text", text: "[]}", citations: null } as Anthropic.TextBlock,
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: null,
    } as Anthropic.Usage,
    ...over,
  } as Anthropic.Message;
}

function fake(reply: () => Promise<Anthropic.Message>) {
  const seen: { body: Anthropic.MessageStreamParams; options?: unknown }[] = [];
  const client: MessagesClient = {
    messages: {
      stream(body, options) {
        seen.push({ body, options });
        return { finalMessage: reply };
      },
    },
  };
  return { client, seen };
}

test("the request caches the system prompt, asks for the use's schema and effort, and sends no sampling or thinking", async () => {
  expect(fits).toBe(true);
  const { client, seen } = fake(async () => message({}));
  const signal = new AbortController().signal;
  const r = await messagesModel(client).complete(call, signal);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.body).toEqual(request(call));
  expect(seen[0]!.body).toEqual({
    model: "claude-haiku-5-5",
    max_tokens: 2000,
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.user }],
    output_config: { effort: "low", format: { type: "json_schema", schema: call.schema } },
  });
  for (const k of ["thinking", "temperature", "top_p", "top_k", "fallbacks", "stream"])
    expect(k in seen[0]!.body).toBe(false);
  expect(seen[0]!.options).toEqual({ timeout: 30_000, signal });
  expect(r).toEqual({
    text: '{"sentences":[]}',
    stop: "end",
    usage: { input: 120, output: 40, cacheRead: 900, cacheWrite: 0 },
  });
});

test("the stop reason is read before the content", async () => {
  const cases: [Anthropic.Message["stop_reason"], string][] = [
    ["refusal", "refusal"],
    ["max_tokens", "max_tokens"],
    ["pause_turn", "other"],
    ["tool_use", "other"],
    [null, "other"],
  ];
  for (const [stop_reason, stop] of cases) {
    const { client } = fake(async () => message({ stop_reason }));
    const r = await messagesModel(client).complete(call, new AbortController().signal);
    expect([stop_reason, r.stop, r.text]).toEqual([stop_reason, stop, ""]);
    expect(r.usage.input).toBe(120);
  }
});

test("a timeout is a ModelTimeoutError and every other error passes through", async () => {
  const timedOut = fake(async () => Promise.reject(new Anthropic.APIConnectionTimeoutError()));
  await expect(
    messagesModel(timedOut.client).complete(call, new AbortController().signal),
  ).rejects.toBeInstanceOf(ModelTimeoutError);

  const ac = new AbortController();
  ac.abort();
  const aborted = fake(async () => Promise.reject(new Anthropic.APIUserAbortError()));
  await expect(messagesModel(aborted.client).complete(call, ac.signal)).rejects.toBeInstanceOf(
    ModelTimeoutError,
  );
  const notOurs = fake(async () => Promise.reject(new Anthropic.APIUserAbortError()));
  await expect(
    messagesModel(notOurs.client).complete(call, new AbortController().signal),
  ).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);

  const limited = fake(async () =>
    Promise.reject(new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers())),
  );
  const err = await messagesModel(limited.client)
    .complete(call, new AbortController().signal)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Anthropic.RateLimitError);
  expect(err).not.toBeInstanceOf(ModelTimeoutError);
});

// --- the Redis store --------------------------------------------------------------

/** A Redis with just what the store uses, keeping each command. */
function fakeRedisStore(fail?: string) {
  const log: unknown[][] = [];
  const results: Record<string, unknown> = { incr: 3 };
  const multi = () => {
    const queued: string[] = [];
    const m = {
      incr: (...a: unknown[]) => (log.push(["incr", ...a]), queued.push("incr"), m),
      expire: (...a: unknown[]) => (log.push(["expire", ...a]), queued.push("expire"), m),
      hincrby: (...a: unknown[]) => (log.push(["hincrby", ...a]), queued.push("hincrby"), m),
      lpush: (...a: unknown[]) => (log.push(["lpush", ...a]), queued.push("lpush"), m),
      ltrim: (...a: unknown[]) => (log.push(["ltrim", ...a]), queued.push("ltrim"), m),
      exec: async () =>
        queued.map((c) => [c === fail ? new Error(`${c} failed`) : null, results[c] ?? 1]),
    };
    return m;
  };
  const redis = {
    get: async (k: string) => (log.push(["get", k]), "v"),
    set: async (...a: unknown[]) => (log.push(["set", ...a]), "OK"),
    hgetall: async (k: string) => (log.push(["hgetall", k]), { usd: "5" }),
    multi,
  };
  return { store: redisNarrationStore(redis as unknown as Redis), log };
}

test("the Redis store sets lifetimes, trims lists and fails fast", async () => {
  const { store, log } = fakeRedisStore();
  expect(await store.get("k")).toBe("v");
  await store.set("a", "1", null);
  await store.set("b", "2", 60);
  expect(await store.incr("c", 259_200)).toBe(3);
  await store.hincr("d", { usd: 5, "chronicle.calls": 1 }, 34_560_000);
  expect(await store.hgetall("d")).toEqual({ usd: "5" });
  await store.push("held", "{}", 500);
  expect(log).toEqual([
    ["get", "k"],
    ["set", "a", "1"],
    ["set", "b", "2", "EX", 60],
    ["incr", "c"],
    ["expire", "c", 259_200],
    ["hincrby", "d", "usd", 5],
    ["hincrby", "d", "chronicle.calls", 1],
    ["expire", "d", 34_560_000],
    ["hgetall", "d"],
    ["lpush", "held", "{}"],
    ["ltrim", "held", 0, 499],
  ]);
  await expect(fakeRedisStore("expire").store.incr("c", 1)).rejects.toThrow("expire failed");
  await expect(fakeRedisStore("hincrby").store.hincr("d", { a: 1 }, 1)).rejects.toThrow(
    "hincrby failed",
  );
});

// --- the scripts ------------------------------------------------------------------

test("the switch script reads its commands and shows every level", () => {
  expect(parseSwitch(["status"])).toEqual({ kind: "status" });
  expect(parseSwitch(["all", "off"])).toEqual({ kind: "set", field: "all", value: "off" });
  expect(parseSwitch(["use", "voice", "off"])).toEqual({
    kind: "set",
    field: "use:voice",
    value: "off",
  });
  expect(parseSwitch(["server", "123456789012345678", "on"])).toEqual({
    kind: "set",
    field: "server:123456789012345678",
    value: "on",
  });
  for (const bad of [[], ["all"], ["all", "maybe"], ["use", "x", "on"], ["server", "abc", "on"]])
    expect(typeof parseSwitch(bad)).toBe("string");
  const lines = statusLines({ all: "on", "use:voice": "off", "server:42": "on" });
  expect(lines).toContain("all: on");
  expect(lines).toContain("  voice: off");
  expect(lines).toContain("  recap: on (unset)");
  expect(lines).toContain("  42: on");
  expect(lines.filter((l) => /^ {2}[a-z]+: /.test(l))).toHaveLength(USES.length);
  expect(statusLines({})).toContain("  none on");
});

test("the ledger script reads a day or a range and prints micro-dollars as dollars", () => {
  expect(parseDays([])).toEqual({ days: "all" });
  expect(parseDays(["7"])).toEqual({ days: [7] });
  expect(parseDays(["3-5"])).toEqual({ days: [3, 4, 5] });
  for (const bad of [["5-3"], ["x"], ["1", "2"], ["0-999"]])
    expect(typeof parseDays(bad)).toBe("string");
  expect(dollars(1_234)).toBe("$0.001234");
  const l: DayLedger = {
    day: 7,
    usdMicros: 1_234,
    uses: {
      chronicle: {
        calls: 1,
        hits: 2,
        input: 1400,
        output: 300,
        cacheRead: 0,
        cacheWrite: 900,
        usdMicros: 1_234,
        fallbacks: { off: 3, check: 1 },
      },
    },
  };
  const lines = ledgerLines(l);
  expect(lines[0]).toBe("world day 7: $0.001234");
  expect(lines[2]).toMatch(
    /^chronicle\s+1\s+2\s+1400\s+300\s+0\s+900\s+\$0\.001234\s+check 1, off 3$/,
  );
  expect(ledgerLines({ day: 8, usdMicros: 0, uses: {} })).toEqual([
    "world day 8: $0.000000",
    "  nothing recorded",
  ]);
});

import { describe, expect, test } from "bun:test";

import type { Redis } from "ioredis";

import {
  cacheKey,
  type CitedSentence,
  type FallbackReason,
  memoryStore as narrationStore,
  type NarrationStore,
  Narrator,
  type StubMode,
  stubModel,
  type UseConfig,
  type UseId,
} from "../../../packages/mmo-narrate/src/index.ts";
import { chronicleUse } from "../../../packages/mmo-narrate/src/uses/chronicle.ts";
import * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { ChroniclePoster } from "../src/chronicle.ts";
import { EventsPoster, type EventsWorld } from "../src/events.ts";
import { answer } from "../src/flow.ts";
import { memoryStore } from "../src/forum.ts";
import type { ChannelSink } from "../src/hunts.ts";
import { Lexicon } from "../src/lexicon.ts";
import { createNarration, dayClock, type Narration, offNarration } from "../src/narration/index.ts";
import { chronicleInput, storyNarration } from "../src/narration/story.ts";
import { redisSwitch } from "../src/narration/switch.ts";
import { chronicleCard, eventCard } from "../src/screens/story.ts";
import { narrationMode, scriptedCtx } from "../src/scripted.ts";
import type { World } from "../src/world.ts";
import * as mm8 from "./fixtures/mm8.ts";
import * as mm9 from "./fixtures/mm9.ts";
import * as mm11 from "./fixtures/mm11-story.ts";
import samples from "./fixtures/world.json";

/**
 * Proofs that narration never changes what the game shows: the
 * chronicle posted from the same facts with the model off and on carries
 * the same lines and the same ids, and any narrated post that does not
 * come back checked is the template, to the byte.
 */

const lex = new Lexicon({
  ...(samples.lexicon as unknown as Omit<api.Lexicon, "numbers">),
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
const goods = lex.goodsNames();
const quiet = () => {};
const TODAY = 6;
const DAY = mm11.chronicle.day;
const SERVERS = ["g-1", "g-2"];

/** Every level of the switch on, as an operator sets them, read by the bot's own resolver. */
const allOn = redisSwitch(
  {
    hgetall: async () => ({
      all: "on",
      "use:chronicle": "on",
      "use:stage": "on",
      ...Object.fromEntries(SERVERS.map((s) => [`server:${s}`, "on"])),
    }),
  } as unknown as Pick<Redis, "hgetall">,
  true,
);

/** A store whose cache reads and writes fail while its ledger hash still answers. */
function brokenCache(): NarrationStore {
  const inner = narrationStore();
  const fail = async (): Promise<never> => {
    throw new Error("the cache is unreachable");
  };
  return { ...inner, get: fail, set: fail, incr: fail, push: fail, claim: fail };
}

/** A store where every call fails. */
function brokenStore(): NarrationStore {
  const fail = async (): Promise<never> => {
    throw new Error("the store is unreachable");
  };
  return { get: fail, set: fail, incr: fail, hincr: fail, hgetall: fail, push: fail, claim: fail };
}

function setup(
  opts: {
    mode?: StubMode;
    delayMs?: number;
    dayUsd?: number;
    store?: NarrationStore;
    config?: Partial<Record<UseId, Partial<UseConfig>>>;
  } = {},
) {
  const store = opts.store ?? narrationStore();
  const model = stubModel({ mode: opts.mode, delayMs: opts.delayMs });
  const narrator = new Narrator({
    model,
    store,
    switch: allOn,
    dayUsd: opts.dayUsd ?? 1,
    log: quiet,
    config: opts.config,
  });
  const narration = createNarration(storyNarration(narrator, lex, dayClock(TODAY)), quiet);
  return { store, model, narrator, narration };
}

function channel() {
  const posts: Card[] = [];
  const sink: ChannelSink = {
    post: async (c) => (posts.push(c), `msg-${posts.length}`),
    edit: async () => true,
  };
  return { sink, posts };
}

/** One server's chronicle poster over the fixture day, wired as index.ts wires it. */
function chroniclePoster(narration: Narration, server: string) {
  const { sink, posts } = channel();
  const poster = new ChroniclePoster(
    { chronicle: async () => mm11.chronicle },
    lex,
    memoryStore(),
    sink,
    server,
    undefined,
    quiet,
    (c) => narration.chronicle(c, server, "post", () => chronicleCard(c, lex, 0, true)),
  );
  return { poster, posts };
}

async function postChronicle(narration: Narration, server: string): Promise<Card> {
  const { poster, posts } = chroniclePoster(narration, server);
  expect(await poster.poll()).toBe(1);
  expect(posts).toHaveLength(1);
  return posts[0]!;
}

/** The fact ids of the "A line and what caused it" select. */
function causeIds(c: Card): string[] {
  for (const r of c.rows) {
    if ("select" in r && r.select.placeholder === "A line and what caused it")
      return r.select.options.map((o) => o.value);
  }
  return [];
}

/** The lines withProse moved into The record, as one text. */
const record = (c: Card) =>
  (c.fields ?? [])
    .filter((f) => f.name === "The record")
    .map((f) => f.value)
    .join("\n");

const fallbacks = async (n: Narrator, use: UseId, day: number) =>
  (await n.ledger(day)).uses[use]?.fallbacks ?? {};

/** Each way a narrated post fails, and the reason the ledger counts it under. */
const FAILURES: {
  label: string;
  reason: FallbackReason;
  /** Remembered under the fail key, so the same input never pays again. */
  remembered: boolean;
  opts: (use: UseId) => Parameters<typeof setup>[0];
  /** The ledger can still count: a store that fails whole loses its counts too. */
  counted?: boolean;
}[] = [
  ...(["number", "name", "uncited", "mention"] as const).map((mode) => ({
    label: mode,
    reason: "check" as const,
    remembered: true,
    opts: () => ({ mode }),
  })),
  { label: "refusal", reason: "refused", remembered: true, opts: () => ({ mode: "refusal" }) },
  {
    label: "truncated",
    reason: "truncated",
    remembered: true,
    opts: () => ({ mode: "truncated" }),
  },
  { label: "error", reason: "error", remembered: false, opts: () => ({ mode: "error" }) },
  {
    label: "slow, with a 1 ms timeout",
    reason: "timeout",
    remembered: false,
    opts: (use) => ({ mode: "slow", delayMs: 40, config: { [use]: { timeoutMs: 1 } } }),
  },
  { label: "budget 0", reason: "budget", remembered: false, opts: () => ({ dayUsd: 0 }) },
  {
    label: "a cache that throws",
    reason: "store",
    remembered: false,
    opts: () => ({ store: brokenCache() }),
  },
  {
    label: "a store that throws everywhere",
    reason: "store",
    remembered: false,
    counted: false,
    opts: () => ({ store: brokenStore() }),
  },
];

describe("chronicle on and off", () => {
  test("the same facts post the same lines and ids, off in the description, on in The record", async () => {
    const off = await postChronicle(offNarration, "g-1");
    expect(off).toEqual(chronicleCard(mm11.chronicle, lex, 0, true));

    const { narration, narrator, model, store } = setup();
    const on = await postChronicle(narration, "g-1");
    expect(model.calls).toHaveLength(1);

    for (const c of [off, on]) expect(problems(c, goods)).toEqual([]);
    expect(causeIds(off).length).toBeGreaterThan(0);
    expect(causeIds(on)).toEqual(causeIds(off));
    expect(record(on)).toBe(off.description!);
    expect(on.description).not.toBe(off.description);
    expect(on.rows).toEqual(off.rows);
    expect(on.footer).toBe(off.footer);

    // The posted prose is the checked reply the cache holds, and it passes the check again.
    const input = chronicleInput(mm11.chronicle, lex);
    const held = await store.get(cacheKey(chronicleUse, input, narrator.config("chronicle").model));
    expect(held).not.toBeNull();
    const reply = JSON.parse(held!) as { sentences: CitedSentence[] };
    const checked = chronicleUse.check(input, reply);
    expect(checked.ok).toBe(true);
    expect(reply.sentences.map((s) => s.text).join(" ")).toBe(on.description!);

    // A second server with the identical ordered day makes no call.
    const second = await postChronicle(narration, "g-2");
    expect(second).toEqual(on);
    expect(model.calls).toHaveLength(1);
    const ledger = await narrator.ledger(DAY);
    expect(ledger.uses.chronicle).toMatchObject({ calls: 1, hits: 1, fallbacks: {} });
    expect(ledger.usdMicros).toBeGreaterThan(0);
  });

  test("with every switch on but a server not opted in, the post is the off card", async () => {
    const off = await postChronicle(offNarration, "g-1");
    const { narration, narrator, model } = setup();
    expect(await postChronicle(narration, "g-3")).toEqual(off);
    expect(model.calls).toHaveLength(0);
    expect(await fallbacks(narrator, "chronicle", DAY)).toEqual({ off: 1 });
  });
});

// --- failures ----------------------------------------------------------------

/** A world serving one stage ending, and its causes on request. */
function eventsWorld(ev: api.StoryEvent, causes: api.FactCauses): EventsWorld {
  return {
    storyEvents: async (after) => ({
      events: ev.fact.id > after ? [ev] : [],
      last: Math.max(after, ev.fact.id),
    }),
    arcs: async () => ({ season: mm9.season, open: [], ended: [], backing: [] }),
    hunts: async () => ({ tick: 0, every: 1 }),
    chronicleFact: async () => ({ ok: true as const, reply: causes }),
  };
}

/** One server's events-channel post of the stage ending, through its poster. */
async function postStage(narration: Narration, server: string): Promise<Card> {
  const [, ev, causes] = mm11.told[0]!;
  const store = memoryStore();
  await store.set("mmo-bot:events:last", String(ev.fact.id - 1));
  const { sink, posts } = channel();
  await new EventsPoster(
    eventsWorld(ev, causes),
    lex,
    store,
    sink,
    undefined,
    undefined,
    quiet,
    (e, mode) => {
      const card = eventCard(e, lex);
      return card && narration.event(e, server, mode, () => card);
    },
  ).poll();
  expect(posts).toHaveLength(1);
  return posts[0]!;
}

const SURFACES: {
  name: string;
  use: UseId;
  day: number;
  post: (n: Narration, server: string) => Promise<Card>;
}[] = [
  { name: "the chronicle", use: "chronicle", day: DAY, post: postChronicle },
  { name: "a stage ending", use: "stage", day: TODAY, post: postStage },
];

describe("a failed check posts the template", () => {
  for (const s of SURFACES) {
    test(`${s.name}: every failure posts the off card and is counted`, async () => {
      const off = await s.post(offNarration, "g-1");
      expect(problems(off, goods)).toEqual([]);

      const good = setup();
      const on = await s.post(good.narration, "g-1");
      expect(on).not.toEqual(off);
      expect(record(on)).toBe(off.description!);

      for (const f of FAILURES) {
        const { narration, narrator, model } = setup(f.opts(s.use));
        expect(await s.post(narration, "g-1"), f.label).toEqual(off);
        if (f.counted !== false) {
          expect(await fallbacks(narrator, s.use, s.day), f.label).toEqual({ [f.reason]: 1 });
        }
        const before = model.calls.length;
        expect(await s.post(narration, "g-2"), f.label).toEqual(off);
        if (f.remembered) {
          // A repeat poll of a failed input pays nothing.
          expect(model.calls.length, f.label).toBe(before);
          expect(await fallbacks(narrator, s.use, s.day), f.label).toEqual({
            [f.reason]: 1,
            "failed-before": 1,
          });
        }
      }
    });
  }

  test("a model that never answers in time leaves no fail key: the next poll asks again", async () => {
    const store = narrationStore();
    const { narration, model } = setup({
      mode: "slow",
      delayMs: 40,
      store,
      config: { chronicle: { timeoutMs: 1 } },
    });
    await postChronicle(narration, "g-1");
    expect(store.keys().filter((k) => k.includes(":fail:"))).toEqual([]);
    await postChronicle(narration, "g-2");
    expect(model.calls).toHaveLength(2);
  });
});

// --- the scripted sitting's narration -----------------------------------------------

/** A world answering the hub from the recorded samples, with a return worth telling. */
function hubWorld(): World {
  const recorded = (samples["act:look"] as { reply: api.ActionReply }).reply;
  return {
    act: async () => ({ ok: true, reply: recorded }),
    player: async () => "c-1",
    options: async () => mm8.o,
    sheet: async () => samples.sheet as api.Sheet,
    here: async () => mm9.here,
    map: async () => samples.map as api.MapView,
    appraise: async () => ({ ok: true, reply: samples.appraise as api.Appraisal }),
    recipes: async () => samples.recipes as api.Recipes,
    recap: async () => mm11.recap(9),
    npc: async () => ({ ok: true, reply: samples.npc as api.Conversation }),
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
    chronicle: async () => ({ ok: true, reply: mm11.chronicle }),
    chronicleFact: async () => ({ ok: false, refusal: { code: api.CodeNotFound, message: "" } }),
    arcs: async () => ({ season: mm9.season, open: [], ended: [], backing: [] }),
    storyEvents: async () => ({ events: [], last: 0 }),
    storyPromotions: async () => ({ events: [], last: 0 }),
  };
}

describe("the scripted sitting's --narration", () => {
  test("reads off by default, stub when asked, and refuses anything else", () => {
    expect(narrationMode([])).toBe("off");
    expect(narrationMode(["--season", "--narration", "stub"])).toBe("stub");
    expect(narrationMode(["--narration=off"])).toBe("off");
    expect(narrationMode(["--narration", "on"])).toContain("usage");
    expect(narrationMode(["--narration"])).toContain("usage");
  });

  test("off is the plain Ctx; stub narrates the same press through the stub, and both cards pass", async () => {
    const base = { world: hubWorld(), lex, threatLine: 600 };
    const off = scriptedCtx(base, "off");
    expect(off.ctx).toBe(base);
    const stub = scriptedCtx(base, "stub", quiet);
    expect(stub.ctx.narrator).toBeInstanceOf(Narrator);

    const press = { command: "play", user: "u-1", guild: "scripted", interaction: "i-1" };
    const plain = (await answer(off.ctx, press)).card;
    const told = (await answer(stub.ctx, press)).card;
    expect(stub.narration.calls).toBe(1);
    expect(record(told)).toBe(plain.description!);
    for (const c of [plain, told]) expect(problems(c, goods)).toEqual([]);
    const [ledger] = await stub.narration.ledgers();
    expect(ledger?.uses.recap).toMatchObject({ calls: 1, fallbacks: {} });
  });
});

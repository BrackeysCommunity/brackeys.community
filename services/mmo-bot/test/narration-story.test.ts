import { expect, test } from "bun:test";

import {
  fixedSwitch,
  memoryStore as narrationStore,
  Narrator,
  type StubMode,
  stubModel,
  type UseConfig,
  type UseId,
} from "../../../packages/mmo-narrate/src/index.ts";
import { chronicleUse } from "../../../packages/mmo-narrate/src/uses/chronicle.ts";
import { recapUse } from "../../../packages/mmo-narrate/src/uses/recap.ts";
import { stageUse } from "../../../packages/mmo-narrate/src/uses/stage.ts";
import * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { ChroniclePoster } from "../src/chronicle.ts";
import { EventsPoster, type EventsWorld } from "../src/events.ts";
import { answer, type Ctx } from "../src/flow.ts";
import { memoryStore } from "../src/forum.ts";
import type { ChannelSink } from "../src/hunts.ts";
import { Lexicon } from "../src/lexicon.ts";
import { createNarration, dayClock, type Narration, offNarration } from "../src/narration/index.ts";
import {
  chronicleInput,
  recapInput,
  recapTold,
  stageInput,
  storyNarration,
} from "../src/narration/story.ts";
import { recapCard } from "../src/screens/hub.ts";
import { chronicleCard, eventCard } from "../src/screens/story.ts";
import type { World } from "../src/world.ts";
import * as mm8 from "./fixtures/mm8.ts";
import * as mm9 from "./fixtures/mm9.ts";
import * as mm11 from "./fixtures/mm11-story.ts";
import samples from "./fixtures/world.json";

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
  },
});
const goods = lex.goodsNames();
const quiet = () => {};
const TODAY = 6;

function setup(
  opts: {
    mode?: StubMode;
    delayMs?: number;
    on?: boolean;
    config?: Partial<Record<UseId, Partial<UseConfig>>>;
  } = {},
) {
  const store = narrationStore();
  const model = stubModel({ mode: opts.mode, delayMs: opts.delayMs });
  const narrator = new Narrator({
    model,
    store,
    switch: fixedSwitch(opts.on ?? true),
    dayUsd: 1,
    log: quiet,
    config: opts.config,
  });
  const narration = createNarration(storyNarration(narrator, lex, dayClock(TODAY)), quiet);
  return { store, model, narrator, narration };
}

/** The lines withProse moved into The record, as one text. */
const record = (c: Card) =>
  (c.fields ?? [])
    .filter((f) => f.name === "The record")
    .map((f) => f.value)
    .join("\n");

/** What a narrated card keeps of its template: everything but the description and the record. */
const kept = (c: Card) => ({
  ...c,
  description: undefined,
  fields: (c.fields ?? []).filter((f) => f.name !== "The record"),
});

function channel() {
  const posts: Card[] = [];
  const sink: ChannelSink = {
    post: async (c) => (posts.push(c), `msg-${posts.length}`),
    edit: async () => true,
  };
  return { sink, posts };
}

/** The chronicle channel's post of a day for one server, through its poster. */
async function posted(narration: Narration, server: string, ch = mm11.chronicle): Promise<Card> {
  const { sink, posts } = channel();
  const poster = new ChroniclePoster(
    { chronicle: async () => ch },
    lex,
    memoryStore(),
    sink,
    server,
    undefined,
    quiet,
    (c) => narration.chronicle(c, server, "post", () => chronicleCard(c, lex, 0, true)),
  );
  expect(await poster.poll()).toBe(1);
  return posts[0]!;
}

/** Re-checks a narrated description as the use's check would read it. */
function checks<I>(
  spec: { check(i: I, r: unknown): { ok: boolean } },
  input: I,
  sentences: unknown,
): boolean {
  return spec.check(input, { sentences }).ok;
}

// --- the chronicle ----------------------------------------------------------------

test("the chronicle posts the same lines off and on: the description off, The record on", async () => {
  const off = await posted(offNarration, "g-1");
  expect(off).toEqual(chronicleCard(mm11.chronicle, lex, 0, true));
  // The template reads the names the world sent with the lines.
  expect(off.description).toContain(`${mm9.here.name} lost to the raid.`);
  expect(off.description).toContain("Order of the Dust and the Salt Eaters");

  const { narration, narrator, model } = setup();
  const on = await posted(narration, "g-1");
  expect(model.calls).toHaveLength(1);
  expect(on.description).not.toBe(off.description);
  expect(record(on)).toBe(off.description!);
  expect(kept(on)).toEqual(kept(off));
  expect(on.rows).toEqual(off.rows);

  const input = chronicleInput(mm11.chronicle, lex);
  const again = await narrator.narrate(chronicleUse, input, { day: mm11.chronicle.day });
  expect(again).toMatchObject({ ok: true, from: "cache" });
  if (!again.ok) throw new Error("not narrated");
  expect(again.value.map((s) => s.text).join(" ")).toBe(on.description!);
  expect(checks(chronicleUse, input, again.value)).toBe(true);
  // More lines than sentences: some sentences tell several facts.
  expect(again.value.length).toBeLessThan(input.facts.length + 1);
  expect(new Set(again.value.flatMap((s) => s.facts))).toEqual(
    new Set(input.facts.map((f) => f.n)),
  );

  for (const c of [off, on]) expect(problems(c, goods)).toEqual([]);
});

test("the chronicle's prompt lines are the card's lines, here flags and all", () => {
  const input = chronicleInput(mm11.chronicle, lex);
  const card = chronicleCard(mm11.chronicle, lex, 0, true);
  const shown = card.description!.split("\n").filter((l) => !l.startsWith("…"));
  expect(input.facts.map((f) => `${f.here ? "▸" : "•"} ${f.line}`)).toEqual(shown);
  expect(input.facts.map((f) => f.id)).toEqual(mm11.chronicle.lines.map((l) => l.fact.id));
  expect(input.names).toEqual(mm11.names);
  expect(input.more).toBe(mm11.chronicle.more);
  expect(input.season).toBe(mm11.chronicle.season.band);
});

test("servers with the same ordered day share one call; a server reading it otherwise pays its own", async () => {
  const { narration, narrator, model } = setup();
  const first = await posted(narration, "g-1");
  const second = await posted(narration, "g-2");
  expect(second).toEqual(first);
  expect(model.calls).toHaveLength(1);
  const ledger = await narrator.ledger(mm11.chronicle.day);
  expect(ledger.uses.chronicle).toMatchObject({ calls: 1, hits: 1 });

  const other = await posted(narration, "g-3", mm11.elsewhere);
  expect(model.calls).toHaveLength(2);
  expect(record(other)).toBe(chronicleCard(mm11.elsewhere, lex, 0, true).description!);
  expect(record(other)).not.toBe(record(first));
});

test("a cached read never calls the model: the template before the post, the post's prose after", async () => {
  const { narration, model } = setup();
  const template = () => chronicleCard(mm11.chronicle, lex, 4, false);
  expect(await narration.chronicle(mm11.chronicle, "g-1", "cached", template)).toEqual(template());
  expect(model.calls).toHaveLength(0);
  const post = await posted(narration, "g-1");
  const read = await narration.chronicle(mm11.chronicle, "g-2", "cached", template);
  expect(model.calls).toHaveLength(1);
  expect(read.description).toBe(post.description);
  expect(record(read)).toBe(template().description!);
  expect(problems(read, goods)).toEqual([]);
});

test("a chronicle the check refuses, or the switch keeps off, posts the template", async () => {
  const off = await posted(offNarration, "g-1");
  const modes: [StubMode, string][] = [
    ["number", "check"],
    ["name", "check"],
    ["uncited", "check"],
    ["mention", "check"],
    ["refusal", "refused"],
    ["truncated", "truncated"],
    ["error", "error"],
  ];
  for (const [mode, reason] of modes) {
    const { narration, narrator } = setup({ mode });
    expect(await posted(narration, "g-1")).toEqual(off);
    const ledger = await narrator.ledger(mm11.chronicle.day);
    expect(ledger.uses.chronicle?.fallbacks).toEqual({ [reason]: 1 });
  }
  // A failed check is remembered: the same day polled again costs no call.
  const failed = setup({ mode: "number" });
  await posted(failed.narration, "g-1");
  expect(await posted(failed.narration, "g-2")).toEqual(off);
  expect(failed.model.calls).toHaveLength(1);
  expect((await failed.narrator.ledger(mm11.chronicle.day)).uses.chronicle?.fallbacks).toEqual({
    check: 1,
    "failed-before": 1,
  });
  const slow = setup({ mode: "slow", delayMs: 40, config: { chronicle: { timeoutMs: 1 } } });
  expect(await posted(slow.narration, "g-1")).toEqual(off);
  expect((await slow.narrator.ledger(mm11.chronicle.day)).uses.chronicle?.fallbacks).toEqual({
    timeout: 1,
  });
  const shut = setup({ on: false });
  expect(await posted(shut.narration, "g-1")).toEqual(off);
  expect(shut.model.calls).toHaveLength(0);
  expect((await shut.narrator.ledger(mm11.chronicle.day)).uses.chronicle?.fallbacks).toEqual({
    off: 1,
  });
  // A day that has not closed, or one with no lines, is never narrated.
  const quietDay = { ...mm11.chronicle, lines: [], more: 0 };
  const { narration, model } = setup();
  await narration.chronicle(mm9.unwritten, "g-1", "post", () =>
    chronicleCard(mm9.unwritten, lex, 0, true),
  );
  await narration.chronicle(quietDay, "g-1", "post", () => chronicleCard(quietDay, lex, 0, true));
  expect(model.calls).toHaveLength(0);
});

// --- the events channel ----------------------------------------------------------------

/** A world serving one event, its causes on request. */
function eventsWorld(ev: api.StoryEvent, causes?: api.FactCauses | "refused"): EventsWorld {
  return {
    storyEvents: async (after) => ({
      events: ev.fact.id > after ? [ev] : [],
      last: Math.max(after, ev.fact.id),
    }),
    arcs: async () => ({ season: mm9.season, open: [], ended: [], backing: [] }),
    hunts: async () => ({ tick: 0, every: 1 }),
    ...(causes === undefined
      ? {}
      : {
          chronicleFact: async (character: string | undefined, id: number) => {
            expect(character).toBeUndefined();
            expect(id).toBe(ev.fact.id);
            return causes === "refused"
              ? { ok: false as const, refusal: { code: api.CodeNotFound, message: "" } }
              : { ok: true as const, reply: causes };
          },
        }),
  };
}

/** The events channel's post of one event, through its poster, as index.ts wires it. */
async function postEvent(
  narration: Narration,
  ev: api.StoryEvent,
  causes?: api.FactCauses | "refused",
): Promise<Card | undefined> {
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
      return card && narration.event(e, "g-1", mode, () => card);
    },
  ).poll();
  return posts[0];
}

test("each ending is told with its heaviest cause: off and good share the lines, a number gives the template", async () => {
  for (const [label, ev, causes] of mm11.told) {
    const off = (await postEvent(offNarration, ev, causes))!;
    expect(off, label).toEqual(eventCard(ev, lex)!);

    const good = setup();
    const on = (await postEvent(good.narration, ev, causes))!;
    expect(good.model.calls, label).toHaveLength(1);
    const input = stageInput({ ...ev, causes }, lex);
    expect(
      input.facts.map((f) => f.id),
      label,
    ).toEqual([ev.fact.id, mm9.raidCast.id]);
    expect(good.model.calls[0]!.user, label).toContain(input.facts[1]!.line);
    expect(on.description, label).not.toBe(off.description);
    expect(record(on), label).toBe(off.description!);
    expect(kept(on), label).toEqual(kept(off));
    const hit = await good.narrator.narrate(stageUse, input, { day: TODAY });
    expect(hit.ok && checks(stageUse, input, hit.value), label).toBe(true);

    const bad = setup({ mode: "number" });
    expect(await postEvent(bad.narration, ev, causes), label).toEqual(off);
    expect((await bad.narrator.ledger(TODAY)).uses.stage?.fallbacks, label).toEqual({ check: 1 });

    for (const c of [off, on]) expect(problems(c, goods), label).toEqual([]);
  }
});

test("an ending whose causes cannot be read is told alone", async () => {
  const [, ev] = mm11.told[0]!;
  for (const causes of [undefined, "refused" as const]) {
    const { narration, model } = setup();
    const on = (await postEvent(narration, ev, causes))!;
    expect(model.calls).toHaveLength(1);
    expect(stageInput(ev, lex).facts).toHaveLength(1);
    expect(record(on)).toBe(eventCard(ev, lex)!.description!);
  }
});

test("the stage's live edit reads the cache and never calls the model", async () => {
  const [, ev, causes] = mm11.told[0]!;
  const { narration, model } = setup();
  const told = { ...ev, causes };
  const template = () => eventCard(ev, lex)!;
  expect(await narration.event(told, "g-1", "cached", template)).toEqual(template());
  expect(model.calls).toHaveLength(0);
  const post = await narration.event(told, "g-1", "post", template);
  const edit = await narration.event(told, "g-1", "cached", template);
  expect(model.calls).toHaveLength(1);
  expect(edit).toEqual(post);
});

test("events that are not endings show their templates, MM10's roads and caravans among them", async () => {
  for (const [label, ev] of mm11.untold) {
    const { narration, model } = setup();
    const card = await postEvent(narration, ev, { fact: ev.fact, causes: [mm9.raidCast] });
    expect(card, label).toEqual(eventCard(ev, lex)!);
    expect(model.calls, label).toHaveLength(0);
    expect(problems(card!, goods), label).toEqual([]);
  }
});

// --- since you left ----------------------------------------------------------------

const recapOf = (r: api.Recap) => recapCard(mm9.o, mm9.here, r, lex, peopleOf());
const peopleOf = () => new Map(mm9.here.people.map((p) => [p.id, p.name]));

function recapNarrated(narration: Narration, r: api.Recap, user = "u-1") {
  return narration.recap(r, user, "g-1", () => recapOf(r));
}

test("since you left is narrated only after six hours away, with its fields and naming kept", async () => {
  const { narration, model } = setup();
  const short = mm11.recap(5);
  expect(recapTold(short)).toBe(false);
  expect(await recapNarrated(narration, short)).toEqual(recapOf(short));
  expect(model.calls).toHaveLength(0);

  const named = mm11.recap(6, [
    { ...mm9.recap.lines[0]!, promotion: "road:1" },
    ...mm9.recap.lines.slice(1),
  ]);
  expect(recapTold(named)).toBe(true);
  const off = recapOf(named);
  const on = await recapNarrated(narration, named);
  expect(model.calls).toHaveLength(1);
  expect(record(on)).toBe(off.description!);
  expect(record(on)).toContain(`${mm9.here.people[0]!.name} wants a word with you.`);
  expect(record(on)).toContain(`${mm9.here.name} lost to the raid.`);
  expect(kept(on)).toEqual(kept(off));
  expect(on.fields!.map((f) => f.name)).toContain("Away for");
  expect(on.fields!.map((f) => f.name)).toContain("Yours to name");
  expect(on.rows).toEqual(off.rows);
  const input = recapInput(named, lex);
  // A wish for a word stays on the card alone.
  expect(input.facts.map((f) => f.kind)).toEqual(["arc.ended", "trouble.lost"]);
  const hit = await setup().narrator.narrate(recapUse, input, { day: TODAY, player: "u-1" });
  expect(hit.ok && checks(recapUse, input, hit.value)).toBe(true);
  for (const c of [off, on, recapOf(short)]) expect(problems(c, goods)).toEqual([]);
});

test("a recap with only a wish for a word is never narrated", async () => {
  const { narration, model } = setup();
  const r = mm11.recap(9, []);
  expect(recapTold(r)).toBe(false);
  expect(await recapNarrated(narration, r)).toEqual(recapOf(r));
  expect(model.calls).toHaveLength(0);
});

test("a player's recap is narrated once a world day: the next return that day is the template", async () => {
  const { narration, narrator, model } = setup();
  const first = mm11.recap(7);
  const told = await recapNarrated(narration, first);
  expect(record(told)).toBe(recapOf(first).description!);
  const second = mm11.recap(8, [...mm9.recap.lines, ...mm11.later]);
  expect(await recapNarrated(narration, second)).toEqual(recapOf(second));
  expect(model.calls).toHaveLength(1);
  expect((await narrator.ledger(TODAY)).uses.recap?.fallbacks).toEqual({ cap: 1 });
  // The same return again is a cache hit, which spends no cap.
  expect(await recapNarrated(narration, first)).toEqual(told);
  // Another player has their own.
  expect(record(await recapNarrated(narration, second, "u-2"))).toBe(recapOf(second).description!);
  expect(model.calls).toHaveLength(2);
});

test("a slow recap shows the template, and the next view is the cached prose", async () => {
  const { narration, narrator, model } = setup({
    mode: "slow",
    delayMs: 40,
    config: { recap: { waitMs: 5 } },
  });
  const r = mm11.recap(6);
  expect(await recapNarrated(narration, r)).toEqual(recapOf(r));
  await narrator.drain();
  const next = await recapNarrated(narration, r);
  expect(record(next)).toBe(recapOf(r).description!);
  expect(next.description).not.toBe(recapOf(r).description);
  expect(model.calls).toHaveLength(1);
  const ledger = await narrator.ledger(TODAY);
  expect(ledger.uses.recap).toMatchObject({ calls: 1, hits: 1, fallbacks: { timeout: 1 } });
});

// --- the flow -----------------------------------------------------------------

function world(): World {
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

test("in the flow, the hub's recap is narrated and /chronicle serves the posted prose with no call", async () => {
  const { narration, model } = setup();
  const press = (p: object) => ({ ...p, user: "u-1", guild: "g-1", interaction: "i-1" });
  const plainCtx: Ctx = { world: world(), lex, threatLine: 600 };
  const ctx: Ctx = { ...plainCtx, narration, narrator: null };
  const plain = {
    play: (await answer(plainCtx, press({ command: "play" }))).card,
    chronicle: (await answer(plainCtx, press({ command: "chronicle" }))).card,
  };
  const play = (await answer(ctx, press({ command: "play" }))).card;
  expect(model.calls.map((c) => c.use)).toEqual(["recap"]);
  expect(record(play)).toBe(plain.play.description!);

  // Before the day is posted, /chronicle is its template.
  expect((await answer(ctx, press({ command: "chronicle" }))).card).toEqual(plain.chronicle);
  const post = await posted(narration, "g-1");
  const read = (await answer(ctx, press({ command: "chronicle" }))).card;
  expect(model.calls.map((c) => c.use)).toEqual(["recap", "chronicle"]);
  expect(read.description).toBe(post.description);
  expect(record(read)).toBe(plain.chronicle.description!);
  expect(read.rows).toEqual(plain.chronicle.rows);
  for (const c of [play, read, plain.play, plain.chronicle]) expect(problems(c, goods)).toEqual([]);
});

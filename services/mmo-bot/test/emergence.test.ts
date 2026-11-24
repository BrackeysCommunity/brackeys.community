import { expect, test } from "bun:test";

import * as api from "../src/api.ts";
import { bareNumbers, type Card, COLOUR, problems } from "../src/card.ts";
import { answer, type Ctx, modalFor } from "../src/flow.ts";
import { memoryStore } from "../src/forum.ts";
import type { ChannelSink } from "../src/hunts.ts";
import { decodeId, encodeId, type Id } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { PromotionsPoster, type PromotionsWorld } from "../src/promotions.ts";
import { LexiconRefresher } from "../src/refresh.ts";
import { NAME_INPUT, promotionCard } from "../src/screens/emergence.ts";
import { recapCard } from "../src/screens/hub.ts";
import { eventCard, stageCard } from "../src/screens/story.ts";
import type { World } from "../src/world.ts";
import * as mm9 from "./fixtures/mm9.ts";
import * as mm10 from "./fixtures/mm10.ts";
import samples from "./fixtures/world.json";

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
/** The lexicon as the world served it before play found anything. */
const before = (): api.Lexicon => ({
  ...(samples.lexicon as unknown as Omit<api.Lexicon, "numbers">),
  starts: ["hook", "knife", "deck"],
  numbers: NUMBERS,
});
/** The lexicon once the world names what play found. */
const after = (): api.Lexicon => mm10.lexicon(before());
const quiet = () => {};

/** A world whose promotions are what a test sets, two to a page. */
function stubWorld(state: { events: api.StoryEvent[]; hidden?: number }) {
  const reads: number[] = [];
  const world: PromotionsWorld = {
    async storyPromotions(after) {
      reads.push(after);
      const events = state.events.filter((e) => e.fact.id > after).slice(0, 2);
      const last = Math.max(after, state.hidden ?? 0, ...events.map((e) => e.fact.id));
      return { events, last: events.length ? events.at(-1)!.fact.id : last };
    },
  };
  return { world, reads };
}

function memoryChannel() {
  const posts: Card[] = [];
  const sink: ChannelSink = {
    post: async (c) => (posts.push(c), `msg-${posts.length}`),
    edit: async () => true,
  };
  return { sink, posts };
}

const titled = (ev: api.StoryEvent): Card => ({
  context: "Chronicle channel · everyone in the server can see this",
  author: "Promotion",
  title: `${ev.fact.kind} ${ev.fact.id}`,
  picture: "form",
  footer: "The world keeps it.",
  rows: [],
  colour: COLOUR.signal,
});

const events = mm10.promotions.map(([, ev]) => ev);

test("a channel new to the poster starts at the present and posts none of the past", async () => {
  const store = memoryStore();
  const { sink, posts } = memoryChannel();
  const { world } = stubWorld({ events, hidden: 1400 });
  const poster = new PromotionsPoster(
    world,
    new Lexicon(before()),
    store,
    sink,
    undefined,
    undefined,
    quiet,
    titled,
  );
  expect(await poster.poll()).toBe(0);
  expect(await store.get("mmo-bot:promotions:last")).toBe("1400");
  expect(await poster.poll()).toBe(0);
  expect(posts).toEqual([]);
});

test("each promotion is posted once in the world's order, and a restart posts none of them twice", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:promotions:last", "1000");
  const state = { events, hidden: 0 };
  const { world } = stubWorld(state);
  const { sink, posts } = memoryChannel();
  let refreshed = 0;
  const refresh = async () => void refreshed++;
  const poster = new PromotionsPoster(
    world,
    new Lexicon(before()),
    store,
    sink,
    refresh,
    undefined,
    quiet,
    titled,
  );
  expect(await poster.poll()).toBe(events.length);
  expect(posts.map((p) => p.title)).toEqual(events.map((e) => `${e.fact.kind} ${e.fact.id}`));
  expect(refreshed).toBe(events.length);
  expect(await store.get("mmo-bot:promotions:last")).toBe(String(events.at(-1)!.fact.id));
  const again = new PromotionsPoster(
    world,
    new Lexicon(before()),
    store,
    sink,
    refresh,
    undefined,
    quiet,
    titled,
  );
  expect(await again.poll()).toBe(0);
  // Facts the channel does not show still move the mark on.
  state.hidden = 1500;
  await again.poll();
  expect(await store.get("mmo-bot:promotions:last")).toBe("1500");
  expect(posts).toHaveLength(events.length);
  // Its mark is its own: the events channel's is untouched.
  expect(await store.get("mmo-bot:events:last")).toBeNull();
});

test("a post that fails is posted on the next poll, and the promotions after it wait for it", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:promotions:last", "1000");
  const { world } = stubWorld({ events: events.slice(0, 3) });
  let fail = true;
  const posted: string[] = [];
  const sink: ChannelSink = {
    async post(card) {
      if (fail) throw new Error("Discord said no");
      posted.push(card.title);
      return "m";
    },
    edit: async () => true,
  };
  const poster = new PromotionsPoster(
    world,
    new Lexicon(before()),
    store,
    sink,
    undefined,
    undefined,
    quiet,
    titled,
  );
  await expect(poster.poll()).rejects.toThrow("Discord said no");
  expect(await store.get("mmo-bot:promotions:last")).toBe("1000");
  fail = false;
  expect(await poster.poll()).toBe(3);
  expect(posted).toEqual(["promotion 1001", "promotion 1002", "promotion 1003"]);
});

test("a kind the channel has no card for moves the mark on and posts nothing", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:promotions:last", "0");
  const odd: api.StoryEvent = {
    fact: { id: 5, tick: 1, kind: "promotion.unheard-of", subjects: [], data: [], weight: 70 },
  };
  const { world } = stubWorld({ events: [odd] });
  const { sink, posts } = memoryChannel();
  const lex = new Lexicon(before());
  expect(
    await new PromotionsPoster(world, lex, store, sink, undefined, undefined, quiet).poll(),
  ).toBe(0);
  expect(posts).toEqual([]);
  expect(await store.get("mmo-bot:promotions:last")).toBe("5");
});

test("after a promotion is posted the lexicon is read again, so the card standard knows a found material's name", async () => {
  const lex = new Lexicon(before());
  const text = "Sold 3 plated eel-hide";
  expect(bareNumbers(text, lex.goodsNames())).toEqual(["3"]);
  expect(lex.material(mm10.material.of!)).not.toBe("Plated eel-hide");
  const refresher = new LexiconRefresher(lex, async () => after(), quiet);
  const store = memoryStore();
  await store.set("mmo-bot:promotions:last", "1008");
  const { world } = stubWorld({ events });
  const { sink, posts } = memoryChannel();
  const poster = new PromotionsPoster(
    world,
    lex,
    store,
    sink,
    () => refresher.refresh(),
    undefined,
    quiet,
  );
  expect(await poster.poll()).toBeGreaterThan(0);
  expect(posts[0]!.title).toBe("A new material: Plated eel-hide");
  expect(lex.material(mm10.material.of!)).toBe("Plated eel-hide");
  expect(bareNumbers(text, lex.goodsNames())).toEqual([]);
  for (const c of posts) expect(problems(c, lex.goodsNames())).toEqual([]);
});

test("a failed lexicon read keeps the names it had, and reads under way are shared", async () => {
  const lex = new Lexicon(after());
  let reads = 0;
  let fail = false;
  const lines: string[] = [];
  const refresher = new LexiconRefresher(
    lex,
    async () => {
      reads++;
      if (fail) throw new Error("world down");
      return before();
    },
    (l) => lines.push(l),
  );
  fail = true;
  await refresher.refresh();
  expect(lex.material(mm10.material.of!)).toBe("Plated eel-hide");
  expect(lines).toEqual(["[lexicon] Error: world down"]);
  fail = false;
  await Promise.all([refresher.refresh(), refresher.refresh()]);
  expect(reads).toBe(2);
});

test("every promotion and event card the fixture holds keeps the card standard, and names no character", () => {
  const lex = new Lexicon(after());
  const names = lex.goodsNames();
  const all: [string, Card | null][] = [
    ...mm10.promotions.map(([n, ev]): [string, Card | null] => [n, promotionCard(ev, lex)]),
    ...[...mm10.events, ...mm10.casts].map(([n, ev]): [string, Card | null] => [
      n,
      eventCard(ev, lex),
    ]),
    ["a season's close", eventCard(mm10.seasonClosed, lex)],
  ];
  for (const [name, card] of all) {
    expect(card, name).not.toBeNull();
    expect(problems(card!, names), name).toEqual([]);
    const text = JSON.stringify(card);
    for (const who of ["c-1", "c-2", "character:"]) expect(text, name).not.toContain(who);
  }
});

test("the cards say what each promotion made: the variant names its material, the rival claims its two goals", () => {
  const lex = new Lexicon(after());
  const card = (name: string) => {
    const ev = mm10.promotions.find(([n]) => n === name)![1];
    return promotionCard(ev, lex)!;
  };
  const field = (c: Card, n: string) => c.fields?.find((f) => f.name === n)?.value;
  expect(card("a road forms").title).toBe("A road forms: the Pylon Camp way");
  expect(card("a road a solved pattern laid").description).toContain("solved pattern");
  expect(field(card("a variant"), "Drops")).toBe("Plated eel-hide");
  expect(field(card("a variant"), "Resists")).toBe("Keen");
  expect(field(card("a variant whose material nobody has looted"), "Drops")).toBe(
    "A new material made of hide scraps",
  );
  expect(card("a style").title).toBe("A style is named: Edge-and-ember");
  expect(card("a material").description).toContain("treated hide");
  expect(card("a bounty becomes a legend").author).toContain("A bounty becomes a legend");
  expect(card("an item becomes a legend").author).toContain("An item becomes a legend");
  expect(card("a custom").description).toContain("Pylon Camp");
  expect(card("a custom").description).toContain("three seasons running");
  expect(card("a found class").title).toBe("A class is found: Router");
  expect(card("the masters").description).toContain("rewire");
  expect(card("what a season added").description).toContain("1 style, 2 variants and 2 materials");
  const rival = stageCard(mm9.withSides, mm9.here, mm10.rivalClaims, lex);
  expect(rival.description).toContain("two goals");
  // A side the world sent by its row id alone is named by its seat.
  const raw = {
    ...mm10.rivalClaims,
    sides: mm10.rivalClaims.sides.map((x) => ({ ...x, title: x.id })),
  };
  expect(stageCard(mm9.withSides, mm9.here, raw, lex).fields?.map((f) => f.name)).toContain(
    `Back ${mm9.here.name}'s claim`,
  );
  const posted = eventCard(mm10.casts[0]![1], lex)!;
  expect(posted.description).toContain("two goals");
  const tolled = eventCard(mm10.events[1]![1], lex)!;
  expect(tolled.title).toBe("The Pylon Camp way is tolled");
  expect(field(tolled, "Toll")).toBe("2 coin a crossing");
  const closed = eventCard(mm10.seasonClosed, lex)!;
  const leaves = closed.fields?.find((f) => f.name === "What the season leaves")?.value ?? "";
  for (const part of ["Kept:", "Faded:", "Added:"]) expect(leaves).toContain(part);
});

/** A world that answers a rename as a test says, and remembers every write. */
function renameWorld(refusal?: api.Refusal) {
  const writes: api.ActionRequest[] = [];
  const o = samples.options as api.Options;
  const world = {
    player: async () => "c-1",
    options: async () => o,
    here: async () => samples.here as api.Here,
    recap: async () => mm10.recap,
    async act(req: api.ActionRequest) {
      writes.push(req);
      if (refusal) return { ok: false as const, refusal };
      return { ok: true as const, reply: samples["act:look"].reply as unknown as api.ActionReply };
    },
  } as unknown as World;
  const ctx: Ctx = { world, lex: new Lexicon(after()), threatLine: 600 };
  const press = (id: Id, fields?: Record<string, string>) =>
    answer(ctx, { id, fields, user: "someone", guild: "guild", interaction: "event" });
  return { writes, press };
}

test("the recap line its first may name carries Name it, which opens the naming card", () => {
  const lex = new Lexicon(after());
  const o = samples.options as api.Options;
  const card = recapCard(o, mm9.here, mm10.recap, lex, new Map());
  const buttons = card.rows.flatMap((r) => ("buttons" in r ? r.buttons : []));
  const named = buttons
    .filter((b) => b.kind === "page")
    .map((b) => decodeId(b.customId))
    .filter((x) => x?.action === "pr-name");
  expect(named).toEqual([{ action: "pr-name", target: mm10.style.id, version: o.version }]);
  expect(buttons[0]!.label).toBe("Name it: Edge-and-ember");
  // Its press shows the naming card; the own-name modal opens from there.
  expect(modalFor(named[0]!)).toBeNull();
  // A line nobody may name carries no button.
  expect(
    recapCard(o, mm9.here, mm9.recap, lex, new Map()).rows.flatMap((r) =>
      "buttons" in r ? r.buttons : [],
    ),
  ).toHaveLength(1);
});

test("a rename's submit sends promote-name with the name, and the recap says it was named", async () => {
  const { writes, press } = renameWorld();
  const id = decodeId(encodeId("pr-named", mm10.style.id, 17))!;
  const done = await press(id, { [NAME_INPUT]: "  Ember-edge " });
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 17,
      kind: api.ActPromoteName,
      server: "guild",
      option: mm10.style.id,
      note: "Ember-edge",
    },
  ]);
  expect(done.card.title).toBe("Named: Ember-edge");
  expect(done.card.author).toContain("since you left");
});

test("a rename the world refuses shows why on the recap, and an empty name writes nothing", async () => {
  const id = decodeId(encodeId("pr-named", mm10.style.id, 17))!;
  for (const [code, refusal] of mm10.renameRefusals) {
    const { writes, press } = renameWorld(refusal);
    const card = (await press(id, { [NAME_INPUT]: "Ember-edge" })).card;
    expect(writes, code).toHaveLength(1);
    expect(card.title, code).toBe(
      refusal.message.charAt(0).toUpperCase() + refusal.message.slice(1),
    );
    expect(problems(card, new Lexicon(after()).goodsNames()), code).toEqual([]);
  }
  const { writes, press } = renameWorld();
  const blank = await press(id, { [NAME_INPUT]: "   " });
  expect(writes).toEqual([]);
  expect(blank.card.title).toBe("Give it a name: a few words the board takes");
  // A stale card is drawn again as it stands.
  const stale = renameWorld({ code: api.CodeStale, message: "stale version" });
  expect((await stale.press(id, { [NAME_INPUT]: "Ember-edge" })).card.title).toBe(
    "The world moved on: here is the card as it stands.",
  );
});

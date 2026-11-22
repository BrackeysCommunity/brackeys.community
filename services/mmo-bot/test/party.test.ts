import { expect, mock, test } from "bun:test";

import { type Interaction, MessageFlags, SnowflakeUtil } from "discord.js";

import { createHandler } from "../src/adapter.ts";
import * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { localBudget } from "../src/cooldown.ts";
import { answer, type Ctx, modalFor } from "../src/flow.ts";
import { memoryStore } from "../src/forum.ts";
import { HuntPoster, type ChannelSink } from "../src/hunts.ts";
import { decodeId, encodeId, type Id } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { type PartyNote, PartyPoster, shownOf, type ThreadSink } from "../src/party.ts";
import { ThreadBudget, THREADS_PER_WINDOW } from "../src/publish.ts";
import { THREAD } from "../src/screens/party.ts";
import type { PartyRead, World } from "../src/world.ts";
import * as mm8 from "./fixtures/mm8.ts";
import samples from "./fixtures/world.json";

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
  },
});
const names = lex.goodsNames();

/** A world whose reads are what a test sets, and whose writes it keeps. */
function fakeWorld(state: {
  options?: api.Options;
  here?: api.Here;
  party?: PartyRead;
  parties?: api.Parties;
  hunts?: api.HuntBoard;
  reply?: (req: api.ActionRequest) => api.ActionReply | api.Refusal;
}) {
  const writes: api.ActionRequest[] = [];
  const recorded = (samples["act:look"] as { reply: api.ActionReply }).reply;
  const world: World = {
    act: async (req) => {
      writes.push(req);
      const r = state.reply?.(req) ?? recorded;
      return "code" in r ? { ok: false, refusal: r } : { ok: true, reply: r };
    },
    player: async () => "c-1",
    options: async () => state.options ?? mm8.o,
    sheet: async () => samples.sheet as api.Sheet,
    here: async () => state.here ?? mm8.here,
    map: async () => samples.map as api.MapView,
    appraise: async () => ({ ok: true, reply: samples.appraise as api.Appraisal }),
    recipes: async () => samples.recipes as api.Recipes,
    recap: async () => samples.recap as api.Recap,
    npc: async () => ({ ok: true, reply: samples.npc as api.Conversation }),
    lexicon: async () => samples.lexicon as api.Lexicon,
    media: async () => new Uint8Array([1]),
    market: async () => ({ ok: true, reply: samples.market as api.Market }),
    history: async () => ({ ok: true, reply: samples.history as api.History }),
    routeRisk: async () => ({ ok: true, reply: samples.routeRisk as api.RouteRisk }),
    forum: async () => samples.forum as api.Forum,
    goals: async () => ({ ok: true, reply: samples.goals as unknown as api.Goals }),
    board: async () => samples.board as api.Board,
    guild: async () => samples.guild as unknown as api.Guild,
    classes: async () => samples.classes as api.Classes,
    party: async () => state.party ?? mm8.alone,
    parties: async () => state.parties ?? { tick: 13, parties: [mm8.board] },
    hunts: async () => state.hunts ?? { tick: 13, every: 1, hunts: [] },
  };
  const ctx: Ctx = { world, lex, threatLine: 600 };
  const press = (id: Id, extra: { values?: string[]; fields?: Record<string, string> } = {}) =>
    answer(ctx, {
      id,
      ...extra,
      user: "someone",
      guild: "guild",
      channel: "chan",
      interaction: "event",
    });
  return { world, ctx, writes, press, state };
}

const ids = (c: Card) =>
  c.rows.flatMap((r) =>
    "buttons" in r
      ? r.buttons.map((b) => (b.kind === "page" ? decodeId(b.customId) : null))
      : [decodeId(r.select.customId)],
  );

test("inviting someone in reach sends the invitation, and the party card is drawn again", async () => {
  const { press, writes } = fakeWorld({ party: mm8.party });
  const a = await press({ action: "p-invite", target: "", version: 49 }, { values: ["c-4"] });
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 49,
      kind: api.ActPartyInvite,
      target: "c-4",
      server: "guild",
    },
  ]);
  expect(a.card.title).toStartWith("Invited");
  expect(a.party).toMatchObject({
    party: "pt-1",
    members: ["d-1", "d-2", "d-3"],
    channel: "chan",
    server: "guild",
  });
  expect(problems(a.card, names)).toEqual([]);
});

test("an invitation is taken from the party card, and the thread is opened where it was pressed", async () => {
  const { press, writes, state } = fakeWorld({ party: mm8.alone });
  const card = (await press({ action: "party", target: "", version: 49 })).card;
  const join = ids(card).find((x) => x?.action === "p-join");
  expect(join).toEqual({ action: "p-join", target: "c-2", version: 49 });
  state.party = mm8.party;
  const a = await press(join!);
  expect(writes.map((w) => [w.kind, w.target])).toEqual([[api.ActPartyJoin, "c-2"]]);
  expect(a.card.title).toBe("You joined the party");
  expect(a.party?.channel).toBe("chan");
});

/** A button pressed on a message everyone in its channel sees. */
function sharedButton(customId: string) {
  return {
    user: { id: "someone" },
    id: "event",
    guildId: "guild",
    channelId: "thread-1",
    channel: { isThread: () => true, parentId: "chan" },
    customId,
    message: {
      id: SnowflakeUtil.generate({ timestamp: Date.now() - 3_600_000 }).toString(),
      // Not ephemeral: everyone in the thread sees it.
      flags: { has: () => false },
    },
    isPrimaryEntryPointCommand: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    showModal: mock(async () => {}),
    launchActivity: mock(async () => {}),
    deferUpdate: mock(async () => {}),
    deferReply: mock(async (_v: unknown) => {}),
    editReply: mock(async (_v: unknown) => {}),
    reply: mock(async (_v: unknown) => {}),
    update: mock(async (_v: unknown) => {}),
    followUp: mock(async (_v: unknown) => {}),
  };
}

test("a pick from the thread card is answered with the presser's own card, and the thread card is never edited", async () => {
  const { ctx, writes, state } = fakeWorld({
    options: mm8.shared,
    here: mm8.inDungeon,
    party: mm8.choosing,
  });
  const notes: PartyNote[] = [];
  const handle = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
    onParty: async (n) => {
      notes.push(n);
      return "thread";
    },
  });
  const i = sharedButton(encodeId("p-card", "pt-1", 0));
  await handle(i as unknown as Interaction);
  expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  for (const other of ["deferUpdate", "update", "reply", "followUp"] as const)
    expect(i[other]).not.toHaveBeenCalled();
  const sent = i.editReply.mock.calls[0]![0] as {
    embeds: { author: { name: string } }[];
    components: { components: { custom_id?: string }[] }[];
  };
  expect(sent.embeds[0]!.author.name).toStartWith("Party beat");
  const picks = sent.components
    .flatMap((r) => r.components)
    .map((c) => (c.custom_id ? decodeId(c.custom_id) : null))
    .filter((x) => x?.action === "p-pick");
  // The presser's own version, not the shared card's.
  expect(picks.map((x) => x!.version)).toEqual(Array(4).fill(mm8.shared.version));
  expect(notes[0]).toMatchObject({ party: "pt-1", channel: "chan" });
  expect(writes).toEqual([]);

  // The pick is held; the last one resolves the beat for all, and its card goes to the thread.
  state.reply = (req) => ({
    ...(samples["act:look"] as { reply: api.ActionReply }).reply,
    facts: req.option === "strike" ? mm8.resolved : [],
  });
  const pick = sharedButton(encodeId("p-pick", "strike", 49));
  await handle(pick as unknown as Interaction);
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 49,
      kind: api.ActPartyPick,
      option: "strike",
      server: "guild",
      admin: false,
    },
  ]);
  const posted = notes.at(-1)!.post!;
  expect(posted.context).toBe(THREAD);
  expect(posted.table!.rows.map((r) => r[0])).toEqual(["Ossa", "Brakk", "Wen"]);
  expect(posted.table!.rows.map((r) => r.at(-1))).toEqual(["67", "33", "0"]);
  expect(problems(posted, names)).toEqual([]);
});

test("a pick that waits on the others says so, and offers no second pick", async () => {
  const { press, state } = fakeWorld({
    options: mm8.shared,
    here: mm8.inDungeon,
    party: mm8.choosing,
  });
  state.reply = () => ({ ...(samples["act:look"] as { reply: api.ActionReply }).reply, facts: [] });
  const before = await press({ action: "p-pick", target: "strike", version: 49 });
  expect(before.card.title).toBe("Picked: the beat waits on the others");
  state.party = mm8.party;
  const after = await press({ action: "p-card", target: "pt-1", version: 0 });
  expect(ids(after.card).some((x) => x?.action === "p-pick")).toBe(false);
  expect(after.card.description).toContain("You picked **Strike**");
});

test("a pick the world refuses shows the reason on the beat", async () => {
  const { press } = fakeWorld({
    options: mm8.shared,
    here: mm8.inDungeon,
    party: mm8.choosing,
    reply: () => ({ code: api.CodePicked, message: "c-1 has picked on this beat" }),
  });
  const a = await press({ action: "p-pick", target: "strike", version: 49 });
  expect(a.card.title).toBe("C-1 has picked on this beat");
});

test("at a fork a push names its way and a leave climbs out; the card shows the choice made", async () => {
  const fork = { ...mm8.party, fight: undefined, floor: mm8.atFork.floor };
  const { press, writes, state } = fakeWorld({ here: mm8.atFork, party: fork });
  const card = (await press({ action: "dungeon", target: "", version: 49 })).card;
  expect(card.author).toBe("Dungeon · floor 2 · the fork");
  const pushes = ids(card).filter((x) => x?.action === "push");
  expect(pushes.map((x) => x!.target)).toEqual(["way-0"]);
  state.here = {
    ...mm8.atFork,
    floor: {
      ...mm8.atFork.floor!,
      choices: [...mm8.atFork.floor!.choices!, { name: "Ossa", push: true, way: "way-0" }],
    },
  };
  const pushed = await press(pushes[0]!);
  expect(pushed.card.title).toBe("You push down A. Flooded stair");
  expect(pushed.card.fields?.find((f) => f.name === "Waiting on")?.value).toBe("1 member");
  await press({ action: "dg-leave", target: "", version: 50 });
  expect(writes.map((w) => [w.kind, w.option, w.version])).toEqual([
    [api.ActDungeonPush, "way-0", 49],
    [api.ActDungeonLeave, undefined, 50],
  ]);
});

test("naming the dungeon opens a modal at once, and its submit sends the name and the entrance", async () => {
  const { ctx, press, writes } = fakeWorld({ here: mm8.named });
  const card = (await press({ action: "dungeon", target: "", version: 49 })).card;
  const name = ids(card).find((x) => x?.action === "d-name")!;
  expect(name).toEqual({ action: "d-name", target: "-28,0", version: 49 });
  const modal = modalFor(name)!;
  expect(decodeId(modal.customId)).toEqual({ action: "d-named", target: "-28,0", version: 49 });
  expect(modalFor({ action: "d-name", target: "nowhere", version: 1 })).toBeNull();

  const handle = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
  });
  const i = sharedButton(encodeId("d-name", "-28,0", 49));
  await handle(i as unknown as Interaction);
  expect(i.showModal).toHaveBeenCalledTimes(1);
  expect(i.deferReply).not.toHaveBeenCalled();

  const done = await press(decodeId(modal.customId)!, { fields: { name: "The Long Dark" } });
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 49,
      kind: api.ActDungeonName,
      note: "The Long Dark",
      to: { q: -28, r: 0 },
      server: "guild",
    },
  ]);
  expect(done.card.title).toBe("Named: The Long Dark");
});

test("only a first slayer is offered the naming, and never once a name is given", async () => {
  const { press, state } = fakeWorld({ here: mm8.named });
  const offered = async () =>
    ids((await press({ action: "dungeon", target: "", version: 1 })).card).some(
      (x) => x?.action === "d-name",
    );
  expect(await offered()).toBe(true);
  state.here = { ...mm8.named, floor: { ...mm8.named.floor!, name: "The Long Dark" } };
  expect(await offered()).toBe(false);
  state.here = { ...mm8.named, recent: [] };
  expect(await offered()).toBe(false);
});

test("a hunt in reach is pressed from chat with the option it offers, and its card goes into the Activity too", async () => {
  const { press, writes } = fakeWorld({
    party: { ...mm8.alone, hunt: mm8.huntView },
    hunts: mm8.huntBoard,
  });
  const card = (await press({ action: "hunt", target: "hn-1", version: 49 })).card;
  expect(problems(card, names)).toEqual([]);
  const presses = ids(card).filter((x) => x?.action === "h-press");
  expect(presses[0]).toEqual({ action: "h-press", target: "hn-1:strike", version: 49 });
  expect(ids(card).some((x) => x?.action === "launch" && x.target === "hunt")).toBe(true);
  await press(presses[0]!);
  expect(writes.map((w) => [w.kind, w.target, w.option])).toEqual([
    [api.ActHuntPress, "hn-1", "strike"],
  ]);
  // Without the viewer's own read the hunt is pressed in the Activity alone.
  const bare = fakeWorld({ hunts: mm8.huntBoard });
  const plain = (await bare.press({ action: "hunt", target: "hn-1", version: 49 })).card;
  expect(ids(plain).some((x) => x?.action === "h-press")).toBe(false);
  expect(ids(plain).some((x) => x?.action === "launch")).toBe(true);
});

test("/party opens the party card, and a press with the thread budget spent says the thread opens soon", async () => {
  const { ctx } = fakeWorld({ party: mm8.party });
  const handle = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
    onParty: async () => "soon",
  });
  const i = {
    ...sharedButton(""),
    commandName: "party",
    isChatInputCommand: () => true,
    isButton: () => false,
  };
  await handle(i as unknown as Interaction);
  const sent = i.editReply.mock.calls[0]![0] as {
    embeds: { title: string; fields?: { name: string }[] }[];
  };
  expect(sent.embeds[0]!.title).toBe("Your party");
  expect(sent.embeds[0]!.fields?.some((f) => f.name === "Party thread")).toBe(true);
});

/** A thread sink that remembers what it was asked, and checks the poster marked an open before making one. */
function fakeThreads(store: ReturnType<typeof memoryStore>) {
  const calls: string[] = [];
  const cards: Card[] = [];
  const sink: ThreadSink = {
    open: async (channel, _name, card, members) => {
      const k = JSON.parse((await store.get("mmo-bot:party:pt-1")) ?? "{}");
      calls.push(`open ${channel} ${k.state} ${members.join(",")}`);
      cards.push(card);
      await Bun.sleep(5);
      return { thread: "th-1", card: "m-1" };
    },
    add: async (_t, m) => (calls.push(`add ${m.join(",")}`), true),
    edit: async (_t, _m, c) => (calls.push(`edit ${c.title}`), cards.push(c), true),
    post: async (_t, c) => (calls.push(`post ${c.title}`), true),
    archive: async (t) => void calls.push(`archive ${t}`),
  };
  return { sink, calls, cards };
}

const note: PartyNote = {
  party: "pt-1",
  members: ["d-1", "d-2"],
  channel: "chan",
  server: "guild",
  picture: { media: mm8.here.banner, place: mm8.here.name },
};

test("a party's thread opens once, marked opening first, with every member added", async () => {
  const store = memoryStore();
  const { sink, calls } = fakeThreads(store);
  let board: api.Parties = { tick: 1, parties: [mm8.board] };
  const poster = new PartyPoster(
    { parties: async () => board },
    lex,
    store,
    sink,
    new ThreadBudget(),
    { editMs: 0 },
  );
  const modes = await Promise.all([poster.note(note), poster.note(note), poster.note(note)]);
  expect(modes).toEqual(["thread", "thread", "thread"]);
  expect(calls.filter((c) => c.startsWith("open"))).toEqual(["open chan opening d-1,d-2,d-3"]);
  expect(JSON.parse((await store.get("mmo-bot:party:pt-1"))!).thread).toBe("th-1");
  expect(JSON.parse((await store.get("mmo-bot:party:open"))!)).toEqual(["pt-1"]);
  // A member who joins later is added.
  await poster.note({ ...note, members: ["d-1", "d-2", "d-4"] });
  expect(calls).toContain("add d-4");
  board = { tick: 2, parties: [] };
  expect(await poster.poll()).toBe(1);
  expect(calls.slice(-2)).toEqual(["edit The party has ended", "archive th-1"]);
  expect(await store.get("mmo-bot:party:pt-1")).toBeNull();
});

test("the thread card is edited when someone picks, at most once in the edit window", async () => {
  const store = memoryStore();
  const { sink, calls, cards } = fakeThreads(store);
  let board: api.Parties = {
    tick: 1,
    parties: [{ ...mm8.board, members: mm8.board.members.map((m) => ({ ...m, picked: false })) }],
  };
  const poster = new PartyPoster(
    { parties: async () => board },
    lex,
    store,
    sink,
    new ThreadBudget(),
    { editMs: 60 },
  );
  await poster.note(note);
  board = { tick: 1, parties: [mm8.board] };
  await poster.note(note);
  board = {
    tick: 1,
    parties: [{ ...mm8.board, members: mm8.board.members.map((m) => ({ ...m, picked: true })) }],
  };
  await poster.note(note);
  await poster.poll();
  expect(calls.filter((c) => c.startsWith("edit"))).toEqual([]);
  await Bun.sleep(120);
  expect(calls.filter((c) => c.startsWith("edit"))).toEqual(["edit Clash: everyone picks"]);
  const shown = cards.at(-1)!;
  expect(shown.fields?.filter((f) => f.value === "Picked")).toHaveLength(3);
  expect(problems(shown, names)).toEqual([]);
  // Nothing changed: no edit.
  await Bun.sleep(80);
  await poster.poll();
  expect(calls.filter((c) => c.startsWith("edit"))).toHaveLength(1);
});

test("a party that ends inside the edit window is closed once the window has passed", async () => {
  const store = memoryStore();
  const { sink, calls } = fakeThreads(store);
  let clock = 1_000;
  let board: api.Parties = { tick: 1, parties: [mm8.board] };
  const poster = new PartyPoster(
    { parties: async () => board },
    lex,
    store,
    sink,
    new ThreadBudget(),
    { editMs: 60, now: () => clock },
  );
  await poster.note(note);
  clock = 1_010;
  board = { tick: 2, parties: [] };
  await poster.poll();
  await poster.poll();
  expect(calls.filter((c) => c.startsWith("edit") || c.startsWith("archive"))).toEqual([]);
  expect(await store.get("mmo-bot:party:pt-1")).not.toBeNull();
  clock = 1_100;
  await Bun.sleep(120);
  expect(calls.filter((c) => c.startsWith("edit") || c.startsWith("archive"))).toEqual([
    "edit The party has ended",
    "archive th-1",
  ]);
  expect(await store.get("mmo-bot:party:pt-1")).toBeNull();
});

test("past the thread budget the party plays in its own cards, and its thread opens once the budget allows", async () => {
  const store = memoryStore();
  const { sink, calls } = fakeThreads(store);
  let t = 0;
  const budget = new ThreadBudget(() => t);
  for (let i = 0; i < THREADS_PER_WINDOW; i++) budget.take("guild");
  const poster = new PartyPoster(
    { parties: async () => ({ tick: 1, parties: [mm8.board] }) },
    lex,
    store,
    sink,
    budget,
  );
  expect(await poster.note(note)).toBe("soon");
  expect(calls).toEqual([]);
  await poster.poll();
  expect(calls).toEqual([]);
  t = 300_001;
  await poster.poll();
  expect(calls.filter((c) => c.startsWith("open"))).toHaveLength(1);
  expect(await poster.note(note)).toBe("thread");
});

test("a press with a card for the thread posts it there", async () => {
  const store = memoryStore();
  const { sink, calls } = fakeThreads(store);
  const poster = new PartyPoster(
    { parties: async () => ({ tick: 1, parties: [mm8.board] }) },
    lex,
    store,
    sink,
    new ThreadBudget(),
  );
  await poster.note(note);
  const { press, state } = fakeWorld({
    options: mm8.shared,
    here: mm8.inDungeon,
    party: mm8.choosing,
  });
  state.reply = () => ({
    ...(samples["act:look"] as { reply: api.ActionReply }).reply,
    facts: mm8.resolved,
  });
  const a = await press({ action: "p-pick", target: "strike", version: 49 });
  await poster.note(a.party!);
  expect(calls).toContain("post 2 of 3 members won the beat");
});

/** A channel sink for the hunt poster that remembers what it posted and edited. */
function fakeChannel() {
  const calls: string[] = [];
  const cards: Card[] = [];
  const sink: ChannelSink = {
    post: async (c) => (calls.push(`post ${c.title}`), cards.push(c), "msg-1"),
    edit: async (m, c) => (calls.push(`edit ${m} ${c.title}`), cards.push(c), true),
  };
  return { sink, calls, cards };
}

test("the hunt card is posted once and edited at most once a tick, then closed with its spoils", async () => {
  const store = memoryStore();
  const { sink, calls, cards } = fakeChannel();
  let board: api.HuntBoard = { tick: 10, every: 1, hunts: [mm8.hunt] };
  const poster = new HuntPoster({ hunts: async () => board }, lex, store, sink);
  expect(await poster.poll()).toBe(1);
  expect(calls).toEqual(["post The dust-runner migration"]);
  // Pressed again in the same tick: not edited until the next.
  board = { ...board, hunts: [{ ...mm8.hunt, health: 600 }] };
  expect(await poster.poll()).toBe(0);
  board = { ...board, tick: 11, hunts: [{ ...mm8.hunt, health: 560 }] };
  expect(await poster.poll()).toBe(1);
  board = { ...board, tick: 11, hunts: [{ ...mm8.hunt, health: 500 }] };
  expect(await poster.poll()).toBe(0);
  board = { ...board, tick: 12, hunts: [mm8.huntSlain] };
  expect(await poster.poll()).toBe(1);
  expect(calls).toEqual([
    "post The dust-runner migration",
    "edit msg-1 The dust-runner migration",
    "edit msg-1 The dust-runner migration: slain",
  ]);
  const closed = cards.at(-1)!;
  expect(closed.table?.header).toEqual(["Presser", "Removed (health)", "Spoils (goods)"]);
  for (const c of cards) expect(problems(c, names)).toEqual([]);
  // Closed, it is left as it is; cleared from the world, it is forgotten.
  board = { ...board, tick: 13 };
  expect(await poster.poll()).toBe(0);
  board = { ...board, tick: 14, hunts: [] };
  await poster.poll();
  expect(await store.get("mmo-bot:hunt:hn-1")).toBeNull();
  expect(calls).toHaveLength(3);
});

test("a hunt card whose post failed is posted again; one marked posting is never posted twice", async () => {
  const store = memoryStore();
  let fail = true;
  const posted: string[] = [];
  const poster = new HuntPoster(
    { hunts: async () => ({ tick: 1, every: 1, hunts: [mm8.hunt] }) },
    lex,
    store,
    {
      post: async (c) => {
        if (fail) throw new Error("Discord said no");
        posted.push(c.title);
        return "m";
      },
      edit: async () => true,
    },
    "mmo-bot:hunt:",
    () => {},
  );
  await poster.poll();
  expect(await store.get("mmo-bot:hunt:hn-1")).toBeNull();
  fail = false;
  await poster.poll();
  expect(posted).toEqual(["The dust-runner migration"]);
  await store.set("mmo-bot:hunt:hn-2", JSON.stringify({ message: "", tick: 1, shown: "" }));
  const again = new HuntPoster(
    { hunts: async () => ({ tick: 3, every: 1, hunts: [{ ...mm8.hunt, id: "hn-2" }] }) },
    lex,
    store,
    { post: async () => (posted.push("twice"), "m"), edit: async () => true },
  );
  await again.poll();
  expect(posted).not.toContain("twice");
});

test("a thread that will not open is forgotten, and the next press tries again", async () => {
  const store = memoryStore();
  const { sink, calls } = fakeThreads(store);
  let refuse = true;
  const poster = new PartyPoster(
    { parties: async () => ({ tick: 1, parties: [mm8.board] }) },
    lex,
    store,
    {
      ...sink,
      open: async (...args) => {
        if (refuse) throw new Error("not a text channel");
        return sink.open(...args);
      },
    },
    new ThreadBudget(),
    { log: () => {} },
  );
  expect(await poster.note(note)).toBe("none");
  expect(await store.get("mmo-bot:party:pt-1")).toBeNull();
  refuse = false;
  expect(await poster.note(note)).toBe("thread");
  expect(calls.filter((c) => c.startsWith("open"))).toHaveLength(1);
});

test("arming the machine at a fork changes what the thread shows", () => {
  const fork = mm8.forkBoard.fork;
  if (!fork) throw new Error("fixture has no fork");
  const armed = { ...mm8.forkBoard, fork: { ...fork, waiting: true } };
  expect(shownOf(armed)).not.toBe(shownOf({ ...mm8.forkBoard, fork: { ...fork, waiting: false } }));
  expect(shownOf(armed)).not.toBe(shownOf(mm8.forkBoard));
});

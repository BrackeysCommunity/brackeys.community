import { expect, mock, test } from "bun:test";

import { type Client, type Interaction, MessageFlags, SnowflakeUtil } from "discord.js";

import { toMessage } from "../../../packages/discord-kit/src/index.ts";
import {
  ALARM_FAILED,
  ALARM_NONE,
  ALARM_OFF,
  ALARM_ON,
  channelSink,
  createHandler,
} from "../src/adapter.ts";
import type * as api from "../src/api.ts";
import { type Card, COLOUR, problems } from "../src/card.ts";
import { localBudget } from "../src/cooldown.ts";
import { type EventsAudience, EventsPoster, type EventsWorld } from "../src/events.ts";
import type { Ctx } from "../src/flow.ts";
import { memoryStore } from "../src/forum.ts";
import {
  type ChannelSink,
  GuildPosters,
  HuntPoster,
  posterPrefix,
  type Poller,
} from "../src/hunts.ts";
import { encodeId } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
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
const names = lex.goodsNames();
const ROLE = "role-alarm";

function fact(id: number, kind: string, tick: number, data: api.Datum[] = []): api.Fact {
  return { id, tick, kind, subjects: [], data, weight: 80 };
}

function side(id: string, filled: number, mark = 50): api.Side {
  return {
    id,
    title: id === "hold" ? "Hold the gate" : "Open the gate",
    wants: "goods",
    tag: "provisions",
    goal: `gl-${id}`,
    mark,
    filled,
    backers: filled ? 2 : 0,
    pay: 120,
    at: "Ashford",
    sponsor: "The Compact",
    opponent: "The Clans",
    mine: false,
  };
}

function siege(filled: [number, number], extra: Partial<api.Arc> = {}): api.Arc {
  return {
    id: "arc-1",
    template: "siege",
    title: "The siege of Ashford",
    scope: "world",
    cast: [],
    regions: ["region:0"],
    seat: { q: 0, r: 0 },
    stage: 0,
    stages: 3,
    due: 900,
    dueDay: 6,
    sides: [side("hold", filled[0]), side("open", filled[1])],
    began: 100,
    ...extra,
  };
}

function raidArc(defence: number, extra: Partial<api.Arc> = {}): api.Arc {
  return {
    ...siege([0, 0]),
    id: "arc-raid",
    template: "raid",
    title: "A raid on Ashford",
    scope: "settlement",
    stages: 1,
    due: 400,
    sides: [{ ...side("defend", defence, 7), wants: "defence", tag: "" }],
    trouble: { ...raid, defence: Math.min(defence, 7), mark: 7, ends: 400 },
    ...extra,
  };
}

const raid: api.Trouble = {
  arc: "arc-raid",
  kind: "raid",
  title: "A raid on Ashford",
  banner: "",
  mark: 7,
  defence: 0,
  ends: 400,
};

const at = (id: string, stage = 0) => [
  { k: "arc", s: id },
  { k: "stage", n: stage },
];

const raidStarts: api.StoryEvent = {
  fact: fact(11, "trouble.started", 310, at("arc-raid")),
  trouble: raid,
  place: "Ashford",
  alarm: true,
};
const raidHeld: api.StoryEvent = {
  fact: fact(14, "trouble.held", 390, at("arc-raid")),
  trouble: { ...raid, defence: 7 },
  place: "Ashford",
};
const cast: api.StoryEvent = { fact: fact(12, "arc.cast", 310, at("arc-1")), arc: siege([0, 0]) };
const closed: api.StoryEvent = { fact: fact(15, "season.closed", 400) };

/** A card that names its event, so a test reads what was posted without the screens. */
function plainCard(ev: api.StoryEvent): Card | null {
  const n = ev.trouble?.defence ?? ev.arc?.sides.reduce((x, s) => x + s.filled, 0) ?? 0;
  return {
    context: "Events channel · everyone in the server can see this",
    author: "Events",
    title: `${ev.fact.kind} ${n}`,
    picture: "form",
    footer: "Open /play to take part.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** A world whose events, arcs and tick are what a test sets. */
function stubWorld(state: {
  events: api.StoryEvent[];
  arcs?: api.Arc[];
  ended?: api.Arc[];
  tick?: number;
  hidden?: number;
}) {
  const reads: number[] = [];
  const world: EventsWorld = {
    async storyEvents(after) {
      reads.push(after);
      const events = state.events.filter((e) => e.fact.id > after).slice(0, 2);
      const last = Math.max(after, state.hidden ?? 0, ...events.map((e) => e.fact.id));
      return { events, last: events.length ? events.at(-1)!.fact.id : last };
    },
    arcs: async () => ({
      season: { n: 0, day: 3, days: 14, band: "opening", ends: 2016 },
      open: state.arcs ?? [],
      ended: state.ended ?? [],
      backing: [],
    }),
    hunts: async () => ({ tick: state.tick ?? 0, every: 1 }),
  };
  return { world, reads };
}

/** A channel that remembers each post, its mention, and each edit. */
function memoryChannel() {
  const posts: { title: string; mention?: string }[] = [];
  const edits: { message: string; title: string; mention?: string }[] = [];
  const sink: ChannelSink = {
    async post(card, mention) {
      posts.push({ title: card.title, mention });
      return `msg-${posts.length}`;
    },
    async edit(message, card, mention) {
      edits.push({ message, title: card.title, mention });
      return true;
    },
  };
  return { sink, posts, edits };
}

const quiet = () => {};

test("a channel new to the poster starts at the present and posts none of the past", async () => {
  const store = memoryStore();
  const { world } = stubWorld({ events: [raidStarts, cast, raidHeld, closed], hidden: 20 });
  const { sink, posts } = memoryChannel();
  const poster = new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet, plainCard);
  expect(await poster.poll()).toBe(0);
  expect(await store.get("mmo-bot:events:last")).toBe("20");
  expect(await poster.poll()).toBe(0);
  expect(posts).toEqual([]);
});

test("each event is posted once in the world's order, and a restart posts none of them twice", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "10");
  const state = { events: [raidStarts, cast, raidHeld, closed], hidden: 0 };
  const { world } = stubWorld(state);
  const { sink, posts } = memoryChannel();
  const poster = new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet, plainCard);
  expect(await poster.poll()).toBe(4);
  expect(posts.map((p) => p.title)).toEqual([
    "trouble.started 0",
    "arc.cast 0",
    "trouble.held 7",
    "season.closed 0",
  ]);
  expect(await store.get("mmo-bot:events:last")).toBe("15");
  // A restart reads the same store: nothing again.
  const again = new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet, plainCard);
  expect(await again.poll()).toBe(0);
  // Facts the channel does not show still move the mark on.
  state.hidden = 30;
  await again.poll();
  expect(await store.get("mmo-bot:events:last")).toBe("30");
  expect(posts).toHaveLength(4);
});

test("only a raid's start mentions the alarm role, and only when one is set", async () => {
  const events = [raidStarts, cast, raidHeld, closed];
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "0");
  const { sink, posts } = memoryChannel();
  await new EventsPoster(
    stubWorld({ events }).world,
    lex,
    store,
    sink,
    ROLE,
    undefined,
    quiet,
    plainCard,
  ).poll();
  expect(posts.map((p) => p.mention)).toEqual([ROLE, undefined, undefined, undefined]);
  // A trouble that is no raid carries no alarm.
  const fire = { ...raidStarts, fact: { ...raidStarts.fact, id: 16 }, alarm: false };
  const none = memoryStore();
  await none.set("mmo-bot:events:last", "0");
  const bare = memoryChannel();
  await new EventsPoster(
    stubWorld({ events: [...events, fire] }).world,
    lex,
    none,
    bare.sink,
    undefined,
    undefined,
    quiet,
    plainCard,
  ).poll();
  expect(bare.posts.every((p) => p.mention === undefined)).toBe(true);
  expect(posts.filter((p) => p.mention)).toHaveLength(1);
});

test("a post that fails is posted on the next poll, and the events after it wait for it", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "10");
  const { world } = stubWorld({ events: [raidStarts, cast] });
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
  const poster = new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet, plainCard);
  await expect(poster.poll()).rejects.toThrow("Discord said no");
  expect(await store.get("mmo-bot:events:last")).toBe("10");
  expect(await store.get("mmo-bot:events:live:arc-raid")).toBeNull();
  fail = false;
  expect(await poster.poll()).toBe(2);
  expect(posted).toEqual(["trouble.started 0", "arc.cast 0"]);
});

test("the raid and stage cards are edited as they fill, at most once a tick, until the stage ends", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "10");
  const state = {
    events: [raidStarts, cast],
    arcs: [raidArc(0), siege([0, 0])],
    ended: [] as api.Arc[],
    tick: 310,
  };
  const { world } = stubWorld(state);
  const { sink, posts, edits } = memoryChannel();
  const poster = new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet, plainCard);
  expect(await poster.poll()).toBe(2);
  expect(edits).toEqual([]);
  // Filled in the tick it was posted at: not edited until the next.
  state.arcs = [raidArc(3), siege([10, 0])];
  expect(await poster.poll()).toBe(0);
  state.tick = 311;
  expect(await poster.poll()).toBe(2);
  expect(edits).toEqual([
    { message: "msg-2", title: "arc.cast 10", mention: undefined },
    { message: "msg-1", title: "trouble.started 3", mention: ROLE },
  ]);
  // Unchanged: not edited again.
  state.tick = 312;
  expect(await poster.poll()).toBe(0);
  // The raid is decided and the siege moves to its next stage: the raid's
  // card shows how it ended, the old stage's card is let go unedited.
  state.arcs = [siege([0, 0], { stage: 1 })];
  state.ended = [raidArc(7, { outcome: "defend" })];
  state.tick = 313;
  expect(await poster.poll()).toBe(1);
  expect(edits.at(-1)).toEqual({ message: "msg-1", title: "trouble.started 7", mention: ROLE });
  expect(await store.get("mmo-bot:events:open")).toBe("[]");
  state.ended = [raidArc(7, { outcome: "defend" })];
  state.tick = 320;
  expect(await poster.poll()).toBe(0);
  expect(edits).toHaveLength(3);
  expect(posts).toHaveLength(2);
});

test("a live card left mid-post by a crash is never posted again or edited", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "11");
  await store.set("mmo-bot:events:open", JSON.stringify(["arc-raid"]));
  await store.set(
    "mmo-bot:events:live:arc-raid",
    JSON.stringify({ message: "", at: 300, shown: "", stage: 0, ev: raidStarts }),
  );
  const { world } = stubWorld({ events: [raidStarts], arcs: [raidArc(4)], tick: 400 });
  const { sink, posts, edits } = memoryChannel();
  const poster = new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet, plainCard);
  expect(await poster.poll()).toBe(0);
  expect(posts).toEqual([]);
  expect(edits).toEqual([]);
  expect(await store.get("mmo-bot:events:live:arc-raid")).toBeNull();
});

test("the events channel's own cards keep the card standard", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "0");
  const cards: Card[] = [];
  const sink: ChannelSink = {
    post: async (c) => (cards.push(c), "m"),
    edit: async () => true,
  };
  const { world } = stubWorld({ events: [raidStarts, cast, raidHeld, closed] });
  await new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet).poll();
  expect(cards.length).toBeGreaterThan(0);
  for (const c of cards) expect(problems(c, names)).toEqual([]);
});

test("a role a message names is the only one it may ping", () => {
  const m = toMessage({ content: "<@&r1> @everyone", embeds: [], rows: [], mentionRoles: ["r1"] });
  expect(m.allowedMentions).toEqual({ parse: [], roles: ["r1"] });
  expect(toMessage({ embeds: [], rows: [] }).allowedMentions).toEqual({ parse: [] });
});

test("the channel sink pings the alarm role on a post and shows it without a ping on an edit", async () => {
  const sent: Record<string, unknown>[] = [];
  const edited: Record<string, unknown>[] = [];
  const channel = {
    isSendable: () => true,
    send: async (m: Record<string, unknown>) => (sent.push(m), { id: "msg-9" }),
    messages: {
      fetch: async () => ({ edit: async (m: Record<string, unknown>) => void edited.push(m) }),
    },
  };
  const client = { channels: { fetch: async () => channel } } as unknown as Client;
  const sink = channelSink(client, "events", async () => new Uint8Array([1]), quiet);
  const card = plainCard(raidStarts)!;
  expect(await sink.post(card, ROLE)).toBe("msg-9");
  expect(sent[0]!.content).toStartWith(`<@&${ROLE}>\n-# Events channel`);
  expect(sent[0]!.allowedMentions).toEqual({ parse: [], roles: [ROLE] });
  expect(await sink.edit("msg-9", card, ROLE)).toBe(true);
  expect(edited[0]!.content).toStartWith(`<@&${ROLE}>`);
  expect(edited[0]!.allowedMentions).toEqual({ parse: [] });
  await sink.post(card);
  expect(sent[1]!.content).toStartWith("-# Events channel");
  expect(sent[1]!.allowedMentions).toEqual({ parse: [] });
});

/** The Raid alarms button pressed on the events channel's card, by a member whose roles a test holds. */
function alarmPress(roles: Set<string>, refuse = false) {
  return {
    user: { id: "member-1" },
    id: "event",
    guildId: "guild",
    channelId: "events",
    channel: { isThread: () => false },
    customId: encodeId("alarm"),
    member: {
      roles: {
        cache: { has: (r: string) => roles.has(r) },
        add: mock(async (r: string) => {
          if (refuse) throw new Error("Missing Permissions");
          roles.add(r);
        }),
        remove: mock(async (r: string) => void roles.delete(r)),
      },
    },
    message: {
      id: SnowflakeUtil.generate({ timestamp: Date.now() - 60_000 }).toString(),
      flags: { has: () => false },
    },
    isPrimaryEntryPointCommand: () => false,
    isMessageContextMenuCommand: () => false,
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

function alarmHandler(alarmRole?: string) {
  const world = new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error("the alarm toggle reads no world");
      },
    },
  );
  const ctx = { world, lex, threatLine: 600 } as unknown as Ctx;
  return createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
    alarmRole,
    log: quiet,
  });
}

test("the Raid alarms button adds the role to its presser, and a second press takes it away", async () => {
  const roles = new Set<string>(["someone-else"]);
  const handle = alarmHandler(ROLE);
  const first = alarmPress(roles);
  await handle(first as unknown as Interaction);
  expect(first.member.roles.add).toHaveBeenCalledWith(ROLE);
  expect(first.member.roles.remove).not.toHaveBeenCalled();
  expect(first.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(first.editReply).toHaveBeenCalledWith({ content: ALARM_ON });
  expect([...roles].sort()).toEqual([ROLE, "someone-else"].sort());
  for (const other of ["deferUpdate", "update", "followUp", "launchActivity"] as const)
    expect(first[other]).not.toHaveBeenCalled();
  const second = alarmPress(roles);
  await handle(second as unknown as Interaction);
  expect(second.member.roles.remove).toHaveBeenCalledWith(ROLE);
  expect(second.member.roles.add).not.toHaveBeenCalled();
  expect(second.editReply).toHaveBeenCalledWith({ content: ALARM_OFF });
  expect([...roles]).toEqual(["someone-else"]);
});

test("with no alarm role set, or a role the bot may not grant, the press says so and changes nothing", async () => {
  const roles = new Set<string>();
  const unset = alarmPress(roles);
  await alarmHandler()(unset as unknown as Interaction);
  expect(unset.reply).toHaveBeenCalledWith({ content: ALARM_NONE, flags: MessageFlags.Ephemeral });
  expect(unset.member.roles.add).not.toHaveBeenCalled();
  const refused = alarmPress(roles, true);
  await alarmHandler(ROLE)(refused as unknown as Interaction);
  expect(refused.editReply).toHaveBeenCalledWith({ content: ALARM_FAILED });
  expect(roles.size).toBe(0);
});

/** A server's house as the bot reads it: its settings and stages, nothing else a test needs. */
function house(server: string, settings: api.HouseSettings = {}, stages: api.StageView[] = []) {
  const h: api.House = {
    server,
    label: `Guild of ${server}`,
    arrival: 0,
    settings,
    settlements: [],
    templates: [],
    hunts: [],
    contests: [],
    stages,
    role: "player",
    stagedXp: 150,
  };
  return h;
}

/** Each guild's house, by guild, as a test sets them. */
function housesOf(by: Record<string, api.House | null>) {
  return { houseOf: async (guild: string) => by[guild] ?? null };
}

/** A fact a server's staging wrote, about a stage. */
function stagedEvent(
  id: number,
  kind: string,
  server: string,
  data: api.Datum[] = [],
  stage = "st-1",
): api.StoryEvent {
  return {
    fact: { ...fact(id, kind, 320, data), subjects: [{ kind: "stage", id: stage }] },
    place: "Ashford",
    server,
  };
}

const dropOpened = (id: number, server: string, stage = "st-1") =>
  stagedEvent(
    id,
    "staged.opened",
    server,
    [
      { k: "template", s: "drop-small" },
      { k: "kind", s: "drop" },
      { k: "settlement", n: 2 },
      { k: "role", s: "admin" },
      { k: "label", s: `Guild of ${server}` },
      { k: "days", n: 2 },
      { k: "crates", n: 40 },
    ],
    stage,
  );

function dropStage(id: string, crates: number, extra: Partial<api.StageView> = {}): api.StageView {
  return {
    id,
    template: "drop-small",
    kind: "drop",
    placed: { by: "admins", label: "Guild of guild-a" },
    settlement: 2,
    place: "Ashford",
    at: { q: 3, r: 1 },
    opens: 320,
    ends: 896,
    open: true,
    crates,
    ...extra,
  };
}

test("an event a server staged is posted only in that server's channel; the world's own in every one", async () => {
  const events = [
    cast,
    closed,
    stagedEvent(16, "staged.closed", "guild-b"),
    dropOpened(17, "guild-a"),
  ];
  const { world } = stubWorld({ events });
  const houses = housesOf({ "guild-a": house("guild-a"), "guild-b": house("guild-b") });
  const posted: Record<string, string[]> = {};
  for (const server of ["guild-a", "guild-b"]) {
    const store = memoryStore();
    await store.set("mmo-bot:events:last", "10");
    const { sink, posts } = memoryChannel();
    const audience: EventsAudience = { server, houses };
    await new EventsPoster(
      world,
      lex,
      store,
      sink,
      ROLE,
      undefined,
      quiet,
      plainCard,
      audience,
    ).poll();
    posted[server] = posts.map((p) => p.title);
    // Another server's event still moves the mark on.
    expect(await store.get("mmo-bot:events:last")).toBe("17");
  }
  expect(posted["guild-a"]).toEqual(["arc.cast 0", "season.closed 0", "staged.opened 0"]);
  expect(posted["guild-b"]).toEqual(["arc.cast 0", "season.closed 0", "staged.closed 0"]);
});

test("the alarm mentions the house's alarm role, and is held back in its quiet hours, never the post", async () => {
  const quietHours = { alarmRoles: ["role-house"], quietFrom: 22 * 60, quietTo: 6 * 60 };
  const at = (h: number) => Date.UTC(2026, 10, 25, h, 30);
  const mentions: (string | undefined)[] = [];
  for (const [settings, hour] of [
    [quietHours, 23],
    [quietHours, 3],
    [quietHours, 12],
    [{}, 23],
    [{ quietFrom: 60, quietTo: 60 }, 1],
  ] as [api.HouseSettings, number][]) {
    const store = memoryStore();
    await store.set("mmo-bot:events:last", "10");
    const { sink, posts } = memoryChannel();
    const audience: EventsAudience = {
      server: "guild-a",
      houses: housesOf({ "guild-a": house("guild-a", settings) }),
      now: () => at(hour),
    };
    const { world } = stubWorld({ events: [raidStarts] });
    await new EventsPoster(
      world,
      lex,
      store,
      sink,
      ROLE,
      undefined,
      quiet,
      plainCard,
      audience,
    ).poll();
    expect(posts).toHaveLength(1);
    mentions.push(posts[0]!.mention);
  }
  // Quiet from 22:00 to 06:00 UTC, past midnight; equal ends are never quiet.
  expect(mentions).toEqual([undefined, undefined, "role-house", ROLE, ROLE]);
});

test("a drop's card is told with its stage, edited as its crates go, and let go once it closes", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "10");
  const state = { events: [dropOpened(18, "guild-a")], tick: 320 };
  const { world } = stubWorld(state);
  const byGuild: Record<string, api.House | null> = {
    "guild-a": house("guild-a", {}, [dropStage("st-1", 40)]),
  };
  const { sink, posts, edits } = memoryChannel();
  const cards: Card[] = [];
  const poster = new EventsPoster(
    world,
    lex,
    store,
    sink,
    ROLE,
    undefined,
    quiet,
    (_ev, _mode, template) => {
      const c = template();
      if (c) cards.push(c);
      return c;
    },
    { server: "guild-a", houses: housesOf(byGuild) },
  );
  expect(await poster.poll()).toBe(1);
  expect(posts.map((p) => p.title)).toEqual(["A drop of crates near Ashford"]);
  expect(await store.get("mmo-bot:events:open")).toBe(JSON.stringify(["stage:st-1"]));
  // Crates opened in the tick it was posted: not edited until the next.
  byGuild["guild-a"] = house("guild-a", {}, [dropStage("st-1", 31)]);
  expect(await poster.poll()).toBe(0);
  state.tick = 321;
  expect(await poster.poll()).toBe(1);
  expect(edits.map((e) => e.message)).toEqual(["msg-1"]);
  expect(JSON.stringify(cards.at(-1)!.fields)).toContain("31 crates left");
  // Unchanged: not edited again.
  state.tick = 322;
  expect(await poster.poll()).toBe(0);
  // Closed: shown at once, then let go.
  byGuild["guild-a"] = house("guild-a", {}, [dropStage("st-1", 0, { open: false, closed: true })]);
  expect(await poster.poll()).toBe(1);
  expect(edits.at(-1)!.title).toBe("The drop near Ashford is over");
  expect(await store.get("mmo-bot:events:open")).toBe("[]");
  for (const c of cards) expect(problems(c, names)).toEqual([]);
});

test("a drop's card whose house cannot be read waits, and one whose stage is gone is let go", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "10");
  const state = { events: [dropOpened(18, "guild-a")], tick: 320 };
  const { world } = stubWorld(state);
  const byGuild: Record<string, api.House | null> = {
    "guild-a": house("guild-a", {}, [dropStage("st-1", 40)]),
  };
  const { sink, edits } = memoryChannel();
  const poster = new EventsPoster(world, lex, store, sink, ROLE, undefined, quiet, undefined, {
    server: "guild-a",
    houses: housesOf(byGuild),
  });
  expect(await poster.poll()).toBe(1);
  byGuild["guild-a"] = null;
  state.tick = 330;
  expect(await poster.poll()).toBe(0);
  expect(await store.get("mmo-bot:events:open")).toBe(JSON.stringify(["stage:st-1"]));
  byGuild["guild-a"] = house("guild-a");
  expect(await poster.poll()).toBe(0);
  expect(await store.get("mmo-bot:events:open")).toBe("[]");
  expect(edits).toEqual([]);
});

test("a fair is told with its contests from the board", async () => {
  const store = memoryStore();
  await store.set("mmo-bot:events:last", "10");
  const fairStage = dropStage("st-2", 40, { kind: "fair", template: "fair", goals: ["g-1"] });
  const opened = dropOpened(19, "guild-a", "st-2");
  opened.fact.data = opened.fact.data.map((d) => (d.k === "kind" ? { k: "kind", s: "fair" } : d));
  const goal = {
    id: "g-1",
    title: "Rat cull",
    issuer: "staged",
    by: "st-2",
    verb: "defeat",
    what: "defeat 5 creatures, a reed rat",
    reward: 0,
    mode: "each",
    cap: 10,
    lifetime: "ephemeral",
    turnover: "expire",
    state: "live",
    progress: 0,
    count: 5,
    claims: 1,
    mine: false,
    yours: 0,
    top: [],
  } as unknown as api.Goal;
  const board = {
    tick: 320,
    every: 1,
    posts: [{ settlement: 2, name: "Ashford", banner: "", goal }],
  } as unknown as api.Board;
  const cards: Card[] = [];
  const sink: ChannelSink = { post: async (c) => (cards.push(c), "m"), edit: async () => true };
  await new EventsPoster(
    stubWorld({ events: [opened] }).world,
    lex,
    store,
    sink,
    ROLE,
    undefined,
    quiet,
    undefined,
    {
      server: "guild-a",
      houses: housesOf({ "guild-a": house("guild-a", {}, [fairStage]) }),
      board: async () => board,
    },
  ).poll();
  expect(cards.map((c) => c.title)).toEqual(["A fair at Ashford"]);
  expect(JSON.stringify(cards[0]!.fields)).toContain(
    "Rat cull: defeat 5 creatures, a reed rat, 1 of 10 claims",
  );
  expect(problems(cards[0]!, names)).toEqual([]);
});

test("a staged hunt's card is posted only in its own server's channel", async () => {
  const hunt = (id: string, stage?: string): api.HuntCard => ({
    id,
    row: "cinder-hound",
    name: `Hunt ${id}`,
    creature: "cinder-hound",
    at: { q: 0, r: 0 },
    region: "region:0",
    health: 10,
    max: 10,
    ends: 500,
    pressers: [],
    spoils: [],
    ...(stage ? { stage, placed: { by: "staff", label: "Guild", points: 80 } } : {}),
  });
  const board = {
    tick: 1,
    every: 1,
    hunts: [hunt("h-1"), hunt("h-2", "st-a"), hunt("h-3", "st-b")],
  };
  const houses = housesOf({
    "guild-a": house("guild-a", {}, [dropStage("st-a", 0, { kind: "hunt" })]),
    "guild-b": house("guild-b", {}, [dropStage("st-b", 0, { kind: "hunt" })]),
  });
  const shown: Record<string, string[]> = {};
  for (const server of ["guild-a", "guild-b"]) {
    const { sink, posts } = memoryChannel();
    await new HuntPoster(
      { hunts: async () => board },
      lex,
      memoryStore(),
      sink,
      undefined,
      quiet,
      undefined,
      { server, houses },
    ).poll();
    shown[server] = posts.map((p) => p.title);
  }
  expect(shown["guild-a"]).toEqual(["Hunt h-1", "Hunt h-2"]);
  expect(shown["guild-b"]).toEqual(["Hunt h-1", "Hunt h-3"]);
  // A staged hunt's card already up is kept, not posted again, while the house cannot be read.
  const store = memoryStore();
  const { sink, posts } = memoryChannel();
  let fail = false;
  const flaky = {
    houseOf: async (g: string) => {
      if (fail) throw new Error("world down");
      return houses.houseOf(g);
    },
  };
  const poster = new HuntPoster(
    { hunts: async () => board },
    lex,
    store,
    sink,
    undefined,
    quiet,
    undefined,
    {
      server: "guild-a",
      houses: flaky,
    },
  );
  await poster.poll();
  fail = true;
  await poster.poll();
  fail = false;
  await poster.poll();
  expect(posts.map((p) => p.title)).toEqual(["Hunt h-1", "Hunt h-2"]);
});

test("each guild gets its own poster for its channel, and a new channel a new poster", async () => {
  const channels: Record<string, string | undefined> = { "guild-a": "ch-1", "guild-b": undefined };
  const made: string[] = [];
  const polls: string[] = [];
  const posters = new GuildPosters<Poller>(
    ["guild-a", "guild-b"],
    async (g) => channels[g],
    (g, ch) => {
      made.push(`${g}/${ch}`);
      return { poll: async () => (polls.push(`${g}/${ch}`), 1) };
    },
    quiet,
  );
  expect(await posters.poll()).toBe(1);
  channels["guild-b"] = "ch-2";
  expect(await posters.poll()).toBe(2);
  channels["guild-a"] = "ch-3";
  await posters.poll();
  expect(made).toEqual(["guild-a/ch-1", "guild-b/ch-2", "guild-a/ch-3"]);
  expect(polls).toEqual([
    "guild-a/ch-1",
    "guild-a/ch-1",
    "guild-b/ch-2",
    "guild-a/ch-3",
    "guild-b/ch-2",
  ]);
  const primary = { guild: "guild-a", channel: "ch-1" };
  expect(posterPrefix("mmo-bot:events:", "guild-a", "ch-1", primary)).toBe("mmo-bot:events:");
  expect(posterPrefix("mmo-bot:events:", "guild-b", "ch-2", primary)).toBe(
    "mmo-bot:events:guild-b:ch-2:",
  );
});

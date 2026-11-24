import { expect, mock, test } from "bun:test";

import { MessageFlags, SnowflakeUtil, type Interaction } from "discord.js";

import {
  createHandler,
  DOWN_LINE,
  HUB_TTL_MS,
  LAUNCH_LINE,
  MOVED_LINE,
  SLOW_LINE,
  STALE_LINE,
} from "../src/adapter.ts";
import * as api from "../src/api.ts";
import type { Card } from "../src/card.ts";
import { localBudget } from "../src/cooldown.ts";
import { answer, launchFor, modalFor, roleFor } from "../src/flow.ts";
import { decodeId, encodeId, type Id, launchTarget } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { BLANK, goalDraftId, specOf } from "../src/screens/goals.ts";
import { httpWorld } from "../src/world.ts";
import * as mm9 from "./fixtures/mm9.ts";
import samples from "./fixtures/world.json";

const GOALS_SINCE = {
  traits: [],
  places: [],
  fields: [],
  vows: [{ value: "blade", label: "no blade" }],
  party: [],
  partyMost: 6,
  even: false,
  waiting: [],
  gauge: "threat",
  ephemeralLeast: 6,
  ephemeralMost: 432,
  gauges: [
    { value: "threat", label: "threat", lines: [600, 700, 800] },
    { value: "unrest", label: "unrest", lines: [600, 700, 800] },
  ],
  sides: [
    { value: "below", label: "below" },
    { value: "above", label: "above" },
  ],
};

/** The recorded goal, with the fields served since it was recorded. */
const GOAL: api.Goal = { ...samples.board.posts[0]!.goal, canPledge: false, canWithdraw: false };

/** The recorded guild as an officer's at its bank, with a treasury, a stock to draw and a structure to raise. */
const GUILD_SINCE = {
  bankHere: true,
  officer: true,
  treasury: 400,
  spend: 100,
  bank: [{ material: "old-silk", units: 3, value: 40, draw: 2 }],
  members: samples.guild.members.map((m) => ({ ...m, payGoods: true })),
  settlements: samples.guild.settlements.map((s, i) => ({
    ...s,
    here: i === 0,
    city: { city: false },
    structures: s.structures.map((x, j) => ({ ...x, canRaise: j === 0, rewardMost: 30 })),
  })),
};
const RAISED = samples.guild.settlements[0]!.structures[0]!.kind;
/** Writes the scripted run never recorded: each answers as any plain write does. */
const UNRECORDED = new Set<string>([
  api.ActMarkPrey,
  api.ActDraw,
  api.ActPay,
  api.ActRaise,
  api.ActDeliverGoal,
  api.ActJoin,
  api.ActBackSide,
  api.ActPatternSet,
  api.ActCityRaise,
]);
/** The reads that name no character: the bot's own, world-wide. */
const WORLD_WIDE = new Set<string>([api.PathHunts, api.PathParties, api.PathStoryEvents]);

function setup({
  player = "c-1",
  stale = false,
  offline = false,
  facts = [] as api.Fact[],
  purse = {} as Partial<api.Purse>,
  options = samples.options as api.Options,
  here = samples.here as api.Here,
  sheet = samples.sheet as api.Sheet,
  goals = {} as Partial<api.Goals>,
  guild = {} as Partial<api.Guild>,
  arcs = mm9.arcs,
  missing = [] as string[],
} = {}) {
  const writes: api.ActionRequest[] = [];
  const reads: string[] = [];
  const queries: URLSearchParams[] = [];
  const appraisals: api.AppraiseRequest[] = [];
  const routes = new Map<string, unknown>([
    [api.PathPlayer, { characterId: player }],
    [api.PathOptions, { ...options, purse: { ...options.purse, ...purse } }],
    [api.PathHere, here],
    [api.PathSheet, sheet],
    [api.PathNPC, samples.npc],
    [api.PathMap, samples.map],
    [api.PathRecap, samples.recap],
    [api.PathRecipes, samples.recipes],
    // The recorded pages predate a few served fields.
    [api.PathGoals, { ...samples.goals, ...GOALS_SINCE, ...goals }],
    [api.PathGuild, { ...samples.guild, ...GUILD_SINCE, ...guild }],
    [api.PathClasses, samples.classes],
    [api.PathHunts, { tick: 0, every: 1, hunts: [] }],
    [api.PathParties, { tick: 0, parties: [] }],
    [api.PathChronicle, mm9.chronicle],
    [api.PathChronicleFact, mm9.causes],
    [api.PathArcs, arcs],
    [api.PathStoryEvents, { events: [], last: 0 }],
    [
      api.PathParty,
      { tick: 0, characterId: player, version: options.version, reach: [], invites: [] },
    ],
  ]);
  const fetcher = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      if (offline) throw new Error("unreachable");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test");
      if (url.pathname === api.PathActions && init?.method === "POST") {
        const body: api.ActionRequest = JSON.parse(String(init.body));
        writes.push(body);
        if (stale)
          return Response.json({ code: api.CodeStale, message: "stale version" }, { status: 409 });
        const kind = UNRECORDED.has(body.kind) ? api.ActLook : body.kind;
        const action = samples[`act:${kind}` as keyof typeof samples];
        if (!action || !("reply" in action)) throw new Error("unexpected action " + body.kind);
        return Response.json({ ...action.reply, facts: [...action.reply.facts, ...facts] });
      }
      if (url.pathname === api.PathAppraise && init?.method === "POST") {
        appraisals.push(JSON.parse(String(init.body)));
        return Response.json(samples.appraise);
      }
      reads.push(url.pathname);
      queries.push(url.searchParams);
      if (!WORLD_WIDE.has(url.pathname))
        expect(
          url.searchParams.get(url.pathname === api.PathPlayer ? "discordId" : "characterId"),
        ).toBe(url.pathname === api.PathPlayer ? "someone" : "c-1");
      if (!routes.has(url.pathname)) throw new Error("unexpected path " + url.pathname);
      if (missing.includes(url.pathname))
        return Response.json(
          { code: api.CodeNotFound, message: "world day 0 has not closed" },
          { status: 404 },
        );
      return Response.json(routes.get(url.pathname));
    },
    { preconnect: () => {} },
  );
  const world = httpWorld("http://world.test/", "test", fetcher);
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
  const ctx = { world, lex, threatLine: 600 };
  const press = (id: Id, values?: string[]) =>
    answer(ctx, { id, values, user: "someone", guild: "guild", interaction: "event" });
  return { writes, reads, queries, appraisals, ctx, press };
}

test("a new player's starter selection binds their Discord account and guild", async () => {
  const { ctx, writes, press } = setup({ player: "" });
  const arrival = await answer(ctx, { user: "someone", interaction: "open", command: "play" });
  expect(arrival.card.author).toContain("Arrival");
  expect(writes).toEqual([]);
  const started = await press({ action: "start", target: "knife", version: 0 });
  expect(writes).toEqual([
    {
      kind: "create",
      interactionId: "event",
      discordId: "someone",
      version: 0,
      option: "knife",
      server: "guild",
    },
  ]);
  expect(started.character).toBe("c-1");
  expect(started.card.title).toContain("knife");
});

test("the destination select submits signed coordinates and the card version", async () => {
  const { press, writes } = setup();
  const result = await press({ action: "goto", target: "", version: 17 }, ["-2,4"]);
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 17,
      kind: "travel",
      server: "guild",
      to: { q: -2, r: 4 },
      stop: { threat: 600 },
    },
  ]);
  expect(result.long).toBe(true);
  expect(result.card.title).toBe("On your way");
});

test("a stale gather refreshes the hub without scheduling a completion notice", async () => {
  const { press, writes, reads } = setup({ stale: true });
  const result = await press({ action: "gather", target: "scrap:2", version: 8 });
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 8,
      kind: "gather",
      server: "guild",
      material: "scrap",
      ticks: 2,
    },
  ]);
  expect(result.card.title).toContain("world moved on");
  expect(result.long).toBe(false);
  expect(reads).toContain(api.PathSheet);
});

test("malformed component targets leave world state untouched", async () => {
  const { press, writes } = setup();
  for (const id of [
    { action: "goto", target: "1," },
    { action: "gather", target: "ore:1.5" },
    { action: "choose", target: "npc/topic" },
    { action: "equip", target: "kit" },
  ] as const) {
    expect((await press({ ...id, version: 1 })).card.author).toBe("An old button");
  }
  expect(writes).toEqual([]);
});

function button(customId: string, age = 0, over: Record<string, unknown> = {}) {
  const now = Date.now();
  const interaction = {
    user: { id: "someone" },
    id: "event",
    guildId: "guild",
    customId,
    showModal: mock(async (_value: unknown) => {}),
    launchActivity: mock(async () => {}),
    message: { id: SnowflakeUtil.generate({ timestamp: now - age }).toString() },
    isPrimaryEntryPointCommand: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: mock(async () => {}),
    editReply: mock(async (_value: unknown) => {}),
    reply: mock(async (_value: unknown) => {}),
    update: mock(async (_value: unknown) => {}),
    followUp: mock(async (_value: unknown) => {}),
    ...over,
  };
  return { interaction, now };
}

const draft = { ...BLANK, target: "cinder-ore", reward: 0 };

test("naming a goal opens a modal at once, and its submit posts the drafted goal", async () => {
  const { ctx, writes } = setup();
  const handle = createHandler({
    ctx,
    budget: localBudget(),
    media: async () => new Uint8Array([1]),
  });
  const open = button(encodeId("g-name", goalDraftId(draft), 4));
  await handle(open.interaction as unknown as Interaction);
  expect(open.interaction.deferUpdate).not.toHaveBeenCalled();
  expect(open.interaction.showModal).toHaveBeenCalledWith(
    expect.objectContaining({
      custom_id: encodeId("g-post", goalDraftId(draft), 4),
      title: "Name your goal",
    }),
  );
  expect(writes).toEqual([]);

  const submit = button(encodeId("g-post", goalDraftId(draft), 4), 0, {
    isButton: () => false,
    isModalSubmit: () => true,
    isFromMessage: () => true,
    memberPermissions: { has: () => true },
    fields: {
      fields: new Map([
        ["title", { value: " Ore for the smelter " }],
        ["note", { value: "" }],
      ]),
    },
  });
  await handle(submit.interaction as unknown as Interaction);
  expect(submit.interaction.deferUpdate).toHaveBeenCalledTimes(1);
  expect(submit.interaction.editReply).toHaveBeenCalledTimes(1);
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 4,
      kind: api.ActPostGoal,
      server: "guild",
      admin: true,
      goal: specOf(draft, samples.goals as unknown as api.Goals, "Ore for the smelter", ""),
    },
  ]);
  expect(writes[0]!.goal).toMatchObject({
    title: "Ore for the smelter",
    reward: 0,
    mode: "first",
    cond: { verb: "deliver", kind: "cinder-ore", count: 10 },
  });
});

test("the form turns its pages and narrows without a write, and a vow posts as a Hold with no gauge", async () => {
  const { press, writes } = setup();
  const vow = { ...BLANK, verb: "vow", target: "blade", count: 0 };
  const runs = await press({
    action: "g-page",
    target: goalDraftId({ ...vow, page: "t" }),
    version: 2,
  });
  expect(runs.card.title).toBe("A vow: no blade");
  const blade = { ...BLANK, verb: "make", target: "blade", count: 1, narrow: "keen" };
  const narrowed = await press({ action: "g-narrow", target: "", version: 2 }, [
    goalDraftId(blade),
  ]);
  expect(narrowed.card.title).toEndWith("with keen");
  expect(writes).toEqual([]);
  await press({ action: "g-post", target: goalDraftId(vow), version: 5 });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    kind: api.ActPostGoal,
    version: 5,
    goal: { issuer: "character", reward: 0, cond: { verb: "hold", count: 0, tag: "blade" } },
  });
});

test("naming prey sends the mark with the creature tag picked", async () => {
  const { press, writes } = setup();
  const marked = await press({ action: "cls-mark", target: "stalker", version: 3 }, ["pack"]);
  expect(marked.card.author).toStartWith("Classes");
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 3,
      kind: api.ActMarkPrey,
      server: "guild",
      option: "pack",
    },
  ]);
});

test("only a well-formed draft or a founding press opens a modal", () => {
  expect(modalFor({ action: "g-name", target: "nonsense", version: 1 })).toBeNull();
  expect(modalFor({ action: "gld-found", target: "take", version: 1 })).toBeNull();
  expect(modalFor({ action: "gld-found", target: "new", version: 1 })?.customId).toBe(
    encodeId("gld-chart", "", 1),
  );
  expect(modalFor({ action: "gld-name", target: "", version: 1 })?.customId).toBe(
    encodeId("gld-new", "", 1),
  );
  expect(modalFor({ action: "hub", target: "", version: 1 })).toBeNull();
});

test.each([
  ["goals", "Notice board", api.PathGoals],
  ["guild", "Guild", api.PathGuild],
])("/%s opens its card without a write", async (command, author, path) => {
  const { ctx, writes, reads } = setup();
  const result = await answer(ctx, { user: "someone", interaction: "command", command });
  expect(result.card.author).toStartWith(author);
  expect(reads).toContain(path);
  expect(writes).toEqual([]);
});

test("goal and guild presses send what their targets say, and malformed ones nothing", async () => {
  const { press, writes } = setup();
  await press({ action: "g-wd", target: "q-3", version: 2 });
  await press({ action: "gld-dep", target: "coin:10", version: 3 });
  for (const id of [
    { action: "g-deliver", target: "q-3:ore" },
    { action: "g-pledge", target: "q-3:ten" },
    { action: "gld-dep", target: "coin" },
    { action: "g-post", target: "nonsense" },
  ] as const)
    expect((await press({ ...id, version: 1 })).card.author).toBe("An old button");
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 2,
      kind: api.ActWithdrawGoal,
      server: "guild",
      target: "q-3",
    },
    {
      interactionId: "event",
      characterId: "c-1",
      version: 3,
      kind: api.ActDeposit,
      server: "guild",
      asset: "coin",
      units: 10,
    },
  ]);
});

test("a haul is opened where it ends, off the board it hangs on, and handed in there", async () => {
  const haul: api.Goal = {
    ...GOAL,
    id: "q-7",
    title: "Wire up the road",
    verb: "haul",
    what: "haul 20 Copper wire",
    from: "Gantry Market",
    where: "the tile at 3,-2",
    hauler: "c-1",
    haul: "deliver",
    reward: 10,
    vow: false,
  };
  const { press, writes } = setup({ goals: { settlement: -1, board: [], mine: [haul] } });
  const away = await press({ action: "goals", target: "", version: 4 });
  expect(offered(away.card, "goal")).toEqual(["q-7"]);
  const opened = await press({ action: "goal", target: "mine", version: 4 }, ["q-7"]);
  const handIn = opened.card.rows
    .flatMap((r) => ("buttons" in r ? r.buttons : []))
    .find((b) => b.label === "Deliver the haul");
  const id = handIn?.kind === "page" ? decodeId(handIn.customId) : null;
  expect(id).toMatchObject({ action: "g-deliver", target: "q-7:haul:1" });
  await press(id!);
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: samples.options.version,
      kind: api.ActDeliverGoal,
      server: "guild",
      target: "q-7",
      units: 1,
    },
  ]);
});

test("the board's select turns its page without a write", async () => {
  const board = Array.from({ length: 30 }, (_, i) => ({ ...GOAL, id: `q-${i + 1}` }));
  const { press, writes } = setup({ goals: { board } });
  const turned = await press({ action: "goal", target: "", version: 2 }, ["page:1"]);
  expect(turned.card.author).toStartWith("Notice board");
  expect(offered(turned.card, "goal")).toEqual([...board.slice(24).map((x) => x.id), "page:0"]);
  expect(writes).toEqual([]);
});

test("a server guild's member accepts an invitation from its own guild's page", async () => {
  const { press, writes } = setup({
    guild: { server: true, invites: [{ value: "g-2", label: "The Free Company" }] },
  });
  const page = await press({ action: "guild", target: "members", version: 5 });
  const join = page.card.rows
    .flatMap((r) => ("buttons" in r ? r.buttons : []))
    .find((b) => b.label === "Join The Free Company");
  const id = join?.kind === "page" ? decodeId(join.customId) : null;
  expect(id).toMatchObject({ action: "gld-join", target: "g-2" });
  await press(id!);
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: samples.options.version,
      kind: api.ActJoin,
      server: "guild",
      target: "g-2",
    },
  ]);
});

/** The values a card's select of an action offers. */
const offered = (card: Card, action: string) =>
  card.rows.flatMap((r) =>
    "select" in r && decodeId(r.select.customId)?.action === action
      ? r.select.options.map((x) => x.value)
      : [],
  );

test("the bank takes two picks: what, which writes nothing, then how much, which gives or draws it", async () => {
  const { press, writes } = setup({ purse: { coin: 60, provisions: 8, goods: [] } });
  const write = (kind: string, fields: Partial<api.ActionRequest>) => ({
    interactionId: "event",
    characterId: "c-1",
    version: 7,
    kind,
    server: "guild",
    ...fields,
  });
  const bank = await press({ action: "guild", target: "bank", version: 7 });
  expect(bank.card.author).toEndWith("Bank");
  expect(offered(bank.card, "gld-give")).toEqual(["coin", "provisions"]);
  expect(offered(bank.card, "gld-take")).toEqual(["old-silk"]);
  expect(offered(bank.card, "gld-dep")).toEqual([]);

  const giving = await press({ action: "gld-give", target: "", version: 7 }, ["provisions"]);
  expect(offered(giving.card, "gld-dep")).toEqual(["provisions:1", "provisions:5", "provisions:8"]);
  const drawing = await press({ action: "gld-take", target: "", version: 7 }, ["old-silk"]);
  expect(offered(drawing.card, "gld-draw")).toEqual(["old-silk:1", "old-silk:2"]);
  expect(writes).toEqual([]);

  const given = await press({ action: "gld-dep", target: "", version: 7 }, ["provisions:8"]);
  expect(given.card.title).toBe("Given to the guild");
  expect(given.card.author).toEndWith("Bank");
  const drawn = await press({ action: "gld-draw", target: "", version: 7 }, ["old-silk:2"]);
  expect(drawn.card.title).toBe("Drawn at cost");
  expect(writes).toEqual([
    write(api.ActDeposit, { asset: "provisions", units: 8 }),
    write(api.ActDraw, { asset: "old-silk", units: 2 }),
  ]);
  for (const [action, picked] of [
    ["gld-dep", "provisions"],
    ["gld-dep", "provisions:some"],
    ["gld-draw", "old-silk:"],
    ["gld-draw", ""],
  ] as const)
    expect((await press({ action, target: "", version: 7 }, [picked])).card.author).toBe(
      "An old button",
    );
  expect(writes).toHaveLength(2);
});

test("an officer pays a member what was picked, and is told when it waits for a second officer", async () => {
  const { press, writes } = setup();
  const picked = await press({ action: "gld-pay", target: "c-1", version: 4 }, ["old-silk"]);
  expect(picked.card.author).toEndWith("A member");
  const amounts = picked.card.rows.flatMap((r) =>
    "select" in r && decodeId(r.select.customId)?.target === "pay:c-1:old-silk"
      ? r.select.options.map((x) => x.value)
      : [],
  );
  expect(amounts).toEqual(["1", "3"]);
  expect(writes).toEqual([]);
  const paid = await press({ action: "gld-act", target: "pay:c-1:old-silk", version: 4 }, ["3"]);
  expect(paid.card.title).toBe("Paid");
  await press({ action: "gld-act", target: "pay:c-1:coin", version: 5 }, ["250"]);
  const pay = (version: number, asset: string, units: number) => ({
    interactionId: "event",
    characterId: "c-1",
    version,
    kind: api.ActPay,
    server: "guild",
    target: "c-1",
    asset,
    units,
  });
  expect(writes).toEqual([pay(4, "old-silk", 3), pay(5, "coin", 250)]);
  for (const value of ["", "all", "2.5"])
    expect(
      (await press({ action: "gld-act", target: "pay:c-1:coin", version: 5 }, [value])).card.author,
    ).toBe("An old button");
  expect(writes).toHaveLength(2);

  const asked = setup({
    facts: [{ id: 9, tick: 1, kind: "guild.approval-asked", weight: 0, subjects: [], data: [] }],
  });
  const waits = await asked.press({ action: "gld-act", target: "pay:c-1:coin", version: 5 }, [
    "250",
  ]);
  expect(waits.card.title).toBe("Over what you may pay alone today: it waits for a second officer");
});

test("a raise takes two picks: the structure, which writes nothing, then the reward on each of its goals", async () => {
  const { press, writes } = setup();
  const picked = await press({ action: "gld-raise", target: "", version: 6 }, [RAISED]);
  expect(picked.card.author).toEndWith("Settlements");
  expect(offered(picked.card, "gld-rwd")).toEqual(["0", "10", "25"]);
  expect(writes).toEqual([]);
  const raise = (fields: Partial<api.ActionRequest>) => ({
    interactionId: "event",
    characterId: "c-1",
    version: 6,
    kind: api.ActRaise,
    server: "guild",
    slot: RAISED,
    ...fields,
  });
  const posted = await press({ action: "gld-rwd", target: RAISED, version: 6 }, ["25"]);
  expect(posted.card.title).toBe("Its goals are on the board");
  await press({ action: "gld-rwd", target: RAISED, version: 6 }, ["0"]);
  expect(writes).toEqual([raise({ price: 25 }), raise({})]);
  for (const [target, value] of [
    [RAISED, ""],
    [RAISED, "-5"],
    [RAISED, "lots"],
    ["", "25"],
  ] as const)
    expect((await press({ action: "gld-rwd", target, version: 6 }, [value])).card.author).toBe(
      "An old button",
    );
  expect(writes).toHaveLength(2);
});

test("a Hold and an ephemeral goal post with the gauge, side, line and time the form picked", async () => {
  const { press, writes } = setup();
  const held = {
    ...BLANK,
    verb: "hold",
    target: "region:r-3",
    count: 5,
    reward: 0,
    narrow: "unrest",
    least: 600,
    below: false,
    ticks: 36,
  };
  const form = await press({ action: "g-least", target: "", version: 2 }, [goalDraftId(held)]);
  expect(form.card.title).toBe("Hold 5 days: region:r-3, above 600 unrest");
  expect(writes).toEqual([]);
  await press({ action: "g-post", target: goalDraftId(held), version: 2 });
  expect(writes).toHaveLength(1);
  expect(writes[0]!.goal).toMatchObject({
    lifetime: "ephemeral",
    ticks: 36,
    cond: { verb: "hold", count: 5, at: "region:r-3", gauge: "unrest", line: 600 },
  });
  expect(writes[0]!.goal!.cond.below).toBeUndefined();
});

test("a repair pick that names no structure and points writes nothing", async () => {
  const { press, writes } = setup();
  for (const picked of ["forge", "forge:all", ""])
    expect(
      (await press({ action: "gld-mend", target: "", version: 1 }, [picked])).card.author,
    ).toBe("An old button");
  expect(writes).toEqual([]);
});

test("Leave asks first: its press opens the confirming card and writes nothing", async () => {
  const { press, writes, reads } = setup();
  const asked = await press({ action: "gld-leave", target: "", version: 1 });
  expect(asked.card.title).toStartWith("Leave ");
  expect(reads).toContain(api.PathGuild);
  expect(writes).toEqual([]);
});

test("an expired hub is retired and its accepted gather opens a fresh private card", async () => {
  const { ctx, writes } = setup();
  const { interaction, now } = button(encodeId("gather", "ore:2", 7), HUB_TTL_MS + 500);
  const onLong = mock(() => {});
  await createHandler({
    ctx,
    budget: localBudget(),
    now: () => now,
    onLong,
    media: async () => new Uint8Array([1]),
  })(interaction as unknown as Interaction);
  expect(interaction.update).toHaveBeenCalledWith({
    content: MOVED_LINE,
    components: [],
    embeds: [],
    files: [],
  });
  expect(interaction.followUp).toHaveBeenCalledWith(
    expect.objectContaining({ flags: MessageFlags.Ephemeral, files: expect.any(Array) }),
  );
  expect(onLong).toHaveBeenCalledWith("someone", "c-1");
  expect(writes).toHaveLength(1);
});

test("unrecognized, rate-limited and offline presses give private feedback", async () => {
  const { ctx, writes } = setup({ offline: true });
  const handle = createHandler({
    ctx,
    budget: localBudget({ limit: 1, windowMs: 10000 }),
    media: async () => new Uint8Array(),
    log: () => {},
  });
  for (const [id, line] of [
    ["obsolete", STALE_LINE],
    [encodeId("hub"), DOWN_LINE],
    [encodeId("hub"), SLOW_LINE],
  ] as const) {
    const { interaction } = button(id);
    await handle(interaction as unknown as Interaction);
    if (line === DOWN_LINE) expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(line === DOWN_LINE ? interaction.followUp : interaction.reply).toHaveBeenCalledWith({
      content: line,
      flags: MessageFlags.Ephemeral,
    });
  }
  expect(writes).toEqual([]);
});

test.each([
  ["character", "Character", api.PathSheet],
  ["recipes", "Recipes", api.PathRecipes],
  ["map", "Travel", api.PathMap],
])("/%s opens its own card without changing the character", async (command, author, path) => {
  const { ctx, writes, reads } = setup();
  const result = await answer(ctx, { user: "someone", interaction: "command", command });
  expect(result.character).toBe("c-1");
  expect(result.card.author).toStartWith(author);
  expect(reads).toContain(path);
  expect(writes).toEqual([]);
});

test("appraisal previews the exact recipe later sent by its Commit button", async () => {
  const { ctx, writes, appraisals, press } = setup();
  const preview = await press({
    action: "craft-q",
    target: "shape.narrow-grind.tool.cinder-ore.1",
    version: 9,
  });
  const recipe = {
    process: "shape",
    method: "narrow-grind",
    slot: "tool",
    inputs: [{ material: "cinder-ore", units: 1 }],
  };
  expect(appraisals).toEqual([{ characterId: "c-1", recipe }]);
  expect(writes).toEqual([]);
  expect(preview.card.title).toBe(samples.appraise.name);
  const commit = preview.card.rows
    .flatMap((row) => ("buttons" in row ? row.buttons : []))
    .find((b) => b.label === "Commit");
  if (commit?.kind !== "page") throw new Error("Missing Commit button");
  const id = decodeId(commit.customId);
  if (!id) throw new Error("Invalid Commit button");
  const result = await answer(ctx, { id, user: "someone", interaction: "confirmed" });
  expect(writes).toEqual([
    {
      characterId: "c-1",
      kind: "craft",
      version: samples.options.version,
      interactionId: "confirmed",
      recipe,
    },
  ]);
  expect(result.card.author).toBe("First discovery and naming");
});

test("pressing a combat option shows the outcome when no encounter remains", async () => {
  const { writes, press } = setup();
  const result = await press({ action: "press", target: "strike", version: 12 });
  expect(writes).toEqual([
    {
      characterId: "c-1",
      kind: "press",
      version: 12,
      interactionId: "event",
      option: "strike",
      server: "guild",
    },
  ]);
  expect(result.card.author).toBe("Encounter · the beat resolved");
});

const TINKER = samples.npc.npc.id;
/** The world as each card that leads into the Activity is drawn from it. */
const LEADING: [string, string, Parameters<typeof setup>[0], Id][] = [
  [
    "a machine beat",
    "beat",
    { options: samples["options:machine"] as api.Options },
    { action: "fight", target: "", version: 1 },
  ],
  [
    "the hub on a machine beat",
    "hub",
    { options: samples["options:machine"] as api.Options },
    { action: "hub", target: "", version: 1 },
  ],
  [
    "the hub while a machine is armed",
    "hub",
    { sheet: { ...samples.sheet, character: { ...samples.sheet.character, armed: true } } },
    { action: "hub", target: "", version: 1 },
  ],
  ["the place card at a bench", "where", {}, { action: "where", target: "", version: 1 }],
  [
    "the tinker's card at a bench",
    launchTarget("talk", TINKER),
    {},
    { action: "talk", target: TINKER, version: 1 },
  ],
  [
    "the character card with a pouch",
    "character",
    { sheet: { ...samples.sheet, character: { ...samples.sheet.character, pouches: 1 } } },
    { action: "character", target: "", version: 1 },
  ],
];

test.each(LEADING)(
  "the launch on %s answers with the Activity at once, and never reaches the world",
  async (_name, target, world, open) => {
    const { ctx, press, reads, writes } = setup(world);
    const card = (await press(open)).card;
    const launch = card.rows
      .flatMap((r) => ("buttons" in r ? r.buttons : []))
      .filter((b) => b.kind === "page" && decodeId(b.customId)?.action === "launch");
    expect(launch).toHaveLength(1);
    if (launch[0]?.kind !== "page") throw new Error("the launch is not a button the bot answers");
    expect(decodeId(launch[0].customId)?.target).toBe(target);
    reads.length = 0;
    writes.length = 0;
    const { interaction } = button(launch[0].customId);
    await createHandler({ ctx, budget: localBudget(), media: async () => new Uint8Array([1]) })(
      interaction as unknown as Interaction,
    );
    expect(interaction.launchActivity).toHaveBeenCalledTimes(1);
    for (const other of [
      "deferUpdate",
      "editReply",
      "reply",
      "update",
      "followUp",
      "showModal",
    ] as const)
      expect(interaction[other]).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  },
);

test("a launch is held to the press budget, says so when Discord refuses it, and an unknown one is an old button", async () => {
  const { ctx, reads, writes } = setup();
  const said: string[] = [];
  const handle = createHandler({
    ctx,
    budget: localBudget({ limit: 2, windowMs: 10000 }),
    media: async () => new Uint8Array([1]),
    log: (line) => said.push(line),
  });
  const refused = button(encodeId("launch", "where", 3), 0, {
    launchActivity: mock(async () => {
      throw new Error("Activities are not enabled");
    }),
  });
  await handle(refused.interaction as unknown as Interaction);
  expect(refused.interaction.reply).toHaveBeenCalledWith({
    content: LAUNCH_LINE,
    flags: MessageFlags.Ephemeral,
  });
  expect(refused.interaction.deferUpdate).not.toHaveBeenCalled();
  expect(said.join("\n")).toContain("Activities are not enabled");

  // No card it knows sits behind this target: it is answered as any old button is.
  expect(launchFor({ action: "launch", target: "nowhere", version: 3 })).toBeNull();
  expect(launchFor({ action: "launch", target: "talk", version: 3 })).toBeNull();
  expect(launchFor({ action: "launch", target: "hub/someone", version: 3 })).toBeNull();
  expect(launchFor({ action: "where", target: "", version: 3 })).toBeNull();
  const unknown = button(encodeId("launch", "nowhere", 3));
  await handle(unknown.interaction as unknown as Interaction);
  expect(unknown.interaction.launchActivity).not.toHaveBeenCalled();
  expect(unknown.interaction.deferUpdate).toHaveBeenCalledTimes(1);

  const over = button(encodeId("launch", "where", 3));
  await handle(over.interaction as unknown as Interaction);
  expect(over.interaction.launchActivity).not.toHaveBeenCalled();
  expect(over.interaction.reply).toHaveBeenCalledWith({
    content: SLOW_LINE,
    flags: MessageFlags.Ephemeral,
  });
  expect(writes).toEqual([]);
  expect(reads).not.toContain(api.PathHere);
});

test("the entry point command answers with the Activity", async () => {
  const { ctx, reads, writes } = setup();
  const { interaction } = button("", 0, {
    commandName: "launch",
    isPrimaryEntryPointCommand: () => true,
  });
  await createHandler({ ctx, budget: localBudget(), media: async () => new Uint8Array([1]) })(
    interaction as unknown as Interaction,
  );
  expect(interaction.launchActivity).toHaveBeenCalledTimes(1);
  expect(interaction.deferUpdate).not.toHaveBeenCalled();
  expect([...reads, ...writes]).toEqual([]);
});

test("a launch press that reaches the flow shows the card it sits on, and writes nothing", async () => {
  const { press, writes } = setup({ options: samples["options:machine"] as api.Options });
  const authors = async (target: string) =>
    (await press({ action: "launch", target, version: 1 })).card.author;
  expect(await authors("beat")).toStartWith("Encounter");
  expect(await authors("hub")).toStartWith("Hub");
  expect(await authors("where")).toStartWith("Where I am");
  expect(await authors("character")).toStartWith("Character");
  expect(await authors(launchTarget("talk", TINKER))).toStartWith("tinker");
  expect(await authors("nowhere")).toBe("An old button");
  expect(writes).toEqual([]);
});

test("a machine's option pressed from an old card is refused by the world and the beat is drawn again", async () => {
  const { ctx } = setup({ options: samples["options:machine"] as api.Options });
  const world = {
    ...ctx.world,
    act: async () => ({
      ok: false as const,
      refusal: { code: api.CodeNeedsActivity, message: "a machine is worked in the Activity" },
    }),
  };
  const a = await answer(
    { ...ctx, world },
    {
      id: { action: "press", target: "hack", version: 1 },
      user: "someone",
      guild: "guild",
      interaction: "event",
    },
  );
  expect(a.card.title).toBe("A machine is worked in the Activity");
  const ids = a.card.rows
    .flatMap((r) => ("buttons" in r ? r.buttons : []))
    .map((b) => (b.kind === "page" ? decodeId(b.customId) : null));
  expect(ids.some((id) => id?.action === "launch")).toBe(true);
  expect(ids.some((id) => id?.action === "press" && id.target === "hack")).toBe(false);
});

/** The ids a card offers, by action. */
const offers = (card: Card) =>
  card.rows.flatMap((r) =>
    "select" in r
      ? [decodeId(r.select.customId)!]
      : r.buttons.flatMap((b) => (b.kind === "page" ? [decodeId(b.customId)!] : [])),
  );

test("/chronicle and the hub's Chronicle open the last closed day, and since you left is one press away", async () => {
  const { ctx, press, reads, writes } = setup();
  const opened = await answer(ctx, {
    user: "someone",
    interaction: "command",
    command: "chronicle",
  });
  expect(opened.card.title).toBe("The chronicle of world day 3");
  expect(reads).toEqual(expect.arrayContaining([api.PathChronicle, api.PathArcs]));
  const hub = await press({ action: "hub", target: "", version: 1 });
  const chronicle = offers(hub.card).find((id) => id.action === "chronicle")!;
  expect((await press(chronicle)).card.author).toBe("Chronicle · the world");
  const recap = offers(opened.card).find((id) => id.action === "recap")!;
  expect((await press(recap)).card.author).toBe("Chronicle · since you left");
  expect(writes).toEqual([]);
});

test("an earlier day and a line's causes are read by what the selects carry", async () => {
  const { press, queries, writes } = setup();
  await press({ action: "chronicle", target: "", version: 2 }, ["1"]);
  expect(queries.find((q) => q.has("day"))?.get("day")).toBe("1");
  const fact = await press({ action: "c-fact", target: "", version: 2 }, ["903"]);
  expect(fact.card.author).toBe("Chronicle · a fact and its causes");
  expect(queries.find((q) => q.has("id"))?.get("id")).toBe("903");
  expect((await press({ action: "c-fact", target: "", version: 2 }, ["x"])).card.author).toBe(
    "An old button",
  );
  expect(writes).toEqual([]);
});

test("before any world day closes the chronicle says so, and still lists the arcs running", async () => {
  const { ctx } = setup({ missing: [api.PathChronicle] });
  const a = await answer(ctx, { user: "someone", interaction: "command", command: "chronicle" });
  expect(a.card.title).toBe("No world day has closed yet");
  expect(offers(a.card).some((id) => id.action === "arc")).toBe(true);
});

test("a posted stage's Back opens the presser's own stage card without a write", async () => {
  const { press, writes } = setup({ options: mm9.withSides });
  const stage = await press({ action: "s-back", target: mm9.besiegers.goal, version: 0 });
  expect(stage.card.title).toBe(mm9.siege.title);
  expect(stage.card.context).toContain("only you");
  const ids = offers(stage.card);
  expect(ids).toContainEqual({ action: "s-decl", target: mm9.besiegers.goal, version: 49 });
  expect(ids).toContainEqual({
    action: "s-give",
    target: `${mm9.garrison.goal}:provisions`,
    version: 49,
  });
  expect(writes).toEqual([]);
});

test("declaring for a beats side sends the side's goal and no goods", async () => {
  const { press, writes } = setup({ options: mm9.withSides });
  const a = await press({ action: "s-decl", target: mm9.besiegers.goal, version: 7 });
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 7,
      kind: api.ActBackSide,
      server: "guild",
      target: mm9.besiegers.goal,
    },
  ]);
  expect(a.card.title).toStartWith("You back it");
});

test("a goods side's Back opens an amount modal, and its submit gives that many", async () => {
  const { ctx, writes } = setup({ options: mm9.withSides });
  const give = { action: "s-give", target: `${mm9.garrison.goal}:provisions`, version: 7 } as const;
  const modal = modalFor(give)!;
  expect(modal.customId).toBe(encodeId("s-gave", give.target, 7));
  const submit = (units: string) =>
    answer(ctx, {
      id: decodeId(modal.customId)!,
      fields: { units },
      user: "someone",
      guild: "guild",
      interaction: "event",
    });
  const refused = await submit("lots");
  expect(refused.card.title).toBe("Give a whole number of units, 1 or more");
  expect(writes).toEqual([]);
  const given = await submit(" 5 ");
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 7,
      kind: api.ActBackSide,
      server: "guild",
      target: mm9.garrison.goal,
      asset: "provisions",
      units: 5,
    },
  ]);
  expect(given.card.title).toBe("Given: 5 provisions");
  expect(modalFor({ action: "s-give", target: mm9.garrison.goal, version: 7 })).toBeNull();
});

test("the trouble at the place opens from the hub's urgent row, with its hunt", async () => {
  const { press, writes } = setup({ here: mm9.raided });
  const hub = await press({ action: "hub", target: "", version: 1 });
  const trouble = offers(hub.card).find((id) => id.action === "trouble")!;
  const card = (await press(trouble)).card;
  expect(card.author).toStartWith("Trouble");
  expect(offers(card)).toContainEqual({ action: "hunt", target: mm9.trouble.hunt!, version: 49 });
  expect(writes).toEqual([]);
});

test("an arc that is over, or none at all, lands on the place card", async () => {
  const { press } = setup({ arcs: { ...mm9.arcs, open: [], ended: [] } });
  const a = await press({ action: "arc", target: "a-99", version: 1 });
  expect(a.card.title).toBe("That arc is over");
});

test("a pattern's point is set from the place card's select, at the tile stood on", async () => {
  const { press, writes } = setup({ here: mm9.onPoint });
  const where = await press({ action: "where", target: "", version: 1 });
  const set = offers(where.card).find((id) => id.action === "p-set")!;
  await press(set, ["2"]);
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 49,
      kind: api.ActPatternSet,
      server: "guild",
      to: (samples.options as api.Options).at,
      units: 2,
    },
  ]);
  expect((await press(set, ["-1"])).card.author).toBe("An old button");
  expect(writes).toHaveLength(1);
});

test("Raise to a city posts the city project, and the raid alarm is the adapter's to answer", async () => {
  const { press, writes } = setup();
  await press({ action: "gld-city", target: "", version: 4 });
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: 4,
      kind: api.ActCityRaise,
      server: "guild",
    },
  ]);
  expect(roleFor({ action: "alarm", target: "", version: 0 })).toBe("alarm");
  expect(roleFor({ action: "hub", target: "", version: 0 })).toBeNull();
  expect((await press({ action: "alarm", target: "", version: 0 })).card.author).toStartWith("Hub");
  expect(writes).toHaveLength(1);
});

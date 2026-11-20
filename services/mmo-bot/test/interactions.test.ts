import { expect, mock, test } from "bun:test";

import { MessageFlags, SnowflakeUtil, type Interaction } from "discord.js";

import {
  createHandler,
  DOWN_LINE,
  HUB_TTL_MS,
  MOVED_LINE,
  SLOW_LINE,
  STALE_LINE,
} from "../src/adapter.ts";
import * as api from "../src/api.ts";
import { localBudget } from "../src/cooldown.ts";
import { answer, modalFor } from "../src/flow.ts";
import { decodeId, encodeId, type Id } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { BLANK, goalDraftId, specOf } from "../src/screens/goals.ts";
import { httpWorld } from "../src/world.ts";
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
};

function setup({ player = "c-1", stale = false, offline = false } = {}) {
  const writes: api.ActionRequest[] = [];
  const reads: string[] = [];
  const appraisals: api.AppraiseRequest[] = [];
  const routes = new Map<string, unknown>([
    [api.PathPlayer, { characterId: player }],
    [api.PathOptions, samples.options],
    [api.PathHere, samples.here],
    [api.PathSheet, samples.sheet],
    [api.PathMap, samples.map],
    [api.PathRecap, samples.recap],
    [api.PathRecipes, samples.recipes],
    // The recorded pages predate a few served fields.
    [api.PathGoals, { ...samples.goals, ...GOALS_SINCE }],
    [api.PathGuild, { ...samples.guild, bankHere: true }],
    [api.PathClasses, samples.classes],
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
        // A mark was never recorded: it answers as any plain write does.
        const kind = body.kind === api.ActMarkPrey ? api.ActLook : body.kind;
        const action = samples[`act:${kind}` as keyof typeof samples];
        if (!action || !("reply" in action)) throw new Error("unexpected action " + body.kind);
        return Response.json(action.reply);
      }
      if (url.pathname === api.PathAppraise && init?.method === "POST") {
        appraisals.push(JSON.parse(String(init.body)));
        return Response.json(samples.appraise);
      }
      reads.push(url.pathname);
      expect(
        url.searchParams.get(url.pathname === api.PathPlayer ? "discordId" : "characterId"),
      ).toBe(url.pathname === api.PathPlayer ? "someone" : "c-1");
      if (!routes.has(url.pathname)) throw new Error("unexpected path " + url.pathname);
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
    },
  });
  const ctx = { world, lex, threatLine: 600 };
  const press = (id: Id, values?: string[]) =>
    answer(ctx, { id, values, user: "someone", guild: "guild", interaction: "event" });
  return { writes, reads, appraisals, ctx, press };
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

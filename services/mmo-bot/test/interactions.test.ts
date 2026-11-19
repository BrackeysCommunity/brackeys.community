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
import { answer } from "../src/flow.ts";
import { decodeId, encodeId, type Id } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { httpWorld } from "../src/world.ts";
import samples from "./fixtures/world.json";

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
        const key = `act:${body.kind}` as keyof typeof samples;
        const action = samples[key];
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

function button(customId: string, age = 0) {
  const now = Date.now();
  const interaction = {
    user: { id: "someone" },
    id: "event",
    guildId: "guild",
    customId,
    message: { id: SnowflakeUtil.generate({ timestamp: now - age }).toString() },
    isPrimaryEntryPointCommand: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    deferUpdate: mock(async () => {}),
    editReply: mock(async (_value: unknown) => {}),
    reply: mock(async (_value: unknown) => {}),
    update: mock(async (_value: unknown) => {}),
    followUp: mock(async (_value: unknown) => {}),
  };
  return { interaction, now };
}

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
    { characterId: "c-1", kind: "press", version: 12, interactionId: "event", option: "strike" },
  ]);
  expect(result.card.author).toBe("Encounter · the beat resolved");
});

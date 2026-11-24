import {
  fixedSwitch,
  memoryStore,
  type ModelCall,
  type NarrationModel,
  Narrator,
  type NarratorDeps,
  stubModel,
  type StubMode,
} from "../../../../packages/mmo-narrate/src/index.ts";
import * as api from "../../src/api.ts";
import { answer, type Ctx } from "../../src/flow.ts";
import type { Id } from "../../src/ids.ts";
import { Lexicon } from "../../src/lexicon.ts";
import { dayClock } from "../../src/narration/hooks.ts";
import { nameOffers } from "../../src/narration/names.ts";
import type { World } from "../../src/world.ts";
import * as mm8 from "./mm8.ts";
import * as mm10 from "./mm10.ts";
import samples from "./world.json";

/**
 * Naming at discovery as the bot meets it: a kind its first maker may
 * still name, the craft that discovered it, the recap's promotion and a
 * dungeon cleared first, a world that keeps every write, and narrators
 * over the stub or a model that holds every typed name.
 */

export const lex = new Lexicon(
  mm10.lexicon({
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
  }),
);
export const names = lex.goodsNames();

export const DAY = 9;
export const o = samples.options as api.Options;
const base = samples.recipes as api.Recipes;

/** The first known kind, made first by the viewer and still theirs to name. */
export const kind: api.Known = { ...base.known[0]!, renamable: true };
export const recipes: api.Recipes = { ...base, known: [kind, ...base.known.slice(1)] };
export const named: api.Recipes = {
  ...base,
  known: [{ ...kind, name: "Rust Tooth", renamable: false }, ...base.known.slice(1)],
};

const crafted = (samples["act:craft"] as { reply: api.ActionReply }).reply;
/** The craft that discovered the kind and made it. */
export const craft: api.ActionReply = {
  ...crafted,
  facts: crafted.facts.filter((f) => f.kind !== "craft.failed"),
};

export const promotion = mm10.style;
export const recap: api.Recap = { ...mm10.recap, day: DAY };

/** A dungeon the viewer's party slew first, still unnamed. */
export const dungeonHere = mm8.named;
export const dungeon = mm8.named.floor!.dungeon;

/** The world's refusals of a kind's name. */
export const kindRefusals: [string, api.Refusal][] = [
  ["no-such-row", { code: api.CodeNoSuchRow, message: 'no kind "x" to name' }],
  ["not-first", { code: api.CodeNotFirst, message: "only Chips tool's first maker names it" }],
  ["named", { code: api.CodeNamed, message: "it is named Rust Tooth" }],
  ["name-closed", { code: api.CodeNameClosed, message: "Chips tool could be named for 7 days" }],
  ["bad-name", { code: api.CodeBadName, message: "a name is 1 to 60 characters the board takes" }],
];

/** A model that holds every name it screens, and answers every other use with its stub. */
export function holdingModel(): NarrationModel & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    calls,
    async complete(call) {
      calls.push(call);
      const text = call.use === "screen" ? '{"verdict":"hold"}' : JSON.stringify(call.stub);
      return { text, stop: "end", usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 } };
    },
  };
}

/** A narrator over a memory store with every switch on. */
export function narratorOf(
  model: NarrationModel,
  config?: NarratorDeps["config"],
): { narrator: Narrator; store: ReturnType<typeof memoryStore> } {
  const store = memoryStore();
  const narrator = new Narrator({
    model,
    store,
    switch: fixedSwitch(true),
    dayUsd: 1,
    log: () => {},
    config,
  });
  return { narrator, store };
}

export function stubNarrator(mode: StubMode = "good", config?: NarratorDeps["config"]) {
  const model = stubModel({ mode, delayMs: 40 });
  return { model, ...narratorOf(model, config) };
}

const recorded = samples.guild as unknown as api.Guild;
/** The recorded guild, standing in none of its settlements. */
const guild: api.Guild = {
  ...recorded,
  settlements: recorded.settlements.map((x) => ({ ...x, here: false, city: { city: false } })),
};

/** A world whose reads are fixed and whose writes are kept; a refusal answers every write when set. */
export function namingWorld(
  opts: {
    narrator?: Narrator | null;
    store?: ReturnType<typeof memoryStore>;
    here?: api.Here;
    recipes?: api.Recipes;
    refusal?: api.Refusal;
    guild?: string;
  } = {},
) {
  const writes: api.ActionRequest[] = [];
  const reads: string[] = [];
  const read =
    <T>(name: string, v: T) =>
    async () => {
      reads.push(name);
      return v;
    };
  const world = {
    player: read("player", "c-1"),
    options: read("options", opts.here === dungeonHere ? mm8.o : o),
    here: read("here", opts.here ?? (samples.here as api.Here)),
    sheet: read("sheet", samples.sheet as api.Sheet),
    hunts: read("hunts", { tick: 13, every: 1, hunts: [] }),
    recipes: read("recipes", opts.recipes ?? recipes),
    recap: read("recap", recap),
    party: read("party", mm8.alone),
    guild: read("guild", guild),
    async act(req: api.ActionRequest) {
      writes.push(req);
      if (opts.refusal) return { ok: false as const, refusal: opts.refusal };
      if (req.kind === api.ActCraft) return { ok: true as const, reply: craft };
      return {
        ok: true as const,
        reply: (samples["act:look"] as { reply: api.ActionReply }).reply,
      };
    },
  } as unknown as World;
  const ctx: Ctx = {
    world,
    lex,
    threatLine: 600,
    narrator: opts.narrator ?? null,
    day: dayClock(DAY),
    names: nameOffers(opts.narrator ?? null, opts.store ?? null, () => {}),
  };
  const press = (id: Id, fields?: Record<string, string>) =>
    answer(ctx, {
      id,
      fields,
      user: "someone",
      guild: opts.guild ?? "guild",
      interaction: "event",
    });
  return { world, ctx, writes, reads, press };
}

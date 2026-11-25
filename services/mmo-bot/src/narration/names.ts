import {
  digestOf,
  KEY_PREFIX,
  type NarrateCtx,
  type NarrationStore,
  type Narrator,
  USE_CONFIG,
  type UseId,
} from "../../../../packages/mmo-narrate/src/index.ts";
import { type NameSubject, namesUse } from "../../../../packages/mmo-narrate/src/uses/names.ts";
import { screenKey, screenUse } from "../../../../packages/mmo-narrate/src/uses/screen.ts";
import type * as api from "../api.ts";
import { type Lexicon, readable } from "../lexicon.ts";
import { factStr } from "../screens/common.ts";
import { dungeonName } from "../screens/dungeon.ts";
import { tagName } from "../screens/emergence.ts";

export type { NameSubject } from "../../../../packages/mmo-narrate/src/uses/names.ts";

/** Held names, newest first, until a person reads them. */
export const HELD_KEY = `${KEY_PREFIX}held`;
/** structural: the held list keeps the last this many. */
export const HELD_KEEP = 500;
const HELD_SEEN_TTL: number = (() => {
  const ttl = USE_CONFIG.screen.ttlSeconds;
  if (ttl === null) throw new Error("the screen use keeps no ttl");
  return ttl;
})();

/** What a thing is and came from, in words: the names prompt's facts. */
export interface NameFacts {
  traits: string[];
  lineage: string[];
  tier?: number;
}

/** What a kind is and is made of, in words, as its names are asked for. */
export function kindNameFacts(k: api.Known, lex: Lexicon): NameFacts {
  const lower = (s: string) => s.toLowerCase();
  return {
    traits: [
      lower(lex.name("items.processes", k.recipe.process)),
      lower(lex.name("items.methods", k.recipe.method)),
      ...(k.recipe.slot ? [lower(lex.name("items.slots", k.recipe.slot))] : []),
    ],
    lineage: k.recipe.inputs.map((i) => lower(lex.material(i.material))),
  };
}

/** A promotion's name now and its facts, from the fact that promoted it. */
export function promotionNaming(f: api.Fact, lex: Lexicon): { plain: string; facts: NameFacts } {
  const resists = factStr(f, "resists");
  const of = factStr(f, "of");
  return {
    plain: factStr(f, "name") || readable(factStr(f, "type")),
    facts: {
      traits: [factStr(f, "type"), ...(resists ? [tagName(resists, lex)] : [])].filter(Boolean),
      lineage: of ? [readable(of).toLowerCase()] : [],
    },
  };
}

/** A dungeon's name now and its facts, from the floor the player stands on. */
export function dungeonNaming(
  f: NonNullable<api.Here["floor"]>,
  lex: Lexicon,
): { plain: string; facts: NameFacts } {
  const kind = lex.name("map.dungeons", f.kind).toLowerCase();
  return {
    plain: dungeonName(f, lex),
    facts: { traits: [kind, ...(f.up ? ["relay tower"] : [])], lineage: [] },
  };
}

export interface NameCtx {
  /** The world day, from the bot's day clock. */
  day: number;
  /** The guild the press came from; "" in a DM, where the switch is off. */
  server: string;
  user: string;
  /** cached: only what is already cached, never a model call. */
  mode?: "call" | "cached";
}

/** Which own-name submit a screen is for, and its row, as the held list records it. */
export interface ScreenCtx extends NameCtx {
  use: NameSubject | "guild" | "settlement";
  target: string;
}

export interface NameOffer {
  names: string[];
  description?: string;
}

export interface HeldName {
  use: ScreenCtx["use"];
  user: string;
  target: string;
  name: string;
  day: number;
  /** The guild it was typed in, "" in a DM; entries held before the queue have none. */
  guild?: string;
}

export interface NameOffers {
  /** Three suggestions and a description, or null; never waits past the use's wait. */
  suggest(
    subject: NameSubject,
    id: string,
    plain: string,
    facts: NameFacts,
    ctx: NameCtx,
  ): Promise<NameOffer | null>;
  /** allow, unless the screen holds the name; a hold is recorded for a person to read. */
  screen(name: string, ctx: ScreenCtx): Promise<"allow" | "hold">;
}

/** The value, or `late` once ms pass; the work runs on either way. */
async function within<T>(work: Promise<T>, ms: number, late: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Names at discovery and the screen on a typed name. With no narrator
 * there are no suggestions and every name is allowed: the world's word
 * list stays the authority on what a name may be. Suggestions are
 * buttons a player presses, so model text reaches the world only as a
 * name a player could have typed.
 */
export function nameOffers(
  narrator: Narrator | null,
  held: NarrationStore | null = null,
  log: (line: string) => void = console.warn,
): NameOffers {
  const waitOf = (use: UseId) => {
    const cfg = narrator!.config(use);
    return cfg.waitMs ?? cfg.timeoutMs;
  };
  const narrateCtx = (ctx: NameCtx): NarrateCtx => ({
    day: ctx.day,
    server: ctx.server,
    player: ctx.user,
    mode: ctx.mode,
  });

  return {
    async suggest(subject, id, plain, facts, ctx) {
      if (!narrator) return null;
      const input = { subject, id, plain, ...facts };
      const work = narrator
        .narrate(namesUse, input, narrateCtx(ctx))
        .then((r) => (r.ok ? r.value : null))
        .catch(() => null);
      const out = await within(work, waitOf("names"), null);
      return out ? { names: [...out.names], description: out.description || undefined } : null;
    },

    async screen(name, ctx) {
      if (!narrator) return "allow";
      const work = narrator
        .narrate(screenUse, { name }, narrateCtx(ctx))
        .then((r) => (r.ok ? r.value : "allow"))
        .catch((): "allow" => "allow");
      const verdict = await within(work, waitOf("screen"), "allow" as const);
      if (verdict !== "hold") return "allow";
      const entry: HeldName = {
        use: ctx.use,
        user: ctx.user,
        target: ctx.target,
        name,
        day: ctx.day,
        guild: ctx.server,
      };
      try {
        if (!held) throw new Error("no store for held names");
        // One player resubmitting a held name records it once, so others' holds stay in the list.
        const seen = `${HELD_KEY}:seen:${digestOf({ use: ctx.use, user: ctx.user, target: ctx.target, name: screenKey(name) })}`;
        if (await held.claim(seen, HELD_SEEN_TTL)) {
          await held.push(HELD_KEY, JSON.stringify(entry), HELD_KEEP);
        }
      } catch (e) {
        log(
          `[narration] a held ${ctx.use} name was not recorded: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return "hold";
    },
  };
}

import {
  KEY_PREFIX,
  type NarrateCtx,
  type NarrationStore,
  type Narrator,
  type UseId,
} from "../../../../packages/mmo-narrate/src/index.ts";
import { type NameSubject, namesUse } from "../../../../packages/mmo-narrate/src/uses/names.ts";
import { screenUse } from "../../../../packages/mmo-narrate/src/uses/screen.ts";

export type { NameSubject } from "../../../../packages/mmo-narrate/src/uses/names.ts";

/** Held names, newest first, until a person reads them (MM12 adds the queue). */
export const HELD_KEY = `${KEY_PREFIX}held`;
/** structural: the held list keeps the last this many. */
export const HELD_KEEP = 500;

/** What a thing is and came from, in words: the names prompt's facts. */
export interface NameFacts {
  traits: string[];
  lineage: string[];
  tier?: number;
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
      };
      try {
        if (!held) throw new Error("no store for held names");
        await held.push(HELD_KEY, JSON.stringify(entry), HELD_KEEP);
      } catch (e) {
        log(
          `[narration] a held ${ctx.use} name was not recorded: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return "hold";
    },
  };
}

import type { Redis } from "ioredis";

import {
  type NarrationModel,
  type NarrationStore,
  Narrator,
  type Switch,
} from "../../../../packages/mmo-narrate/src/index.ts";
import type { Config } from "../config.ts";
import type { Ctx } from "../flow.ts";
import type { Lexicon } from "../lexicon.ts";
import { anthropicModel } from "./anthropic.ts";
import { createNarration, dayClock } from "./hooks.ts";
import { nameOffers } from "./names.ts";
import { redisNarrationStore } from "./redis.ts";
import { storyNarration } from "./story.ts";
import { redisSwitch } from "./switch.ts";
import { voiceNarration } from "./voice.ts";

export { withProse } from "./card.ts";
export { createNarration, type DayClock, dayClock, type Narration, offNarration } from "./hooks.ts";

/**
 * The bot's narrator, only when the key, Redis and MMO_NARRATION=on are
 * all there; otherwise null, and every use is its template. Without Redis
 * there is no cache, budget or cap, so the bot fails closed.
 */
export function narratorFor(
  config: Pick<Config, "anthropicKey" | "narration" | "narrationDayUsd">,
  redis: Redis | null,
  log: (line: string) => void = console.log,
  model: (apiKey: string) => NarrationModel = anthropicModel,
  sw?: Switch,
): Narrator | null {
  if (!config.narration || !config.anthropicKey || !redis) return null;
  return new Narrator({
    model: model(config.anthropicKey),
    store: redisNarrationStore(redis),
    switch: sw ?? redisSwitch(redis, true),
    dayUsd: config.narrationDayUsd,
    log,
  });
}

/** The narration parts of a Ctx over one narrator and store; every use is its template without both. */
export function narrationParts(
  narrator: Narrator | null,
  store: NarrationStore | null,
  lex: Lexicon,
  opts: { sw?: Switch; log?: (line: string) => void } = {},
): Required<Pick<Ctx, "narration" | "narrator" | "names" | "day">> {
  const day = dayClock();
  const narration = createNarration(
    narrator && store
      ? { ...storyNarration(narrator, lex, day), ...voiceNarration(narrator, store, lex, opts.sw) }
      : {},
    opts.log,
  );
  return { narration, narrator, names: nameOffers(narrator, store, opts.log), day };
}

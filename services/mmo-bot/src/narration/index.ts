import type { Redis } from "ioredis";

import { type NarrationModel, Narrator } from "../../../../packages/mmo-narrate/src/index.ts";
import type { Config } from "../config.ts";
import { anthropicModel } from "./anthropic.ts";
import { redisNarrationStore } from "./redis.ts";
import { redisSwitch } from "./switch.ts";

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
): Narrator | null {
  if (!config.narration || !config.anthropicKey || !redis) return null;
  return new Narrator({
    model: model(config.anthropicKey),
    store: redisNarrationStore(redis),
    switch: redisSwitch(redis, true),
    dayUsd: config.narrationDayUsd,
    log,
  });
}

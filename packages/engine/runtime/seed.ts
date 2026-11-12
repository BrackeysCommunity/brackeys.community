import type { Registry } from "../game/types";
import { Rng, seedFromString } from "../sim-kit/rng";

/** `seedFromString("<gameId or engine>:<sceneName>")`: the seed of every run that names none. */
export function defaultSeed(gameId: string | null, sceneName: string): number {
  return seedFromString(`${gameId ?? "engine"}:${sceneName}`);
}

/** The `EngineContext.random` a load of `sceneName` starts with, seeded by `seed` or the default. */
export function runRandom(registry: Registry, sceneName: string, seed?: number | string): Rng {
  return Rng.from(seed ?? defaultSeed(registry.game?.id ?? null, sceneName));
}

import { z } from "zod";

import type { AssetId, Sha256 } from "../project/types";
import type { SceneIssue } from "../scene/types";
import type { EngineContext } from "./types";

/**
 * When a new version of a scene reaches a running game: inside the next load
 * of that scene, after the tick in which game code called
 * `ctx.live.boundary()`, or after the tick during which it finished staging.
 */
export type SwapTiming = "next-load" | "boundary" | "now";

/** Reconcile changes entities in place; reload loads the new version fresh and restores what it can. */
export type SwapStrategy = "reconcile" | "reload";

/** Every swap timing, weakest first: what each schema and wording reads them from. */
export const SWAP_TIMINGS = Object.freeze(["next-load", "boundary", "now"] as const);
export const SWAP_STRATEGIES = Object.freeze(["reconcile", "reload"] as const);

/** Whether `L` lists exactly `T`'s members: the build fails when a timing or strategy is left out. */
type Lists<T extends string, L extends readonly string[]> = [T] extends [L[number]]
  ? [L[number]] extends [T]
    ? true
    : false
  : false;
const listsEvery: [
  Lists<SwapTiming, typeof SWAP_TIMINGS>,
  Lists<SwapStrategy, typeof SWAP_STRATEGIES>,
] = [true, true];
void listsEvery;

export const swapTimingSchema = z.enum(SWAP_TIMINGS);
export const swapStrategySchema = z.enum(SWAP_STRATEGIES);

/** What differs between two expanded versions of a scene, by entity id in scene order. */
export type SceneDiff = {
  added: readonly string[];
  removed: readonly string[];
  changed: readonly string[];
  /** name, bounds or settings differ: the swap reloads. */
  header: boolean;
};

/** One side of a swap: the version (null for the release's own scene) and its hashes. */
export type SwapSide = { version: Sha256 | null; sceneHash: string; runHash: string };

/** What `GameRuntime.onSwap` and the `live:swapped` event receive. */
export type SceneSwap = {
  scene: AssetId;
  /** `version` null: the release's own scene. */
  from: SwapSide;
  to: SwapSide;
  strategy: SwapStrategy;
  /** What survived: everything (reconcile), the world (reload, world depth), or only the game's state and persist. */
  carried: "all" | "world" | "progress";
  diff: SceneDiff;
  timing: SwapTiming;
  /** `ctx.tick` when the swap ran: the next tick to step. */
  tick: number;
};

/** `GameDefinition.live`: which timings the game accepts and what must hold after a swap. */
export type LiveDeclaration = {
  /** "next-load" is always allowed; list "boundary" and "now" to accept them. */
  timings: readonly SwapTiming[];
  /** Invariants the swap check and Live in Play run right after a swap and `LIVE_CHECK_AGAIN_TICKS` later. */
  check?(ctx: EngineContext): readonly SceneIssue[];
};

/** How long staging may take, Live in Play's debounce, and where and how long the swap check runs. */
export const LIVE_DEFAULTS: {
  readonly preloadTimeoutMs: 60_000;
  readonly livePlayDebounceMs: 300;
  readonly checkAt: readonly [0.25, 0.5, 0.75];
  readonly checkTicks: 120;
} = Object.freeze({
  preloadTimeoutMs: 60_000,
  livePlayDebounceMs: 300,
  checkAt: Object.freeze([0.25, 0.5, 0.75] as const),
  checkTicks: 120,
});

/** How many ticks after a swap the game's `live.check` runs a second time. */
export const LIVE_CHECK_AGAIN_TICKS = 60;

/** How a timing reads in a message: `next load`, `boundary` or `now`. */
export const timingWords = (t: SwapTiming): string => (t === "next-load" ? "next load" : t);

/** The timings a game accepts, `next-load` first: the ones it lists, and `next-load`, which every game takes. */
export function acceptedTimings(live: Pick<LiveDeclaration, "timings"> | undefined): SwapTiming[] {
  const listed = live?.timings ?? [];
  return listed.includes("next-load") ? [...listed] : ["next-load", ...listed];
}

/**
 * The timings a game accepts as the words after "this game accepts ",
 * strongest first: `only next load`, or `boundary and next load`.
 */
export function acceptedTimingsWords(live: Pick<LiveDeclaration, "timings"> | undefined): string {
  const accepted = acceptedTimings(live);
  const takes = [...SWAP_TIMINGS].reverse().filter((t) => accepted.includes(t));
  const last = timingWords(takes.at(-1)!);
  return takes.length === 1
    ? `only ${last}`
    : `${takes.slice(0, -1).map(timingWords).join(", ")} and ${last}`;
}

/**
 * What a swap's diff changed, in plain words: `3 entities changed, 1 added,
 * 1 removed`, `the scene's header changed`, or `nothing changed`.
 */
export function diffWords(diff: SceneDiff): string {
  const { changed, added, removed } = diff;
  const parts: string[] = [];
  if (changed.length > 0)
    parts.push(`${changed.length} ${changed.length === 1 ? "entity" : "entities"} changed`);
  if (added.length > 0) parts.push(`${added.length} added`);
  if (removed.length > 0) parts.push(`${removed.length} removed`);
  if (parts.length > 0) return parts.join(", ");
  return diff.header ? "the scene's header changed" : "nothing changed";
}

/** How a version is named where the host's numbers aren't known: `level-1@<first 12 hex>`, or the release's own. */
export const versionName = (scene: AssetId, version: Sha256 | null): string =>
  version === null ? `${scene}'s release version` : `${scene}@${version.slice(0, 12)}`;

/** The strategy a swap of `diff` takes: reload when the header changed or a reload is asked for, else reconcile. */
export const swapStrategyFor = (
  diff: Pick<SceneDiff, "header">,
  wanted?: "auto" | SwapStrategy,
): SwapStrategy => (diff.header || wanted === "reload" ? "reload" : "reconcile");

/**
 * The timing a game gets when `wanted` is asked for: `next-load` is always
 * allowed, and a timing the game doesn't list falls to the strongest listed
 * one below it (`now`, then `boundary`, then `next-load`).
 */
export function clampTiming(
  live: LiveDeclaration | undefined,
  wanted: SwapTiming,
): { timing: SwapTiming; clamped: boolean } {
  const listed = (t: SwapTiming) => t === "next-load" || (live?.timings.includes(t) ?? false);
  let timing = wanted;
  while (!listed(timing)) timing = SWAP_TIMINGS[SWAP_TIMINGS.indexOf(timing) - 1] ?? "next-load";
  return { timing, clamped: timing !== wanted };
}

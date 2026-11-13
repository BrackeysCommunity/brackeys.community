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
  /** Invariants the swap check (and Live in Play) runs right after a swap and 60 ticks later. */
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
  while (!listed(timing)) timing = timing === "now" ? "boundary" : "next-load";
  return { timing, clamped: timing !== wanted };
}

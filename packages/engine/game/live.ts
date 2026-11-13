import { z } from "zod";

import type { AssetId, Sha256 } from "../project/types";
import { plural } from "../scene/plural";
import { hashId } from "../scene/short-id";
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

/** The staging deadline as a refusal reads it: `within 60 s`. */
export const withinPreloadWords = (): string => `within ${LIVE_DEFAULTS.preloadTimeoutMs / 1000} s`;

/** Settles as `work` does, or rejects with `signal`'s reason once it aborts first. */
export function raceSignal<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/**
 * A staging's deadline: `signal` aborts once `LIVE_DEFAULTS.preloadTimeoutMs`
 * passes (`timedOut()` then true) or as soon as `outer` aborts. `clear`
 * stops the clock and lets go of `outer`.
 */
export function preloadDeadline(outer?: AbortSignal): {
  signal: AbortSignal;
  timedOut(): boolean;
  clear(): void;
} {
  const ctl = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    if (ctl.signal.aborted) return;
    late = true;
    ctl.abort("deadline");
  }, LIVE_DEFAULTS.preloadTimeoutMs);
  const forward = () => ctl.abort(outer?.reason);
  if (outer?.aborted) forward();
  else outer?.addEventListener("abort", forward, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => late,
    clear() {
      clearTimeout(timer);
      outer?.removeEventListener("abort", forward);
    },
  };
}

/** How many ticks after a swap the game's `live.check` runs a second time. */
export const LIVE_CHECK_AGAIN_TICKS = 60;

/**
 * Every timing's words: `short` in a row or message (`next load`), `label`
 * on the choice that picks it, `arrival` as a sentence ends.
 */
export const SWAP_TIMING_WORDS: Readonly<
  Record<SwapTiming, Readonly<{ short: string; label: string; arrival: string }>>
> = Object.freeze({
  "next-load": {
    short: "next load",
    label: "Next time the level loads",
    arrival: "the next time the level loads",
  },
  boundary: {
    short: "boundary",
    label: "At the next safe moment the game marks",
    arrival: "at the next safe moment",
  },
  now: { short: "now", label: "Now, while they play", arrival: "now" },
});

/** How a timing reads in a message: `next load`, `boundary` or `now`. */
export const timingWords = (t: SwapTiming): string => SWAP_TIMING_WORDS[t].short;

/** When players get a moved version, as a sentence ends: `the next time the level loads`, `at the next safe moment`, `now`. */
export const arrivalWords = (t: SwapTiming): string => SWAP_TIMING_WORDS[t].arrival;

/** What a promote of release `version` to production asks first, in the editor and on the game page. */
export const releasePromoteMessage = (version: number): string =>
  `Players will get v${version} the next time they open the game. You can roll back at any time.`;

/** What a rollback of production to release `version` asks first; `live` is the release it leaves. */
export const releaseRollbackMessage = (version: number, live: number | null): string =>
  live === null
    ? `Players get v${version} again the next time they open the game.`
    : `Players get v${version} again the next time they open the game. v${live} stays in the list.`;

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
  if (changed.length > 0) parts.push(`${plural(changed.length, "entity", "entities")} changed`);
  if (added.length > 0) parts.push(`${added.length} added`);
  if (removed.length > 0) parts.push(`${removed.length} removed`);
  if (parts.length > 0) return parts.join(", ");
  return diff.header ? "the scene's header changed" : "nothing changed";
}

/** How a version is named where the host's numbers aren't known: `level-1@<first 12 hex>`, or the release's own. */
export const versionName = (scene: AssetId, version: Sha256 | null): string =>
  version === null ? `${scene}'s release version` : `${scene}@${hashId(version)}`;

/** How a host's numbered scene version is named: `level-1@4`, grouped as `level-1@1,000`. */
export const sceneVersionName = (scene: string, number: number): string =>
  `${scene}@${number.toLocaleString("en-US")}`;

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

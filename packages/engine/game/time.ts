import { DEFAULT_TIME } from "./defaults";
import type { Delay } from "./types";

export type TimeKind = "fixed" | "turns" | "event";

export type TimeModel = {
  kind: TimeKind;
  /** Ticks per second: the fixed clock, or the pace of a woken turns/event game while busy. Integer 1–240; default 60. */
  rate?: number;
  /** Time away arrives as one `@elapsed` command, at most `maxMs`. Off when omitted. */
  catchUp?: { maxMs: number };
  /** event only: pointer moves wake the game (hover effects). Default false. */
  wakeOnPointerMove?: boolean;
};

export type ResolvedTime = Readonly<{
  kind: TimeKind;
  rate: number;
  /** 1000 / rate: every tick's dtMs. */
  tickMs: number;
  catchUp: { maxMs: number } | null;
  wakeOnPointerMove: boolean;
}>;

export const MIN_TICK_RATE = 1;
export const MAX_TICK_RATE = 240;

/** The `tick-rate-invalid` message for a bad rate, or null. */
export function tickRateProblem(rate: unknown): string | null {
  if (
    typeof rate === "number" &&
    Number.isInteger(rate) &&
    rate >= MIN_TICK_RATE &&
    rate <= MAX_TICK_RATE
  ) {
    return null;
  }
  const got = typeof rate === "number" ? String(rate) : (JSON.stringify(rate) ?? String(rate));
  return `tick rate must be an integer from ${MIN_TICK_RATE} to ${MAX_TICK_RATE}, got ${got}`;
}

/**
 * Project `engine.tickRate` (rate only) → `GameDefinition.time` → the engine
 * default. A project rate that isn't valid is passed over here; validating
 * the project's settings reports it.
 */
export function resolveTime(sources: {
  project?: Readonly<Record<string, unknown>>;
  game?: TimeModel;
}): ResolvedTime {
  const game = sources.game;
  const projectRate = sources.project?.tickRate;
  const rate =
    projectRate !== undefined && tickRateProblem(projectRate) === null
      ? (projectRate as number)
      : (game?.rate ?? DEFAULT_TIME.rate);
  return Object.freeze({
    kind: game?.kind ?? DEFAULT_TIME.kind,
    rate,
    tickMs: 1000 / rate,
    catchUp: game?.catchUp ? { maxMs: game.catchUp.maxMs } : null,
    wakeOnPointerMove: game?.wakeOnPointerMove ?? false,
  });
}

/**
 * Ticks in `ms` at this rate, fractional. Every ms-to-ticks conversion goes
 * through here: `ms * rate / 1000` is exact for whole-number ms where
 * `ms / tickMs` is not (at 60 Hz, 1000 ms over a 16.67 ms tick is 59.999…).
 */
export function ticksIn(ms: number, time: Pick<ResolvedTime, "rate">): number {
  return (ms * time.rate) / 1000;
}

/** Whole ticks for `ms` at this rate, at least 1: what `forMs`, `{ ms }` timers and `msPerStep` use. */
export function ticksFor(ms: number, time: Pick<ResolvedTime, "rate">): number {
  return Math.max(1, Math.round(ticksIn(ms, time)));
}

/** Whether `n` is a whole number of at least `min`: a tick count or an order a world save holds. */
export const isCount = (n: unknown, min = 0): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min;

/**
 * The whole ticks a `Delay` waits: a tick count as given, `{ ms }` rounded
 * once at this rate, a positive wait at least 1 tick and `{ ms: 0 }` none.
 * A count that isn't whole and 0 or more, or ms that aren't finite and 0 or
 * more, throw a `RangeError` naming `what`.
 */
export function delayTicks(delay: Delay, time: Pick<ResolvedTime, "rate">, what: string): number {
  if (typeof delay === "number") {
    if (!isCount(delay))
      throw new RangeError(
        `${what} must be a whole number of ticks (0 or more), got ${String(delay)}`,
      );
    return delay;
  }
  if (!Number.isFinite(delay.ms) || delay.ms < 0)
    throw new RangeError(`${what} must be 0 ms or more, got ${delay.ms}`);
  return delay.ms === 0 ? 0 : ticksFor(delay.ms, time);
}

/** The whole ticks that fit in `ms` (rounded down) and the ms left over: what a seek runs. */
export function wholeTicksIn(
  ms: number,
  time: Pick<ResolvedTime, "rate">,
): { ticks: number; restMs: number } {
  const ticks = Math.floor(ticksIn(ms, time));
  return { ticks, restMs: (ms * time.rate - ticks * 1000) / time.rate };
}

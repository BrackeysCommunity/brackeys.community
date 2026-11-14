/**
 * Tweens: an entity's pose and sprite look, or one number, animated over
 * whole ticks. The spec's schema lives in `game/behaviors/tween.ts`, which
 * the hosted service reads; this module holds the arithmetic that runs them
 * and the rule for what they can play on, and `runtime/behaviors/tween.ts`
 * applies them to a run.
 */
import {
  tweenChannels,
  tweenTargetProblem,
  type EaseName,
  type TweenSpec,
} from "../game/behaviors/tween";
import type { JsonValue } from "../game/types";
import { lerp, lerpRgb } from "../math";
import { ease, EASE_NAMES } from "./ease";

export type { TweenChannel, TweenSpec } from "../game/behaviors/tween";

/** `EngineContext.tweens`. */
export interface Tweens {
  /** Animates an entity's channels; returns the tween id. */
  to(entityId: string, spec: TweenSpec): number;
  /** A number in game state, through callbacks; a pending one makes a world save `save-unsupported`. */
  value(
    from: number,
    to: number,
    opts: Omit<TweenSpec, "to" | "from"> & {
      onUpdate: (v: number) => void;
      onDone?: () => void;
    },
  ): number;
  cancel(id: number): void;
  cancelAll(entityId: string): void;
  /** Tweens running or waiting on a delay. */
  readonly size: number;
}

/** Values by channel: an entity's `x`, `y`, `rot`, `alpha`, `tint`, `scale`, or a value tween's one number. */
export type TweenValues = Record<string, number>;

/** A tween as it runs, plain JSON: what a world save holds of it. */
export type TweenState = {
  id: number;
  /** The entity it animates; absent for a value tween. */
  owner?: string;
  key?: string;
  /** The entry of its owner's `tween` block it plays; absent for one started by code. */
  block?: number;
  to: TweenValues;
  /** Starting values the spec gave; the rest are read when its first play starts. */
  given?: TweenValues;
  /** Where each channel starts, fixed at its first tick; absent while it waits on its delay. */
  from?: TweenValues;
  /** Ticks per play, at least 1. */
  duration: number;
  /** Ticks still to wait before its first play. */
  delay: number;
  ease: EaseName;
  /** Plays still to come after this one; -1 forever. */
  repeat: number;
  yoyo: boolean;
  /** Plays finished. */
  play: number;
  /** Ticks into this play. */
  tick: number;
  emit?: { type: string; data?: JsonValue };
};

/** `from` to `to` by `k`, the tint channel lerped per 8-bit colour channel. */
export function lerpChannel(channel: string, from: number, to: number, k: number): number {
  if (k === 0) return from;
  if (k === 1) return to;
  return channel === "tint" ? lerpRgb(from, to, k) : lerp(from, to, k);
}

/**
 * What a tween plays on: an entity's type and whether it can be posed, as
 * `tweenTargetProblem` takes them, and the host it rides when it rides one
 * (a solid's or sensor's `attach`).
 */
export type TweenTarget = { type: string; posable: boolean | null; riding?: string };

/**
 * Why `spec` can't play on `target`, or null when it can. An entity riding
 * a host goes where the host's body takes it, so its pose can't be tweened.
 */
export function tweenProblem(
  target: TweenTarget,
  spec: Pick<TweenSpec, "to">,
  hasSprite: boolean,
): string | null {
  const posed =
    target.riding === undefined
      ? target
      : { type: `${target.type} riding "${target.riding}"`, posable: false };
  return tweenTargetProblem(posed, tweenChannels(spec), hasSprite);
}

/**
 * Each entry of `id`'s `tween` block that can't play on `target`: its index
 * and `tween-target-invalid`'s message, which counts entries from 1. The
 * scene validator and the block's attach both check a block through here.
 */
export function tweenBlockProblems(
  id: string,
  tweens: readonly Pick<TweenSpec, "to">[],
  target: TweenTarget,
  hasSprite: boolean,
): { index: number; message: string }[] {
  const out: { index: number; message: string }[] = [];
  tweens.forEach((spec, index) => {
    const problem = tweenProblem(target, spec, hasSprite);
    if (problem) out.push({ index, message: `${id}'s tween ${index + 1} can't play: ${problem}` });
  });
  return out;
}

/** The eased progress of `state` at its current tick: running backwards on a yoyo's odd plays. */
function progress(state: TweenState): number {
  const back = state.yoyo && state.play % 2 === 1;
  const ticks = back ? state.duration - state.tick : state.tick;
  return ease(state.ease, ticks / state.duration);
}

/** `state`'s values now; its `from` must be fixed. */
export function tweenValues(state: TweenState): TweenValues {
  const from = state.from!;
  const k = progress(state);
  const out: TweenValues = {};
  for (const [channel, to] of Object.entries(state.to))
    out[channel] = lerpChannel(channel, from[channel]!, to, k);
  return out;
}

/** Whether `state` is past its delay and has values to write. */
export const tweenStarted = (state: TweenState): boolean => state.from !== undefined;

/**
 * Moves `state` on by one tick. While it waits on its delay this counts the
 * delay down and returns null. Its first tick fixes `from`: the given
 * values, else `current`. Then it returns the values at the new tick, and
 * `ended` once its last play reached its end; a finished play with plays to
 * come starts the next at the following tick.
 */
export function stepTween(
  state: TweenState,
  current: (channel: string) => number,
): { values: TweenValues; ended: boolean } | null {
  if (state.delay > 0) {
    state.delay--;
    return null;
  }
  if (state.from === undefined) {
    const from: TweenValues = {};
    for (const channel of Object.keys(state.to))
      from[channel] = state.given?.[channel] ?? current(channel);
    state.from = from;
  }
  if (state.tick >= state.duration) {
    state.play++;
    state.tick = 0;
  }
  state.tick++;
  const values = tweenValues(state);
  const ended = state.tick >= state.duration && state.repeat === 0;
  if (state.tick >= state.duration && state.repeat > 0) state.repeat--;
  return { values, ended };
}

/** Whether `value` is a `TweenState` a world save can put back. */
export function isTweenState(value: unknown): value is TweenState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const s = value as Partial<Record<keyof TweenState, unknown>>;
  const count = (n: unknown, min = 0) => typeof n === "number" && Number.isInteger(n) && n >= min;
  const values = (v: unknown): v is TweenValues =>
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n));
  if (!values(s.to)) return false;
  const channels = Object.keys(s.to);
  // `given` names only channels of `to`; a fixed `from` holds every one.
  const given = (v: unknown) => values(v) && Object.keys(v).every((c) => channels.includes(c));
  const from = (v: unknown) => given(v) && channels.every((c) => Object.hasOwn(v as object, c));
  return (
    count(s.id, 1) &&
    (s.owner === undefined || typeof s.owner === "string") &&
    (s.key === undefined || typeof s.key === "string") &&
    (s.block === undefined || count(s.block)) &&
    (s.given === undefined || given(s.given)) &&
    (s.from === undefined || from(s.from)) &&
    count(s.duration, 1) &&
    count(s.delay) &&
    EASE_NAMES.includes(s.ease as EaseName) &&
    count(s.repeat, -1) &&
    typeof s.yoyo === "boolean" &&
    count(s.play) &&
    count(s.tick) &&
    (s.tick as number) <= (s.duration as number)
  );
}

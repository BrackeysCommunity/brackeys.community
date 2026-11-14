import {
  isTweenState,
  stepTween,
  tweenStarted,
  tweenValues,
  type Tweens,
  type TweenState,
  type TweenValues,
} from "../../anim/tweens";
import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import { COLLIDER, type ColliderSystem } from "../../game/behaviors/collider";
import { SPRITE } from "../../game/behaviors/sprite";
import {
  POSE_CHANNELS,
  TWEEN,
  tweenChannels,
  tweenSpecSchema,
  tweenTargetProblem,
  type TweenBlock,
  type TweenChannel,
  type TweenSpec,
} from "../../game/behaviors/tween";
import { ticksFor, wholeTicksIn } from "../../game/time";
import {
  EngineError,
  type Delay,
  type EngineContext,
  type JsonValue,
  type SceneSystem,
} from "../../game/types";
import type { RuntimeEntity } from "../../scene/types";
import { spawnPose } from "../spawn-pose";
import { spriteLook, type SpriteLook, type SpriteSystem } from "./sprite";

/** A tween finished and gave no `emit`: `data` is `{ id }`, plus its `key` when it has one. */
export const TWEEN_END = "tween:end";

/** The `world.systems` key a world save keeps the run's tweens under; `@` can't begin an entity id. */
export const SAVE_TWEENS_KEY = "@tweens";

/** A pending value tween, which a world save can't hold. */
export type UnsaveableTween = { id: number };

/**
 * The `tween` behavior's system: the declarative tweens of `tween` blocks
 * and every `ctx.tweens` tween, owned by their entity whether or not it
 * carries the block.
 */
export interface TweenSystem extends BehaviorSystem<TweenBlock> {
  to(entityId: string, spec: TweenSpec): number;
  value(from: number, to: number, opts: Parameters<Tweens["value"]>[2]): number;
  cancel(id: number): void;
  cancelAll(entityId: string): void;
  /** Tweens running or waiting on a delay. */
  pending(): number;
  /** An entity was destroyed: its tweens end, block or not. */
  ownerDestroyed(entityId: string): void;
  /** An entity was disabled (`on` false) or enabled again: its tweens pause or resume. */
  ownerEnabled(entityId: string, on: boolean): void;
  /** The pending value tweens, whose callbacks a world save can't hold. */
  unsaveable(): UnsaveableTween[];
  /** What a world save keeps of the tweens; undefined when there is nothing to keep. */
  capture(): JsonValue | undefined;
  /**
   * Replaces the tweens a fresh load started with `saved` (what `capture`
   * gave, or undefined for none). A block entry that changed since the save
   * keeps the fresh load's tween.
   */
  restoreCaptured(saved: JsonValue | undefined): void;
}

/** One tween in the run; a value tween keeps its callbacks beside its state. */
type Running = {
  state: TweenState;
  onUpdate?: (v: number) => void;
  onDone?: () => void;
};

/** What `capture` writes. */
type Captured = {
  next: number;
  tweens: TweenState[];
  /** Each block carrier's entries as written, to tell an entry a live edit changed. */
  blocks: Record<string, string[]>;
};

/** The one channel a value tween runs on. */
const VALUE = "v";

const isPose = (channel: string) => POSE_CHANNELS.includes(channel as TweenChannel);

const entryKey = (spec: TweenSpec) => JSON.stringify(spec);

function parsedSpec(spec: unknown, entityId?: string): TweenSpec {
  const parsed = tweenSpecSchema.safeParse(spec);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  throw new EngineError(
    "schema",
    `a tween doesn't match its schema: ${where}${issue?.message ?? "invalid"}`,
    entityId,
  );
}

/**
 * The `tween` system. Each tick, at its place in registration order, every
 * live tween whose owner is enabled moves on one whole tick. Pose channels
 * go through the owner type's `setPose` (a `collider` block it carries is
 * rebuilt where it now is), visual channels through the sprite system's
 * `style` when there is a view, and both are read back from the run, so a
 * later tween starts where an earlier one left off. The end of a tween
 * raises its `emit`, else `tween:end`.
 */
export const createTweenSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const tweens = new Map<number, Running>();
  /** The entities carrying a `tween` block, with it. */
  const blocks = new Map<string, TweenBlock>();
  const paused = new Set<string>();
  /** Visual channel values tweens wrote, by entity: held headless too. */
  const looks = new Map<string, SpriteLook>();
  let next = 1;

  /** Whole ticks for a duration (at least 1) or a delay (0 for none). */
  const ticksOf = (delay: Delay | undefined): number => {
    if (delay === undefined) return 0;
    if (typeof delay === "number") return delay;
    return delay.ms === 0 ? 0 : ticksFor(delay.ms, ctx.time);
  };

  function stateOf(
    spec: TweenSpec,
    to: TweenValues,
    given: TweenValues | undefined,
    owner?: string,
    block?: number,
  ): TweenState {
    return {
      id: next++,
      ...(owner !== undefined ? { owner } : {}),
      ...(spec.key !== undefined ? { key: spec.key } : {}),
      ...(block !== undefined ? { block } : {}),
      to,
      ...(given && Object.keys(given).length > 0 ? { given } : {}),
      duration: Math.max(1, ticksOf(spec.duration)),
      delay: ticksOf(spec.delay),
      ease: spec.ease ?? "linear",
      repeat: spec.repeat ?? 0,
      yoyo: spec.yoyo ?? false,
      play: 0,
      tick: 0,
      ...(spec.emit
        ? {
            emit: {
              type: spec.emit.type,
              ...(spec.emit.data !== undefined ? { data: spec.emit.data as JsonValue } : {}),
            },
          }
        : {}),
    };
  }

  const defined = (values: TweenSpec["to"] | undefined): TweenValues | undefined => {
    if (!values) return undefined;
    const out: TweenValues = {};
    for (const [channel, v] of Object.entries(values)) if (v !== undefined) out[channel] = v;
    return out;
  };

  function add(run: Running): number {
    const { owner, key, id } = run.state;
    if (owner !== undefined && key !== undefined) {
      for (const [other, r] of tweens)
        if (r.state.owner === owner && r.state.key === key) tweens.delete(other);
    }
    tweens.set(id, run);
    return id;
  }

  function startEntry(owner: string, spec: TweenSpec, index?: number): number {
    return add({ state: stateOf(spec, defined(spec.to)!, defined(spec.from), owner, index) });
  }

  function targetProblem(e: RuntimeEntity, spec: TweenSpec): string | null {
    const system = ctx.system<SceneSystem>(e.type);
    return tweenTargetProblem(
      { type: e.type, posable: typeof system?.setPose === "function" },
      tweenChannels(spec),
      SPRITE.name in (e.behaviors ?? {}),
    );
  }

  function startBlock(id: string, block: TweenBlock, entity?: RuntimeEntity): void {
    block.tweens.forEach((spec, i) => {
      const problem = entity ? targetProblem(entity, spec) : null;
      if (problem) {
        throw new EngineError(
          "tween-target-invalid",
          `${id}'s tween ${i} can't play: ${problem}`,
          id,
        );
      }
    });
    blocks.set(id, block);
    block.tweens.forEach((spec, i) => startEntry(id, spec, i));
  }

  function dropBlock(id: string): void {
    for (const [tid, r] of tweens)
      if (r.state.owner === id && r.state.block !== undefined) tweens.delete(tid);
    blocks.delete(id);
  }

  const poseOf = (id: string) => {
    const pose = ctx.poses.get(id);
    if (pose) return pose;
    const e = ctx.get(id);
    return e ? spawnPose(e, ctx.registry) : { x: 0, y: 0, rot: 0 };
  };

  function current(id: string, channel: string): number {
    if (channel === "x" || channel === "y" || channel === "rot") return poseOf(id)[channel];
    const held = looks.get(id)?.[channel as keyof SpriteLook];
    if (held !== undefined) return held;
    const e = ctx.get(id);
    return e ? spriteLook(ctx, e)[channel as keyof SpriteLook] : 0;
  }

  function apply(id: string, values: TweenValues): void {
    const e = ctx.get(id);
    if (!e) return;
    let posed = false;
    const look: SpriteLook = {};
    for (const [channel, v] of Object.entries(values)) {
      if (isPose(channel)) posed = true;
      else look[channel as keyof SpriteLook] = v;
    }
    const owner = ctx.system<SceneSystem>(e.type);
    if (posed && owner?.setPose) {
      const p = poseOf(id);
      owner.setPose(id, values.x ?? p.x, values.y ?? p.y, values.rot ?? p.rot);
      const colliders = ctx.behavior<ColliderSystem>(COLLIDER.name);
      if (colliders?.has(id)) colliders.rebuild(id);
    }
    if (Object.keys(look).length > 0) {
      looks.set(id, { ...looks.get(id), ...look });
      ctx.behavior<SpriteSystem>(SPRITE.name)?.style(id, look);
    }
  }

  function ended(run: Running, quiet: boolean): void {
    const { state } = run;
    run.onDone?.();
    if (quiet) return;
    const pose = state.owner === undefined ? null : poseOf(state.owner);
    ctx.emit({
      type: state.emit?.type ?? TWEEN_END,
      at: pose ? { x: pose.x, y: pose.y } : { x: 0, y: 0 },
      ...(state.owner !== undefined ? { entityId: state.owner } : {}),
      ...(state.emit
        ? state.emit.data !== undefined
          ? { data: state.emit.data }
          : {}
        : { data: { id: state.id, ...(state.key !== undefined ? { key: state.key } : {}) } }),
    });
  }

  /** One tick of every live tween there was when it began; `quiet` (a seek) raises nothing. */
  function advance(quiet: boolean): void {
    for (const [id, run] of [...tweens]) {
      if (tweens.get(id) !== run) continue;
      const owner = run.state.owner;
      if (owner !== undefined && paused.has(owner)) continue;
      const moved = stepTween(run.state, (channel) =>
        owner === undefined ? 0 : current(owner, channel),
      );
      if (!moved) continue;
      if (owner !== undefined) apply(owner, moved.values);
      else run.onUpdate?.(moved.values[VALUE]!);
      if (!moved.ended) continue;
      if (tweens.get(id) === run) tweens.delete(id);
      ended(run, quiet);
    }
  }

  function capture(): Captured | undefined {
    const states: TweenState[] = [];
    for (const { state } of tweens.values())
      if (state.owner !== undefined) states.push(structuredClone(state));
    const carried: Record<string, string[]> = {};
    for (const [id, block] of blocks) carried[id] = block.tweens.map(entryKey);
    if (states.length === 0 && blocks.size === 0) return undefined;
    return { next, tweens: states, blocks: carried };
  }

  function restoreCaptured(saved: JsonValue | undefined): void {
    const fresh = [...tweens.values()];
    tweens.clear();
    const got = (saved ?? {}) as Partial<Captured>;
    const was = got.blocks && typeof got.blocks === "object" ? got.blocks : {};
    if (typeof got.next === "number" && Number.isInteger(got.next) && got.next > 0) next = got.next;
    const unchanged = (owner: string, index: number) => {
      const entry = blocks.get(owner)?.tweens[index];
      return entry !== undefined && was[owner]?.[index] === entryKey(entry);
    };
    for (const state of Array.isArray(got.tweens) ? got.tweens : []) {
      if (!isTweenState(state) || state.owner === undefined || !ctx.get(state.owner)) continue;
      if (state.block !== undefined && !unchanged(state.owner, state.block)) continue;
      next = Math.max(next, state.id + 1);
      tweens.set(state.id, { state: structuredClone(state) });
    }
    for (const run of fresh) {
      const { owner, block } = run.state;
      if (owner === undefined || block === undefined || unchanged(owner, block)) continue;
      run.state.id = next++;
      tweens.set(run.state.id, run);
    }
    for (const { state } of tweens.values())
      if (state.owner !== undefined && tweenStarted(state)) apply(state.owner, tweenValues(state));
  }

  function restart(): void {
    tweens.clear();
    looks.clear();
    next = 1;
    for (const [id, block] of blocks) block.tweens.forEach((spec, i) => startEntry(id, spec, i));
  }

  const system: TweenSystem = {
    attach: (id, block, entity) => startBlock(id, block, entity),
    update(id, block, _prev, entity) {
      dropBlock(id);
      startBlock(id, block, entity);
    },
    detach: dropBlock,
    // Pausing follows the owner hooks, which reach entities without a block too.
    disable() {},
    enable() {},
    step: () => advance(false),
    reset: restart,
    seek(ms) {
      const { ticks } = wholeTicksIn(ms, ctx.time);
      for (let i = 0; i < ticks; i++) advance(true);
    },
    clear() {
      tweens.clear();
      blocks.clear();
      paused.clear();
      looks.clear();
      next = 1;
    },
    size: () => blocks.size,
    to(entityId, spec) {
      const parsed = parsedSpec(spec, entityId);
      const e = ctx.get(entityId);
      if (!e) {
        throw new EngineError(
          "tween-target-invalid",
          `there's no live entity "${entityId}" to tween`,
          entityId,
        );
      }
      const problem = targetProblem(e, parsed);
      if (problem)
        throw new EngineError(
          "tween-target-invalid",
          `can't tween "${entityId}": ${problem}`,
          entityId,
        );
      return startEntry(entityId, parsed);
    },
    value(from, to, opts) {
      const { onUpdate, onDone, ...rest } = opts;
      if (typeof onUpdate !== "function")
        throw new EngineError("schema", "a value tween needs an `onUpdate` function");
      if (onDone !== undefined && typeof onDone !== "function")
        throw new EngineError("schema", "a value tween's `onDone` must be a function");
      const parsed = parsedSpec({ ...rest, to: { x: to }, from: { x: from } });
      return add({
        state: stateOf(parsed, { [VALUE]: to }, { [VALUE]: from }),
        onUpdate,
        ...(onDone ? { onDone } : {}),
      });
    },
    cancel(id) {
      tweens.delete(id);
    },
    cancelAll(entityId) {
      for (const [id, r] of tweens) if (r.state.owner === entityId) tweens.delete(id);
    },
    pending: () => tweens.size,
    ownerDestroyed(entityId) {
      system.cancelAll(entityId);
      paused.delete(entityId);
      looks.delete(entityId);
    },
    ownerEnabled(entityId, on) {
      if (on) paused.delete(entityId);
      else paused.add(entityId);
    },
    unsaveable() {
      const out: UnsaveableTween[] = [];
      for (const { state } of tweens.values())
        if (state.owner === undefined) out.push({ id: state.id });
      return out;
    },
    capture: () => capture() as JsonValue | undefined,
    restoreCaptured,
  };
  return system as BehaviorSystem;
};

/** The tween system of `ctx`'s runtime, for its lifecycle's owner hooks. */
export const tweenSystemOf = (ctx: Pick<EngineContext, "behavior">): TweenSystem | undefined =>
  ctx.behavior<TweenSystem>(TWEEN.name);

/** `ctx.tweens`: the tween system's tweens, by entity. */
export function tweensContext(ctx: Pick<EngineContext, "behavior">): Tweens {
  return {
    to: (entityId, spec) => tweenSystemOf(ctx)?.to(entityId, spec) ?? 0,
    value: (from, to, opts) => tweenSystemOf(ctx)?.value(from, to, opts) ?? 0,
    cancel: (id) => tweenSystemOf(ctx)?.cancel(id),
    cancelAll: (entityId) => tweenSystemOf(ctx)?.cancelAll(entityId),
    get size() {
      return tweenSystemOf(ctx)?.pending() ?? 0;
    },
  };
}

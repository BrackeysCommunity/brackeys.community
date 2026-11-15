import type { Sha256 } from "../project/types";
import type { WorldSnapshot, WorldSnapshotResult } from "./world-snapshot";

/** Ticks between the checkpoints a replay's seek restores from. */
export const SEEK_CHECKPOINT_EVERY = 300;

/** How far a seek has re-simulated: plain data, so it crosses a worker link. */
export type SeekProgress = {
  readonly target: number;
  /** The tick it re-simulated from: a checkpoint's, the start's or where the world stood. */
  readonly from: number;
  /** The tick the world steps next. */
  readonly tick: number;
};

/** A world as a checkpoint holds it, with the live scene version it ran on. */
export type Checkpoint = {
  readonly tick: number;
  readonly snapshot: WorldSnapshot;
  readonly version: Sha256 | null;
};

/** The replay a seek moves: whoever runs the play world implements it. */
export type SeekWorld = {
  /** The tick the world steps next. */
  tick(): number;
  /** Steps the next recorded tick with presentation muted; false when the replay can't step on. */
  step(): boolean;
  snapshot(): WorldSnapshotResult;
  /** The main scene's live version now; null for the scene's own. */
  version(): Sha256 | null;
  /** Puts the world back at `checkpoint`, on its version, with the swaps after it still to apply. */
  restore(checkpoint: Checkpoint): boolean;
  /** Puts the world back at the replay's start. */
  restart(): boolean;
};

export type Checkpoints = {
  readonly every: number;
  ticks(): readonly number[];
  /** Takes one when the world stands on a checkpoint tick it lacks; the first refusal ends checkpointing. */
  take(world: SeekWorld): void;
  /** The latest checkpoint at or before `tick`. */
  at(tick: number): Checkpoint | null;
  /** True once the world refused a snapshot (a backend without them): seeks then re-simulate from the start. */
  readonly refused: boolean;
};

export function createCheckpoints(every: number = SEEK_CHECKPOINT_EVERY): Checkpoints {
  const step = Math.max(1, Math.floor(every));
  const held: Checkpoint[] = [];
  let refused = false;
  return {
    every: step,
    ticks: () => held.map((c) => c.tick),
    take(world) {
      if (refused) return;
      const tick = world.tick();
      if (tick % step !== 0 || held.some((c) => c.tick === tick)) return;
      const taken = world.snapshot();
      if (!taken.ok) {
        refused = true;
        return;
      }
      const checkpoint = { tick, snapshot: taken.snapshot, version: world.version() };
      const after = held.findIndex((c) => c.tick > tick);
      if (after < 0) held.push(checkpoint);
      else held.splice(after, 0, checkpoint);
    },
    at(tick) {
      let found: Checkpoint | null = null;
      for (const c of held) if (c.tick <= tick) found = c;
      return found;
    },
    get refused() {
      return refused;
    },
  };
}

/** A seek's target within a run of `ticks` ticks: a whole tick from 0 to the end. */
export function seekTarget(target: number, ticks: number): number {
  if (!Number.isFinite(target)) return target > 0 ? Math.max(0, ticks) : 0;
  return Math.min(Math.max(0, Math.floor(target)), Math.max(0, ticks));
}

/** Where a seek ended: the tick the world steps next, which is the target unless the replay stopped first. */
export type SeekEnd = { tick: number; reached: boolean };

/**
 * Re-simulates `world` to `target`, one muted tick per yield: a backward
 * seek, or a forward one past a later checkpoint, restores the nearest
 * checkpoint at or before the target (the start when there is none), then
 * steps on, taking checkpoints on the way. Stepping is the replay's own, so
 * a seek to N reaches the digest stepping N does.
 */
export function* seekSteps(
  world: SeekWorld,
  checkpoints: Checkpoints,
  target: number,
): Generator<SeekProgress, SeekEnd> {
  const now = world.tick();
  const nearest = checkpoints.at(target);
  if (nearest && nearest.tick > now) {
    if (!world.restore(nearest)) return { tick: world.tick(), reached: false };
  } else if (target < now) {
    const restored = nearest ? world.restore(nearest) : world.restart();
    if (!restored) return { tick: world.tick(), reached: false };
  }
  const from = world.tick();
  while (world.tick() < target) {
    checkpoints.take(world);
    if (!world.step()) break;
    yield { target, from, tick: world.tick() };
  }
  checkpoints.take(world);
  const tick = world.tick();
  return { tick, reached: tick === target };
}

/** Runs a seek to its end at once, reporting progress on the way. */
export function seekTo(
  world: SeekWorld,
  checkpoints: Checkpoints,
  target: number,
  onProgress?: (p: SeekProgress) => void,
): SeekEnd {
  const steps = seekSteps(world, checkpoints, target);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    onProgress?.(next.value);
  }
}

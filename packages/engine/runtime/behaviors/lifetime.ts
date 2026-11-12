import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { LifetimeBlock } from "../../game/behaviors/lifetime";
import { ticksFor, wholeTicksIn } from "../../game/time";
import type { EngineContext, JsonValue } from "../../game/types";

/** A running lifetime: the clock phase it ends in, and its order among those ending then. */
type Countdown = { due: number; seq: number };

/**
 * The lifetime system: attaching or enabling an entity with a `lifetime`
 * block starts a countdown, which destroys or disables it. The countdown
 * stops while the entity is disabled; enabling starts a fresh one. It keeps
 * its own clock of one phase per simulated tick, plus the phases a seek
 * runs before tick 0, as `ctx.timers` does, so an entity goes on the tick a
 * timer of the same delay would fire. A world save holds the ticks left.
 */
export const createLifetimeSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const blocks = new Map<string, LifetimeBlock>();
  const running = new Map<string, Countdown>();
  let seq = 0;
  /** Phases sought before tick 0. */
  let offset = 0;
  /** The phase a seek is running, or null. */
  let seekPhase: number | null = null;
  /** The last phase run (or running); -1 before the first. */
  let lastPhase = -1;

  const now = () => seekPhase ?? ctx.tick + offset;
  /** The first phase a countdown started now can end in: this tick's unless its phase has run. */
  const nextPhase = () => {
    const base = now();
    return lastPhase >= base ? base + 1 : base;
  };

  function start(id: string, ticks: number): void {
    if (ctx.exists(id) && !ctx.enabled(id)) {
      running.delete(id);
      return;
    }
    running.set(id, { due: Math.max(now() + ticks, nextPhase()), seq: seq++ });
  }

  function schedule(id: string, block: LifetimeBlock): void {
    start(id, block.ms !== undefined ? ticksFor(block.ms, ctx.time) : (block.ticks ?? 1));
  }

  function expire(id: string): void {
    running.delete(id);
    if ((blocks.get(id)?.then ?? "destroy") === "disable") ctx.setEnabled(id, false);
    else ctx.destroy(id);
  }

  function runPhase(phase: number): void {
    lastPhase = phase;
    if (running.size === 0) return;
    const ready: [string, Countdown][] = [];
    for (const entry of running) if (entry[1].due <= phase) ready.push(entry);
    ready.sort(([, a], [, b]) => a.due - b.due || a.seq - b.seq);
    for (const [id, c] of ready) {
      // An earlier expiry may have stopped or restarted it.
      if (running.get(id) === c) expire(id);
    }
  }

  const system: BehaviorSystem<LifetimeBlock> = {
    attach(id, block) {
      blocks.set(id, block);
      schedule(id, block);
    },
    detach(id) {
      running.delete(id);
      blocks.delete(id);
    },
    step() {
      runPhase(ctx.tick + offset);
    },
    seek(ms) {
      const ticks = wholeTicksIn(ms, ctx.time).ticks;
      const first = now();
      try {
        for (let i = 0; i < ticks; i++) {
          seekPhase = first + i;
          runPhase(seekPhase);
        }
      } finally {
        seekPhase = null;
        offset += ticks;
      }
    },
    disable(id) {
      running.delete(id);
    },
    enable(id) {
      const block = blocks.get(id);
      if (block) schedule(id, block);
    },
    /** The ticks left before it goes, counted from the next tick. */
    save(id) {
      const c = running.get(id);
      return c ? { left: Math.max(0, c.due - nextPhase()) } : undefined;
    },
    restore(id, state: JsonValue) {
      if (!blocks.has(id) || typeof state !== "object" || state === null) return;
      const left = (state as { left?: unknown }).left;
      if (typeof left !== "number" || !Number.isInteger(left) || left < 0) return;
      lastPhase = Math.min(lastPhase, now() - 1);
      start(id, left);
    },
    clear() {
      blocks.clear();
      running.clear();
      seq = 0;
      offset = 0;
      seekPhase = null;
      lastPhase = -1;
    },
    size: () => blocks.size,
  };
  return system as BehaviorSystem;
};

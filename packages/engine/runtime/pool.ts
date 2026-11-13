import { EngineError, type EngineContext, type Pool } from "../game/types";
import { ENTITY_DESTROYED, ENTITY_DISABLED } from "./types";

export type { Pool };

/**
 * The key under which a scene runtime's context reads its current load
 * generation, kept off the public `EngineContext` type. A context without it
 * (a host's own) gets pools that never go stale.
 */
export const LOAD_GENERATION: unique symbol = Symbol.for("@jams/engine:load-generation");

type GenerationCarrier = { [LOAD_GENERATION]?: () => number };

/** The scene runtime's load-generation reader on `ctx`; undefined for a host's own context. */
export function generationOf(ctx: EngineContext): (() => number) | undefined {
  return (ctx as EngineContext & GenerationCarrier)[LOAD_GENERATION];
}

/**
 * A pool over `spawn`: `acquire` enables the most recently freed (disabled)
 * entity before spawning a new one, up to `max` entities in all; an entity
 * disabled by any means (a `lifetime` with `then: "disable"`) is free
 * again, and a destroyed one leaves the pool.
 *
 * It belongs to the load it was made in: its subscriptions end with that
 * load, and the next load gives out the same counter ids again, so after it
 * `acquire` and `release` throw `EngineError("pool-stale")` and `free` and
 * `live` read 0. Create the pool in `onLoad` (or later) and drop it at unload.
 */
export function createPool(ctx: EngineContext, opts: { spawn: () => string; max?: number }): Pool {
  const { spawn, max } = opts;
  if (max !== undefined && !(Number.isInteger(max) && max >= 0)) {
    throw new RangeError(`a pool's max must be a whole number of entities, not ${max}`);
  }
  /** Every entity the pool spawned and still holds, in spawn order. */
  const members = new Set<string>();
  /** The free members, the most recently freed last. */
  const free: string[] = [];
  const generation = generationOf(ctx);
  const madeIn = generation?.();

  const stale = () => generation !== undefined && generation() !== madeIn;

  function current(what: string): void {
    if (!stale()) return;
    throw new EngineError(
      "pool-stale",
      `can't ${what} on a pool made in an earlier load: its entities are gone and their ids are the new load's; create pools in onLoad and drop them at unload`,
    );
  }

  function drop(id: string): void {
    members.delete(id);
    const i = free.lastIndexOf(id);
    if (i >= 0) free.splice(i, 1);
  }

  function markFree(id: string): void {
    if (members.has(id) && !free.includes(id)) free.push(id);
  }

  /**
   * Forgets members that are gone, and frees or claims back members whose
   * enabled state changed without an event (outside a step, events aren't
   * raised).
   */
  function settle(): void {
    for (const id of members) {
      if (!ctx.exists(id)) drop(id);
      else if (!ctx.enabled(id)) markFree(id);
    }
    for (let i = free.length - 1; i >= 0; i--) {
      if (ctx.enabled(free[i]!)) free.splice(i, 1);
    }
  }

  ctx.events.on(ENTITY_DISABLED, (e) => {
    if (e.entityId !== undefined && ctx.exists(e.entityId) && !ctx.enabled(e.entityId)) {
      markFree(e.entityId);
    }
  });
  ctx.events.on(ENTITY_DESTROYED, (e) => {
    if (e.entityId !== undefined && !ctx.exists(e.entityId)) drop(e.entityId);
  });

  return {
    acquire() {
      current("acquire");
      settle();
      const reused = free.pop();
      if (reused !== undefined) {
        ctx.setEnabled(reused, true);
        return reused;
      }
      if (max !== undefined && members.size >= max) return null;
      const id = spawn();
      if (!ctx.exists(id)) {
        throw new Error(`a pool's spawn returned "${id}", which is not a live entity id`);
      }
      members.add(id);
      return id;
    },

    release(id) {
      current("release");
      if (!members.has(id)) return;
      if (!ctx.exists(id)) {
        drop(id);
        return;
      }
      ctx.setEnabled(id, false);
      markFree(id);
    },

    get free() {
      if (stale()) return 0;
      settle();
      return free.length;
    },

    get live() {
      if (stale()) return 0;
      settle();
      return members.size - free.length;
    },
  };
}

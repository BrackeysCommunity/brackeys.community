import type { EngineContext, Pool } from "../game/types";
import { ENTITY_DESTROYED, ENTITY_DISABLED } from "./types";

export type { Pool };

/**
 * A pool over `spawn`: `acquire` enables the most recently freed (disabled)
 * entity before spawning a new one, up to `max` entities in all; an entity
 * disabled by any means (a `lifetime` with `then: "disable"`) is free
 * again, and a destroyed one leaves the pool.
 *
 * Its subscriptions end with the load, like every subscription, so create
 * the pool in `onLoad` (or later) and drop it at unload.
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
      if (!members.has(id)) return;
      if (!ctx.exists(id)) {
        drop(id);
        return;
      }
      ctx.setEnabled(id, false);
      markFree(id);
    },

    get free() {
      settle();
      return free.length;
    },

    get live() {
      settle();
      return members.size - free.length;
    },
  };
}

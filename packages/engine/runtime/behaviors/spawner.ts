import { z } from "zod";

import type {
  BehaviorSystem,
  BehaviorSystemFactory,
  RegisteredBehavior,
} from "../../game/behaviors";
import type { SpawnerBlock, SpawnerSystem } from "../../game/behaviors/spawner";
import { ticksFor, wholeTicksIn } from "../../game/time";
import type { EngineContext, JsonValue, SpawnInput } from "../../game/types";
import { translateEntityDef } from "../../scene/translate";
import type { EntityDef } from "../../scene/types";
import { ENTITY_DESTROYED, SPAWNER_SPAWNED, type StepEvent } from "../types";

const U32 = 0x1_0000_0000;

type Spawner = {
  id: string;
  block: SpawnerBlock;
  /** False while the entity is disabled. */
  on: boolean;
  /** Spawns accrued and not yet made; at most one while at the cap. */
  owed: number;
  /** Live spawns, oldest first: entity ids, or instance ids for a prefab. */
  live: Set<string>;
  /** A prefab instance's ticks left when `lifeMs` is set; a type's spawn carries a `lifetime` block instead. */
  left: Map<string, number>;
  /** The burst is still to come, on the first tick it is active. */
  burst: boolean;
  /** Its own stream, forked at the first random draw. */
  rng: EngineContext["random"] | null;
};

type Made = { at: number; dx: number; dy: number };

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/**
 * The spawner system: each entity carrying a `spawner` block accrues `rate`
 * spawns a second while active, and spawns one at its pose (plus a random
 * offset within `spread`) for each it owes while under `cap`. Its live
 * spawns are counted back from `entity:destroyed`; a prefab instance counts
 * once, until its last child goes. A world save holds what it owes, its
 * live ids and whether the burst is still to come; its random stream is
 * saved with `ctx.random`'s forks.
 */
export const createSpawnerSystem: BehaviorSystemFactory = (
  ctx: EngineContext,
  def: RegisteredBehavior,
) => {
  const schema = z.object(def.shape);
  const spawners = new Map<string, Spawner>();
  /** Each live spawn's spawner. */
  const owner = new Map<string, Spawner>();
  let unsubscribe: (() => void) | null = null;

  /** The block with the schema's defaults filled in; a block that doesn't parse is read as given. */
  function withDefaults(block: SpawnerBlock): SpawnerBlock {
    const parsed = schema.safeParse(block);
    return parsed.success ? (parsed.data as SpawnerBlock) : block;
  }

  function forget(s: Spawner, key: string): void {
    s.live.delete(key);
    s.left.delete(key);
    if (owner.get(key) === s) owner.delete(key);
  }

  /** The spawn `id` counts as: itself, or the instance it is a child of. */
  function spawnOf(id: string): string | undefined {
    if (owner.has(id)) return id;
    for (let i = id.lastIndexOf("/"); i > 0; i = id.lastIndexOf("/", i - 1)) {
      const key = id.slice(0, i);
      if (owner.has(key)) return key;
    }
    return undefined;
  }

  function onDestroyed(e: StepEvent): void {
    if (e.entityId === undefined) return;
    const key = spawnOf(e.entityId);
    if (key === undefined || ctx.exists(key)) return;
    forget(owner.get(key)!, key);
  }

  /** Drops spawns that went without an event (outside a step, none is raised). */
  function settle(s: Spawner): void {
    for (const key of s.live) if (!ctx.exists(key)) forget(s, key);
  }

  function offset(s: Spawner): [number, number] {
    const r = s.block.spread;
    if (!(r > 0)) return [0, 0];
    const rng = (s.rng ??= ctx.random.fork(`spawner:${s.id}`));
    // Rejection in the unit square: uniform over the disc, and only arithmetic.
    for (;;) {
      const x = (rng.nextU32() / U32) * 2 - 1;
      const y = (rng.nextU32() / U32) * 2 - 1;
      if (x * x + y * y <= 1) return [x * r, y * r];
    }
  }

  /**
   * A type spawn's fields at `x, y`: the block's `fields` with their
   * geometry moved there, or, with none to move, standing there by `at`.
   */
  function typeSpawn(block: SpawnerBlock, x: number, y: number): SpawnInput {
    const type = block.type ?? "";
    if (block.fields === undefined) return { type, at: [x, y] };
    const def = { ...structuredClone(block.fields), id: "", type } as EntityDef;
    const moved = translateEntityDef(ctx.registry, def, [x, y]);
    const { id: _id, ...fields } = moved ?? { ...def, at: [x, y] };
    return fields as SpawnInput;
  }

  /** Spawns one at the spawner's pose plus `dx, dy`; `lifeTicks` replaces `lifeMs` (a seek's remainder). */
  function spawnOne(s: Spawner, dx: number, dy: number, emit: boolean, lifeTicks?: number): void {
    const pose = ctx.poses.get(s.id);
    if (!pose) return;
    const block = s.block;
    const x = pose.x + dx;
    const y = pose.y + dy;
    let id: string;
    let bodies: readonly string[];
    if (block.prefab !== undefined) {
      const placed = ctx.instantiate(block.prefab, [x, y]);
      id = placed.id;
      bodies = placed.entities;
      if (lifeTicks !== undefined) s.left.set(id, lifeTicks + 1);
      else if (block.lifeMs !== undefined) s.left.set(id, ticksFor(block.lifeMs, ctx.time));
    } else {
      const lifetime =
        lifeTicks !== undefined
          ? { ticks: lifeTicks }
          : block.lifeMs !== undefined
            ? { ms: block.lifeMs }
            : undefined;
      const input = typeSpawn(block, x, y);
      if (lifetime) {
        const own = input.behaviors;
        const blocks = typeof own === "object" && own !== null && !Array.isArray(own) ? own : {};
        input.behaviors = { ...blocks, lifetime };
      }
      id = ctx.spawn(input).id;
      bodies = [id];
    }
    s.live.add(id);
    owner.set(id, s);
    if (block.velocity) {
      const [vx, vy] = block.velocity;
      const c = pose.rot === 0 ? 1 : Math.cos(pose.rot);
      const n = pose.rot === 0 ? 0 : Math.sin(pose.rot);
      const v = { x: vx * c - vy * n, y: vx * n + vy * c };
      for (const b of bodies) if (ctx.bodies.kind(b) === "dynamic") ctx.bodies.setVelocity(b, v);
    }
    if (emit)
      ctx.emit({ type: SPAWNER_SPAWNED, entityId: s.id, other: id, at: { x, y }, data: { id } });
  }

  /** A prefab instance's lifetime: it goes on the tick its count runs out. */
  function countDown(s: Spawner): void {
    for (const [key, left] of s.left) {
      if (left > 1) s.left.set(key, left - 1);
      else {
        s.left.delete(key);
        ctx.destroy(key);
      }
    }
  }

  const running = (s: Spawner) => s.on && s.block.active !== false;

  function tick(s: Spawner, dtMs: number): void {
    countDown(s);
    if (!running(s)) return;
    settle(s);
    const { cap } = s.block;
    if (s.burst) {
      s.burst = false;
      const n = Math.min(s.block.burst, cap - s.live.size);
      for (let i = 0; i < n; i++) spawnOne(s, ...offset(s), true);
    }
    s.owed += (s.block.rate * dtMs) / 1000;
    while (s.owed >= 1 && s.live.size < cap) {
      s.owed -= 1;
      spawnOne(s, ...offset(s), true);
    }
    // At its cap a spawner owes no more than its next spawn.
    if (s.owed > 1) s.owed = 1;
  }

  /**
   * Runs `ticks` of the spawner before tick 0 by count alone, drawing every
   * offset a stepped run would, then spawns what would still be alive, with
   * the life it has left. Spawns that outlive the seek on their own (a
   * type's `lifetime`, which the lifetime system seeks first) hold their
   * slots throughout.
   */
  function seekOne(s: Spawner, ticks: number, dtMs: number): void {
    const block = s.block;
    const life = block.lifeMs !== undefined ? ticksFor(block.lifeMs, ctx.time) : null;
    settle(s);
    /** The last tick each held slot is taken, seek-relative. */
    const held: number[] = [...s.live].map((key) => {
      const left = s.left.get(key);
      return left === undefined ? Infinity : left - 1;
    });
    for (const [key, left] of s.left) {
      if (left > ticks) s.left.set(key, left - ticks);
      else {
        s.left.delete(key);
        ctx.destroy(key);
      }
    }
    settle(s);
    if (!running(s)) return;
    const made: Made[] = [];
    const take = (at: number) => {
      const [dx, dy] = offset(s);
      made.push({ at, dx, dy });
      held.push(life === null ? Infinity : at + life);
    };
    for (let t = 0; t < ticks; t++) {
      for (let i = held.length - 1; i >= 0; i--) if (held[i]! < t) held.splice(i, 1);
      if (s.burst) {
        s.burst = false;
        const n = Math.min(block.burst, block.cap - held.length);
        for (let i = 0; i < n; i++) take(t);
      }
      s.owed += (block.rate * dtMs) / 1000;
      while (s.owed >= 1 && held.length < block.cap) {
        s.owed -= 1;
        take(t);
      }
      if (s.owed > 1) s.owed = 1;
    }
    for (const m of made) {
      if (life === null) spawnOne(s, m.dx, m.dy, false);
      else {
        const rest = m.at + life - ticks;
        if (rest >= 1) spawnOne(s, m.dx, m.dy, false, rest);
      }
    }
  }

  const system: SpawnerSystem = {
    attach(id, block) {
      unsubscribe ??= ctx.events.on(ENTITY_DESTROYED, onDestroyed);
      const b = withDefaults(block);
      spawners.set(id, {
        id,
        block: b,
        on: true,
        owed: 0,
        live: new Set(),
        left: new Map(),
        burst: b.burst > 0,
        rng: null,
      });
    },
    update(id, block) {
      const s = spawners.get(id);
      if (s) s.block = withDefaults(block);
    },
    detach(id) {
      const s = spawners.get(id);
      if (!s) return;
      for (const key of s.live) if (owner.get(key) === s) owner.delete(key);
      spawners.delete(id);
    },
    beforeStep(dtMs) {
      if (spawners.size === 0) return;
      for (const s of [...spawners.values()]) if (spawners.get(s.id) === s) tick(s, dtMs);
    },
    reset() {
      for (const s of spawners.values()) {
        s.owed = 0;
        s.burst = s.block.burst > 0;
      }
    },
    seek(ms) {
      const ticks = wholeTicksIn(ms, ctx.time).ticks;
      if (ticks <= 0) return;
      for (const s of [...spawners.values()]) {
        if (spawners.get(s.id) === s) seekOne(s, ticks, ctx.time.tickMs);
      }
    },
    disable(id) {
      const s = spawners.get(id);
      if (s) s.on = false;
    },
    enable(id) {
      const s = spawners.get(id);
      if (s) s.on = true;
    },
    save(id) {
      const s = spawners.get(id);
      if (!s) return undefined;
      const state: { [key: string]: JsonValue } = { owed: s.owed, live: [...s.live] };
      if (s.left.size > 0) state.left = Object.fromEntries(s.left);
      if (s.burst) state.burst = true;
      return state;
    },
    restore(id, state: JsonValue) {
      const s = spawners.get(id);
      if (!s || typeof state !== "object" || state === null || Array.isArray(state)) return;
      const { owed, live, left, burst } = state as Record<string, unknown>;
      for (const key of s.live) if (owner.get(key) === s) owner.delete(key);
      s.live.clear();
      s.left.clear();
      s.owed = typeof owed === "number" && Number.isFinite(owed) ? owed : 0;
      s.burst = burst === true;
      if (Array.isArray(live)) {
        for (const key of live) {
          if (typeof key !== "string") continue;
          s.live.add(key);
          owner.set(key, s);
        }
      }
      if (typeof left === "object" && left !== null) {
        for (const [key, n] of Object.entries(left))
          if (s.live.has(key) && isCount(n)) s.left.set(key, n);
      }
    },
    clear() {
      spawners.clear();
      owner.clear();
      unsubscribe?.();
      unsubscribe = null;
    },
    size: () => spawners.size,
    live: (id) => [...(spawners.get(id)?.live ?? [])],
  };
  return system as BehaviorSystem;
};

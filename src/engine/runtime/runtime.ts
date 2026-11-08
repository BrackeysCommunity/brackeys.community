import { createColliderTags } from "../collider-tags";
import { SPRITE } from "../game/behaviors/sprite";
import { createRegistry } from "../game/define";
import { DEFAULT_GRAVITY } from "../game/primitives";
import type {
  EngineContext,
  GameDefinition,
  GameRuntime,
  PlayStart,
  Registry,
  SceneSystem,
} from "../game/types";
import type { PlayOptions } from "../headless/playtest-types";
import { createPhysicsWorld } from "../physics";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { geometryFields } from "../scene/schema";
import type { EntityTypeName, ExpandedScene, RuntimeEntity } from "../scene/types";
import { createAttachmentHub } from "../systems/attachments";
import type { InputAction } from "../types";
import { createBehaviorHost, type BehaviorHost } from "./behaviors";
import type { SpriteSystem } from "./behaviors/sprite";
import { castSpawn } from "./cast";
import { createPoseIndex } from "./poses";
import { systemFactoryOf } from "./primitives";
import { spawnPoseOf, type GeometryFields } from "./spawn-pose";
import type {
  LoadReport,
  ReconcileReport,
  RuntimeStats,
  SceneRuntimeHandle,
  SceneRuntimeOptions,
  StepEvent,
  StepResult,
} from "./types";

/**
 * The registry and game a runtime runs: `registry` when given (it must have
 * been built from `game`, when both are), else one built from `game`.
 */
export function resolveGame<S = unknown>(opts: {
  game?: GameDefinition<S> | null;
  registry?: Registry;
}): { registry: Registry; game: GameDefinition<S> | null } {
  const registry = opts.registry ?? createRegistry(opts.game as GameDefinition | null | undefined);
  if (opts.registry && opts.game && opts.registry.game !== opts.game) {
    throw new Error(`registry "${registry.id}" was not built from game "${opts.game.id}"`);
  }
  return { registry, game: opts.game ?? (registry.game as GameDefinition<S> | null) };
}

/** Structural equality for entity fields (plain JSON values); key order doesn't matter. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What a runtime's game reads of its project: `EngineContext.project`, null without one. */
export type ProjectOption = { project?: ProjectRuntimeView | null };

/**
 * A scene runtime for one registry: one system per loadable registered
 * type, built once and refilled on every load, plus the game's hooks.
 */
export function createSceneRuntime(opts: SceneRuntimeOptions & ProjectOption): SceneRuntimeHandle {
  const { rapier, view } = opts;
  const now = opts.now ?? (() => 0);
  const { registry, game: gameDef } = resolveGame(opts);

  const systems = new Map<EntityTypeName, SceneSystem>();
  /** Loaded entities in the scene's order: load's, then adds appended. */
  const byId = new Map<string, RuntimeEntity>();

  let tick = 0;
  /** Events raised by systems, then by the game's hooks, for the tick being stepped. */
  let engineEvents: StepEvent[] = [];
  let gameEvents: StepEvent[] = [];
  let inGameHook = false;
  let play: PlayStart | null = null;
  let project = opts.project ?? null;

  /** Built after the type systems; a type system's factory finds no behavior yet. */
  let host: BehaviorHost | null = null;

  const [gx, gy] = DEFAULT_GRAVITY;
  const physics = createPhysicsWorld(rapier);
  const tags = createColliderTags();
  const ctx: EngineContext = {
    rapier,
    physics,
    view,
    tags,
    attachments: createAttachmentHub(physics, tags),
    registry,
    dev: opts.dev ?? false,
    bounds: [0, 0, 0, 0],
    settings: {
      gravity: [gx, gy],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    gravity: { x: gx, y: gy },
    get tick() {
      return tick;
    },
    emit(event) {
      (inGameHook ? gameEvents : engineEvents).push({ ...event, tick });
    },
    system: <S extends SceneSystem>(type: EntityTypeName) => systems.get(type) as S | undefined,
    get play() {
      return play;
    },
    get project() {
      return project;
    },
    poses: createPoseIndex(() => tick),
    behavior: (name) => host?.system(name),
    sampling: opts.sampling ?? "linear",
  };

  for (const name of registry.spawnGroups.flat()) {
    const type = registry.types.get(name)!;
    systems.set(name, systemFactoryOf(type)(ctx, type));
  }
  const ordered = [...systems.values()];
  const behaviors = createBehaviorHost(ctx, registry);
  host = behaviors;
  const sprites = behaviors.system<SpriteSystem>(SPRITE.name);
  const game: GameRuntime | null = gameDef ? gameDef.createRuntime(ctx) : null;

  /** Each loadable type's geometry fields, for spawn poses. */
  const geometry = new Map<EntityTypeName, GeometryFields>(
    [...systems.keys()].map((name) => [name, geometryFields(registry.types.get(name)!)]),
  );

  /** `e`'s spawn pose (snapped), unless its system posed it itself. */
  function posed(e: RuntimeEntity): void {
    if (!ctx.poses.has(e.id)) {
      const p = spawnPoseOf(e, geometry.get(e.type) ?? []);
      ctx.poses.set(e.id, p.x, p.y, p.rot, { snap: true });
    }
  }

  /** Right after `e`'s system spawned it: its spawn pose, then its behaviors attach and may read it. */
  function entered(e: RuntimeEntity): void {
    posed(e);
    behaviors.attach(e);
  }

  /** Right before `e`'s system despawns it: its behaviors detach, then its pose goes. */
  function leaving(e: RuntimeEntity): void {
    behaviors.detach(e);
    ctx.poses.remove(e.id);
  }

  function inGame<T>(hook: () => T): T {
    inGameHook = true;
    try {
      return hook();
    } finally {
      inGameHook = false;
    }
  }

  /** The scene last loaded; its `entities` go stale once reconciled, so `scene()` rebuilds them from `byId`. */
  let loadedScene: ExpandedScene | null = null;
  let cachedScene: ExpandedScene | null = null;
  let gameLoaded = false;
  let destroyed = false;

  function unload(): void {
    if (gameLoaded) {
      gameLoaded = false;
      inGame(() => game?.onUnload?.());
    }
    for (const e of [...byId.values()].reverse()) leaving(e);
    behaviors.clear();
    for (let i = ordered.length - 1; i >= 0; i--) ordered[i]!.clear();
    for (const id of [...ctx.poses.ids()]) ctx.poses.remove(id);
    ctx.attachments.clear();
    ctx.tags.clear();
    byId.clear();
    loadedScene = null;
    cachedScene = null;
    play = null;
    tick = 0;
  }

  /** Rejects a duplicate id (within `entities`, or loaded when `taken` says so) or an unknown type. */
  function checkEntities(
    entities: readonly RuntimeEntity[],
    taken: (id: string) => boolean,
  ): { ok: false; error: string; entityId: string } | null {
    const seen = new Set<string>();
    for (const e of entities) {
      if (seen.has(e.id) || taken(e.id))
        return { ok: false, error: `duplicate entity id "${e.id}"`, entityId: e.id };
      if (!systems.has(e.type)) {
        return { ok: false, error: `unknown type "${e.type}"`, entityId: e.id };
      }
      seen.add(e.id);
    }
    return null;
  }

  /** `entities` in spawn order: by spawn group, keeping their order inside one. */
  function spawnOrder<T extends { type: EntityTypeName }>(entities: readonly T[]): T[] {
    return entities
      .map((e, i) => [e, i] as const)
      .sort(
        ([a, i], [b, j]) =>
          registry.spawnGroupOf(a.type)! - registry.spawnGroupOf(b.type)! || i - j,
      )
      .map(([e]) => e);
  }

  function reconciled(): void {
    ctx.physics.refreshQueries();
    cachedScene = null;
  }

  /** The play start for `opts`, `at` cast onto the ground when the game has a spawn shape. */
  function resolvePlay(opts: PlayOptions): PlayStart | { error: string } {
    const start: PlayStart = { timeOffsetMs: opts.timeOffsetMs ?? 0 };
    if (opts.game !== undefined) start.game = opts.game;
    if (!opts.at) return start;
    const shape = gameDef?.play?.spawnShape;
    if (!shape) return { ...start, at: { ...opts.at } };
    ctx.physics.refreshQueries();
    const cast = castSpawn(ctx, opts.at, shape);
    return cast.ok ? { ...start, at: cast.at } : { error: cast.error };
  }

  function load(next: ExpandedScene, playOpts?: PlayOptions): LoadReport {
    if (destroyed) return { ok: false, error: "runtime destroyed" };
    const started = now();

    const rejected = checkEntities(next.entities, () => false);
    if (rejected) return rejected;

    unload();
    const gravity = next.settings.gravity;
    ctx.bounds = [...next.bounds];
    ctx.settings = { ...next.settings, gravity: [gravity[0], gravity[1]] };
    ctx.gravity = { x: gravity[0], y: gravity[1] };
    ctx.physics.setGravity(ctx.gravity);

    const counts: Record<EntityTypeName, number> = {};
    let current: string | undefined;
    const spawned: RuntimeEntity[] = [];
    try {
      for (const e of spawnOrder(next.entities)) {
        current = e.id;
        systems.get(e.type)!.spawn(e);
        spawned.push(e);
        entered(e);
        counts[e.type] = (counts[e.type] ?? 0) + 1;
      }
      current = undefined;
      for (const e of next.entities) byId.set(e.id, e);
      const offset = playOpts?.timeOffsetMs ?? 0;
      behaviors.reset();
      if (offset > 0) {
        for (const system of ordered) system.seek?.(offset);
        behaviors.seek(offset);
      }
      if (playOpts) {
        const start = resolvePlay(playOpts);
        if ("error" in start) {
          unload();
          return { ok: false, error: start.error, reason: "spawn-blocked" };
        }
        play = start;
      }
      gameLoaded = true;
      inGame(() => game?.onLoad?.(next));
      ctx.physics.refreshQueries();
    } catch (err) {
      if (byId.size === 0) for (const e of spawned.reverse()) leaving(e);
      unload();
      const error = errorOf(err);
      return current === undefined ? { ok: false, error } : { ok: false, error, entityId: current };
    }

    loadedScene = next;
    cachedScene = next;
    return { ok: true, counts, ms: now() - started };
  }

  function add(entities: RuntimeEntity[]): ReconcileReport {
    if (!loadedScene) return { ok: false, error: "no scene loaded" };
    const rejected = checkEntities(entities, (id) => byId.has(id));
    if (rejected) return rejected;
    if (entities.length === 0) return { ok: true };

    const spawned: RuntimeEntity[] = [];
    for (const e of spawnOrder(entities)) {
      try {
        systems.get(e.type)!.spawn(e);
        entered(e);
      } catch (err) {
        leaving(e);
        systems.get(e.type)!.despawn(e.id);
        for (let i = spawned.length - 1; i >= 0; i--) {
          const s = spawned[i]!;
          leaving(s);
          systems.get(s.type)!.despawn(s.id);
        }
        ctx.physics.refreshQueries();
        return { ok: false, error: errorOf(err), entityId: e.id };
      }
      spawned.push(e);
    }
    for (const e of entities) byId.set(e.id, e);
    reconciled();
    return { ok: true };
  }

  /**
   * Puts `e` in its system in place of `prev`, through the system's fast path
   * when it has one (and then the behaviors' update), else as a despawn and a spawn.
   */
  function replace(e: RuntimeEntity, prev: RuntimeEntity): void {
    const system = systems.get(e.type)!;
    if (e.type === prev.type && system.update) {
      ctx.poses.remove(prev.id);
      system.update(e, prev);
      posed(e);
      behaviors.update(e, prev);
      return;
    }
    leaving(prev);
    systems.get(prev.type)!.despawn(prev.id);
    system.spawn(e);
    entered(e);
  }

  function update(entities: RuntimeEntity[]): ReconcileReport {
    if (!loadedScene) return { ok: false, error: "no scene loaded" };
    const rejected = checkEntities(entities, () => false);
    if (rejected) return rejected;

    const changes = spawnOrder(
      entities.flatMap((e) => {
        const prev = byId.get(e.id);
        return prev && !sameValue(e, prev) ? [{ type: e.type, e, prev }] : [];
      }),
    );
    if (changes.length === 0) return { ok: true };

    for (const [n, { e, prev }] of changes.entries()) {
      try {
        replace(e, prev);
      } catch (err) {
        for (let i = n; i >= 0; i--) {
          const change = changes[i]!;
          leaving(change.e);
          if (i === n) behaviors.detach(change.prev);
          systems.get(change.e.type)!.despawn(change.e.id);
          systems.get(change.prev.type)!.despawn(change.prev.id);
          systems.get(change.prev.type)!.spawn(change.prev);
          entered(change.prev);
        }
        ctx.physics.refreshQueries();
        return { ok: false, error: errorOf(err), entityId: e.id };
      }
    }
    for (const { e } of changes) byId.set(e.id, e);
    reconciled();
    return { ok: true };
  }

  function remove(ids: string[]): void {
    let removed = false;
    for (const id of ids) {
      const e = byId.get(id);
      if (!e) continue;
      leaving(e);
      systems.get(e.type)!.despawn(id);
      byId.delete(id);
      removed = true;
    }
    if (removed) reconciled();
  }

  function step(dtMs: number, actions: InputAction[]): StepResult {
    const t = tick;
    engineEvents = [];
    gameEvents = [];

    for (const system of ordered) system.beforeStep?.(dtMs);
    inGame(() => game?.beforeStep?.(dtMs, actions));
    ctx.physics.step();
    for (const system of ordered) system.afterStep?.(dtMs);
    behaviors.step(dtMs);
    inGame(() => game?.afterStep?.(dtMs, [...engineEvents, ...gameEvents]));
    sprites?.settle();
    ctx.view?.commit?.(t);

    tick++;
    return { tick: t, events: [...engineEvents, ...gameEvents], game: snapshot() };
  }

  function snapshot(): unknown {
    return game ? game.snapshot() : null;
  }

  function stats(): RuntimeStats {
    const perType: Record<EntityTypeName, number> = {};
    for (const [type, system] of systems) {
      const n = system.size();
      if (n > 0) perType[type] = n;
    }
    return {
      bodies: ctx.physics.world.bodies.len(),
      colliders: ctx.physics.world.colliders.len(),
      tags: ctx.tags.size,
      entities: byId.size,
      perType,
      behaviors: behaviors.stats(),
    };
  }

  function destroy(): void {
    if (destroyed) return;
    unload();
    inGame(() => game?.destroy?.());
    ctx.physics.destroy();
    destroyed = true;
  }

  return {
    load,
    unload,
    add,
    update,
    remove,
    get: (id) => byId.get(id),
    step,
    snapshot,
    stats,
    destroy,
    ctx,
    game,
    render: (alpha) => behaviors.render(alpha),
    reloadAssets(next, changed) {
      project = next;
      return behaviors.reloadAssets(changed).map(({ entityId, error, reattached }) => ({
        entityId,
        error: errorOf(error),
        reattached,
      }));
    },
    scene() {
      if (!loadedScene) return null;
      cachedScene ??= { ...loadedScene, entities: [...byId.values()] };
      return cachedScene;
    },
  };
}

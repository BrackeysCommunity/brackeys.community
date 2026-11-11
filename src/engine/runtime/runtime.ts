import { createColliderTags } from "../collider-tags";
import { SPRITE } from "../game/behaviors/sprite";
import { DEFAULT_GRAVITY } from "../game/defaults";
import { createRegistry } from "../game/define";
import { physicsOf, PhysicsRequiredError } from "../game/physics-of";
import { resolveTime } from "../game/time";
import type {
  EngineContext,
  GameCommand,
  GameDefinition,
  GameRuntime,
  PlayStart,
  Registry,
  SceneSystem,
  SpawnInput,
} from "../game/types";
import type { PlayOptions } from "../headless/playtest-types";
import { createPhysicsWorld, type PhysicsWorld } from "../physics";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { EntityTypeName, ExpandedScene, RuntimeEntity } from "../scene/types";
import { createAttachmentHub } from "../systems/attachments";
import type { InputAction } from "../types";
import { createBehaviorHost, type BehaviorHost } from "./behaviors";
import type { SpriteSystem } from "./behaviors/sprite";
import { castSpawn } from "./cast";
import { createContacts, type RuntimeContacts } from "./contacts";
import { createEventBus } from "./events";
import { createGeometryWorld, type GeometryWorld } from "./geometry-world";
import { createGridState, type GridState } from "./grid";
import { createLifecycle, type Lifecycle } from "./lifecycle";
import { runtimeNav } from "./nav";
import { createPoseIndex } from "./poses";
import { systemFactoryOf } from "./primitives";
import { createQueryIndex, type RuntimeQueryIndex } from "./query-index";
import { runRandom } from "./seed";
import { geometrySpace, rapierSpace, type SpaceQuery } from "./space";
import { createTimers, type RuntimeTimers } from "./timers";
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
  /**
   * The tick's events in two buckets, which order `StepResult.events`:
   * raised inside the game's hooks, and everything else. `raised` holds both
   * in raise order, for the tick's dispatch points.
   */
  let engineEvents: StepEvent[] = [];
  let gameEvents: StepEvent[] = [];
  let raised: StepEvent[] = [];
  let inGameHook = false;
  let stepping = false;
  let seeking = false;
  let play: PlayStart | null = null;
  let project = opts.project ?? null;

  /** Built after the type systems; a type system's factory finds no behavior yet. */
  let host: BehaviorHost | null = null;

  const [gx, gy] = DEFAULT_GRAVITY;
  const time = resolveTime({ project: opts.project?.engine, game: registry.time });
  /**
   * Made at the first load that runs on Rapier and kept: later loads empty
   * it, so handles allocate as they would in a world made up front.
   */
  let world: PhysicsWorld | null = null;
  /** Whether the scene loaded (or loading) runs on Rapier; `ctx.rapier` and `ctx.physics` are null otherwise. */
  let onRapier = false;
  const tags = createColliderTags();
  /**
   * The engine's colliders for loads without physics, made at the first
   * one and kept, emptied between loads as the Rapier world is.
   */
  let geometryWorld: GeometryWorld | null = null;
  let geometryQueries: SpaceQuery | null = null;
  /** Built once `ctx` exists, since both read it. */
  let rapierQueries: SpaceQuery | null = null;
  let space: SpaceQuery | null = null;
  let grid: GridState | null = null;
  const events = createEventBus({ dev: opts.dev ?? false });
  /** Built once `ctx` exists, since each reads it; `lifecycle` once the systems and behaviors are. */
  let timers: RuntimeTimers;
  let query: RuntimeQueryIndex;
  let contacts: RuntimeContacts;
  let lifecycle: Lifecycle;
  let random = runRandom(registry, "");
  const ctx: EngineContext = {
    get rapier() {
      return onRapier ? (rapier ?? null) : null;
    },
    get physics() {
      return onRapier ? world : null;
    },
    geometry: null,
    get space() {
      return space!;
    },
    time,
    get grid() {
      return grid?.current ?? null;
    },
    get nav() {
      return runtimeNav(ctx);
    },
    view,
    tags,
    attachments: createAttachmentHub((id) => physicsOf(ctx, "attach", id).physics, tags),
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
      const raisedEvent = { ...event, tick };
      (inGameHook ? gameEvents : engineEvents).push(raisedEvent);
      raised.push(raisedEvent);
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
    spawn: <E extends RuntimeEntity = RuntimeEntity>(input: SpawnInput) =>
      lifecycle.spawn(input) as E,
    destroy: (id) => lifecycle.destroy(id),
    setEnabled: (id, enabled) => lifecycle.setEnabled(id, enabled),
    enabled: (id) => lifecycle.enabled(id),
    exists: (id) => lifecycle.exists(id),
    get: (id) => lifecycle.get(id),
    get seeking() {
      return seeking;
    },
    events,
    instantiate: (prefab, at, instantiateOpts) =>
      lifecycle.instantiate(prefab, at, instantiateOpts),
    get timers() {
      return timers;
    },
    get random() {
      return random;
    },
    get query() {
      return query;
    },
    get contacts() {
      return contacts;
    },
  };
  timers = createTimers(ctx);
  query = createQueryIndex(ctx);
  contacts = createContacts(ctx);
  rapierQueries = rapierSpace(ctx);
  space = rapierQueries;
  const gridState = createGridState(ctx, registry);
  grid = gridState;
  /** The types whose shapes are grid walls, as `createGridState` reads them. */
  const wallTypes: ReadonlySet<EntityTypeName> = new Set(
    registry.game?.world?.gridWalls ?? ["solid"],
  );
  /** A wall-type entity spawned or was destroyed since the grid last synced. */
  let wallsMoved = false;
  /** Game code spawned or destroyed since the load began, so the loaded scene's list is stale. */
  let tableChanged = false;

  for (const name of registry.spawnGroups.flat()) {
    const type = registry.types.get(name)!;
    systems.set(name, systemFactoryOf(type)(ctx, type));
  }
  const ordered = [...systems.values()];
  const behaviors = createBehaviorHost(ctx, registry);
  host = behaviors;
  const sprites = behaviors.system<SpriteSystem>(SPRITE.name);
  lifecycle = createLifecycle({
    ctx,
    registry,
    systems,
    behaviors,
    entities: byId,
    events,
    timers,
    query,
    contacts,
    stepping: () => stepping,
    changed(type) {
      cachedScene = null;
      tableChanged = true;
      if (wallTypes.has(type)) wallsMoved = true;
    },
    settled: syncMovedWalls,
  });
  const { posed, entered, leaving, checkEntities, spawnOrder, spawnEntity, despawnEntity } =
    lifecycle;
  const game: GameRuntime | null = gameDef ? gameDef.createRuntime(ctx) : null;

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
    timers.reset();
    events.clear();
    query.clear();
    contacts.clear();
    lifecycle.reset();
    ctx.attachments.clear();
    ctx.tags.clear();
    gridState.clear();
    geometryWorld?.clear();
    ctx.geometry = null;
    space = rapierQueries;
    onRapier = false;
    byId.clear();
    loadedScene = null;
    cachedScene = null;
    wallsMoved = false;
    tableChanged = false;
    play = null;
    tick = 0;
  }

  /** Re-rasterises the grid's walls once a wall-type entity spawned or went outside a reconcile. */
  function syncMovedWalls(): void {
    if (!wallsMoved || !loadedScene) return;
    wallsMoved = false;
    gridState.sync(currentScene());
  }

  function reconciled(): void {
    ctx.physics?.refreshQueries();
    cachedScene = null;
    wallsMoved = false;
    gridState.sync(currentScene());
  }

  /** The play start for `opts`, `at` cast onto the ground when the game has a spawn shape. */
  function resolvePlay(opts: PlayOptions): PlayStart | { error: string } {
    const start: PlayStart = { timeOffsetMs: opts.timeOffsetMs ?? 0 };
    if (opts.game !== undefined) start.game = opts.game;
    if (!opts.at) return start;
    const shape = gameDef?.play?.spawnShape;
    if (!shape) return { ...start, at: { ...opts.at } };
    ctx.physics?.refreshQueries();
    const cast = castSpawn(ctx, opts.at, shape);
    return cast.ok ? { ...start, at: cast.at } : { error: cast.error };
  }

  function load(next: ExpandedScene, playOpts?: PlayOptions): LoadReport {
    if (destroyed) return { ok: false, error: "runtime destroyed" };
    const started = now();

    const rejected = checkEntities(next.entities, () => false);
    if (rejected) return rejected;
    if (next.settings.physics === "rapier" && !rapier) {
      return {
        ok: false,
        error: "this scene runs on Rapier, and the host loaded no Rapier module",
        reason: "physics-not-loaded",
      };
    }

    unload();
    const gravity = next.settings.gravity;
    ctx.bounds = [...next.bounds];
    ctx.settings = { ...next.settings, gravity: [gravity[0], gravity[1]] };
    ctx.gravity = { x: gravity[0], y: gravity[1] };
    if (rapier && next.settings.physics === "rapier") {
      world ??= createPhysicsWorld(rapier, { gravity: ctx.gravity, timestep: 1 / time.rate });
      onRapier = true;
    } else {
      geometryWorld ??= createGeometryWorld(registry);
      geometryQueries ??= geometrySpace(geometryWorld, tags, registry);
      ctx.geometry = geometryWorld;
      space = geometryQueries;
    }
    ctx.physics?.setGravity(ctx.gravity);
    gridState.load(next);
    lifecycle.load(
      typeof opts.prefabs === "function" ? opts.prefabs() : (opts.prefabs ?? new Map()),
    );
    random = runRandom(registry, next.name, playOpts?.seed);

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
      lifecycle.ready(spawned);
      const offset = playOpts?.timeOffsetMs ?? 0;
      behaviors.reset();
      if (offset > 0) {
        seeking = true;
        try {
          for (const system of ordered) system.seek?.(offset);
          behaviors.seek(offset);
          timers.seek(Math.floor((offset * time.rate) / 1000));
        } finally {
          seeking = false;
        }
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
      ctx.physics?.refreshQueries();
    } catch (err) {
      if (byId.size === 0) for (const e of spawned.reverse()) leaving(e);
      unload();
      const report: Extract<LoadReport, { ok: false }> = { ok: false, error: errorOf(err) };
      const entityId = current ?? (err instanceof PhysicsRequiredError ? err.entityId : undefined);
      if (entityId !== undefined) report.entityId = entityId;
      if (err instanceof PhysicsRequiredError) report.reason = "physics-required";
      return report;
    }

    loadedScene = next;
    cachedScene = tableChanged ? null : next;
    syncMovedWalls();
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
        spawnEntity(e);
      } catch (err) {
        for (let i = spawned.length - 1; i >= 0; i--) despawnEntity(spawned[i]!);
        ctx.physics?.refreshQueries();
        return { ok: false, error: errorOf(err), entityId: e.id };
      }
      spawned.push(e);
    }
    for (const e of entities) byId.set(e.id, e);
    lifecycle.ready(spawned);
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
      lifecycle.updated(e);
      return;
    }
    despawnEntity(prev, { keepOwned: true });
    spawnEntity(e);
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
          spawnEntity(change.prev);
        }
        ctx.physics?.refreshQueries();
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
      despawnEntity(e);
      byId.delete(id);
      removed = true;
    }
    if (removed) reconciled();
  }

  function step(
    dtMs: number,
    actions: InputAction[],
    commands?: readonly GameCommand[],
  ): StepResult {
    const t = tick;
    engineEvents = [];
    gameEvents = [];
    raised = [];

    stepping = true;
    try {
      for (const system of ordered) system.beforeStep?.(dtMs);
      inGame(() => game?.beforeStep?.(dtMs, actions, commands ?? []));
      ctx.physics?.step();
      for (const system of ordered) system.afterStep?.(dtMs);
      contacts.read();
      behaviors.step(dtMs);
      timers.run();
      const delivered = events.dispatch(raised, 0);
      inGame(() => game?.afterStep?.(dtMs, [...engineEvents, ...gameEvents]));
      lifecycle.flush();
      events.dispatch(raised, delivered);
    } finally {
      stepping = false;
    }
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
    const physics = ctx.physics;
    return {
      backend: ctx.settings.physics === "none" ? "geometry" : "rapier",
      bodies: physics ? physics.world.bodies.len() : (ctx.geometry?.size ?? 0),
      colliders: physics ? physics.world.colliders.len() : (ctx.geometry?.size ?? 0),
      tags: ctx.tags.size,
      entities: byId.size,
      perType,
      behaviors: behaviors.stats(),
    };
  }

  /** The loaded scene with every reconcile since applied, or null. */
  function currentScene(): ExpandedScene | null {
    if (!loadedScene) return null;
    cachedScene ??= { ...loadedScene, entities: [...byId.values()] };
    return cachedScene;
  }

  function destroy(): void {
    if (destroyed) return;
    unload();
    inGame(() => game?.destroy?.());
    world?.destroy();
    world = null;
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
    busy: () => game?.busy?.() ?? false,
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
    scene: currentScene,
  };
}

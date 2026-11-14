import { createColliderTags } from "../collider-tags";
import { SPRITE } from "../game/behaviors/sprite";
import { DEFAULT_GRAVITY } from "../game/defaults";
import { createRegistry } from "../game/define";
import {
  flowIssue,
  type FlowRequest,
  type LibraryScene,
  type SceneLibrary,
  type SublevelInfo,
} from "../game/flow";
import { physicsOf, PhysicsRequiredError } from "../game/physics-of";
import { sublevelLabelOf } from "../game/runtime-ids";
import { SAVE_RANDOM_KEY, type SavedSystems, type WorldState } from "../game/save-file";
import { isCount, resolveTime, wholeTicksIn } from "../game/time";
import {
  EngineError,
  type EngineContext,
  type GameCommand,
  type GameDefinition,
  type DeviceId,
  type GameRuntime,
  type JsonValue,
  type PlayStart,
  type Registry,
  type SaveRequest,
  type SceneSystem,
  type SpawnInput,
} from "../game/types";
import type { PlayOptions } from "../headless/playtest-types";
import { resolvePlayers } from "../input/players";
import { createInputState } from "../input/state";
import { tickInputOf, type SeatChange, type TickInput } from "../input/stream";
import { SAVE_REGISTRY, type SaveEntry, type SaveRegistry } from "../motion/body";
import { createPhysicsWorld, type PhysicsWorld } from "../physics";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId, Sha256 } from "../project/types";
import { errorText, ISSUE_CODES, makeIssue } from "../scene/issues";
import type {
  Bounds,
  EntityTypeName,
  ExpandedScene,
  IssueCode,
  PrefabLibrary,
  RuntimeEntity,
  SceneIssue,
} from "../scene/types";
import { Rng, type RngState } from "../sim-kit/rng";
import { createAttachmentHub } from "../systems/attachments";
import type { InputAction } from "../types";
import { createBehaviorHost, type BehaviorHost } from "./behaviors";
import { animContext } from "./behaviors/anim";
import type { SpriteSystem } from "./behaviors/sprite";
import { tweensContext } from "./behaviors/tween";
import { createBodyControl, type RuntimeBodyControl } from "./bodies-control";
import { castSpawn } from "./cast";
import { createContacts, type RuntimeContacts, type SavedTouch } from "./contacts";
import { createEntityHandles, type EntityHandles } from "./entities";
import { EntityTable } from "./entity-table";
import { createEventBus, EVENT_PASS_LIMIT } from "./events";
import {
  createSublevels,
  FLOW_LOADER,
  readSceneLibrary,
  type FlowIdentity,
  type FlowLoader,
} from "./flow";
import { createGeometryWorld, type GeometryWorld } from "./geometry-world";
import { createGridState, gridWallTypes, type GridState } from "./grid";
import { createLifecycle, type Lifecycle } from "./lifecycle";
import { overlayLibrary } from "./live";
import { createLookups, type Lookups } from "./lookups";
import { runtimeNav } from "./nav";
import { gamePersistCell, playClockOf, type PlayClock } from "./persist";
import { LOAD_GENERATION } from "./pool";
import { createPoseIndex, relativePose } from "./poses";
import { createPresentationQueue } from "./present";
import { systemFactoryOf } from "./primitives";
import { createQueryIndex, type RuntimeQueryIndex } from "./query-index";
import { runRandom } from "./seed";
import { createSetPose } from "./set-pose";
import { geometrySpace, rapierSpace, type SpaceQuery } from "./space";
import { swapRuntime, type SwapHost } from "./swap";
import { createTimers, type RuntimeTimers, type UnsaveableTimer } from "./timers";
import type { RuntimeSceneTree } from "./tree";
import type {
  LoadReport,
  ReconcileReport,
  RuntimeRequests,
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

/** The key a runtime keeps what world saves reach under on its context. */
export const SAVE_HOST: unique symbol = Symbol("save host");

/** `world.systems` keys of the runtime's own parts; `@` can't begin an entity id. */
export const SAVE_TIMERS_KEY = "@timers";
export const SAVE_CONTACTS_KEY = "@contacts";
export const SAVE_INPUT_KEY = "@input";
/**
 * What `world.parents` can't say: `locals`, the local poses a fresh measure
 * wouldn't give back exactly (a disabled child's, kept while its parent
 * moved, or one off by rounding); `children`, the child order of each
 * parent `parents` names. A restored run then composes and walks its
 * children as the saved one did.
 */
const SAVE_TREE_KEY = "@tree";

type SavedTree = {
  locals?: Record<string, [number, number, number]>;
  children?: Record<string, string[]>;
};

/** What capture and restore reach inside a runtime, kept off the public `EngineContext`. */
export type SaveHost = {
  /** The loaded main scene as it loaded, or null. */
  mainScene(): ExpandedScene | null;
  /** The main scene's flow id, else its name; null before a load. */
  sceneId(): AssetId | null;
  /** The prefab library the run froze at its load. */
  prefabs(): PrefabLibrary;
  /** The play options the main scene loaded with. */
  play(): PlayOptions | undefined;
  stepping(): boolean;
  /** Pending function-form timers and coroutines. */
  unsaveable(): UnsaveableTimer[];
  /** Loads the main scene again, fresh, as it loaded last: its flow identity and play options. */
  reloadMain(): LoadReport;
  captureWorld(): WorldState;
  /** Brings a fresh load to `world`; an issue when a saved part can't be put back. */
  restoreWorld(world: WorldState, sublevels: readonly SublevelInfo[]): SceneIssue | null;
  /** Ticks played under the runtime's persist cell, across its scenes. */
  playClock(): PlayClock;
};

/** A load outside flow naming its scene's asset id. */
type PlayedAs = { sceneId: AssetId };

/**
 * The `live` option as the runtime reads it. A live layer's hooks also
 * answer `sublevel`: the scene an attach of `id` uses in place of the run's
 * library's when its active version moved since the load, else null.
 */
type RuntimeLive = NonNullable<SceneRuntimeOptions["live"]> & {
  sublevel?(id: AssetId): LibraryScene | null;
  /**
   * While a load of `scene` runs, before it has its scene: the version that
   * load plays; `back` when a swap puts back the version it left.
   */
  loading?(scene: AssetId, back?: boolean): Sha256 | null;
};

export function saveHostOf(ctx: EngineContext): SaveHost | undefined {
  return (ctx as EngineContext & { [SAVE_HOST]?: SaveHost })[SAVE_HOST];
}

const setRngState = (rng: Rng, state: RngState) => void Object.assign(rng, Rng.restore(state));

/**
 * `ctx.random`'s forks, tracked by label path (`a/b` for a fork of fork
 * `a`) and, from a path's second fork on, its occurrence (`a#2`), so a
 * world save holds every stream and a restore matches them in the order
 * they were made. A saved fork the restored run hasn't made yet takes its
 * state when it is made.
 */
function createForkBook() {
  const forks = new Map<string, Rng>();
  const made = new Map<string, number>();
  let waiting = new Map<string, RngState>();

  function track(rng: Rng, path: string): Rng {
    const fork = rng.fork.bind(rng);
    rng.fork = (label) => {
      const at = path === "" ? label : `${path}/${label}`;
      const n = (made.get(at) ?? 0) + 1;
      made.set(at, n);
      const key = n === 1 ? at : `${at}#${n}`;
      const child = track(fork(label), key);
      forks.set(key, child);
      const saved = waiting.get(key);
      if (saved) {
        waiting.delete(key);
        setRngState(child, saved);
      }
      return child;
    };
    return rng;
  }

  return {
    root: (rng: Rng) => track(rng, ""),
    /** Every stream's state, a restored one the run hasn't forked again yet included. */
    states(): Record<string, JsonValue> {
      return {
        ...Object.fromEntries([...waiting].map(([key, state]) => [key, [...state]])),
        ...Object.fromEntries([...forks].map(([key, rng]) => [key, [...rng.snapshot()]])),
      };
    },
    restore(states: Readonly<Record<string, JsonValue>>): void {
      waiting = new Map();
      for (const [key, state] of Object.entries(states)) {
        const fork = forks.get(key);
        if (fork) setRngState(fork, state as unknown as RngState);
        else waiting.set(key, state as unknown as RngState);
      }
    },
    clear(): void {
      forks.clear();
      made.clear();
      waiting.clear();
    },
  };
}

/** What game code made for entities that holds world-save state, by entity id then owner, in registration order. */
function createSaveRegistry() {
  const entries = new Map<string, Map<string, SaveEntry>>();
  const registry: SaveRegistry & {
    entries: typeof entries;
    clear(): void;
  } = {
    entries,
    register(entityId, owner, entry) {
      let owners = entries.get(entityId);
      if (!owners) entries.set(entityId, (owners = new Map()));
      owners.set(owner, entry);
      return () => {
        const now = entries.get(entityId);
        if (now?.get(owner) !== entry) return;
        now.delete(owner);
        if (now.size === 0) entries.delete(entityId);
      };
    },
    clear: () => entries.clear(),
  };
  return registry;
}

/** A seat's held input in a world save: each action's `[value]` or `[x, y]`, and its pointer. */
type SavedSeatInput = {
  actions?: Record<string, number[]>;
  pointer?: { x: number; y: number; buttons: number; over: boolean };
};

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
  const byId = new EntityTable();

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
  const events = createEventBus({
    dev: opts.dev ?? false,
    under: (candidate, id) => tree.isUnder(candidate, id),
  });
  /** Built once `ctx` exists, since each reads it; `lifecycle` once the systems and behaviors are. */
  let timers: RuntimeTimers;
  let query: RuntimeQueryIndex;
  let contacts: RuntimeContacts;
  let lifecycle: Lifecycle;
  let bodies: RuntimeBodyControl;
  let handles: EntityHandles;
  let lookups: Lookups;
  let tree: RuntimeSceneTree;
  let setPose: EngineContext["setPose"];
  const forks = createForkBook();
  let random = forks.root(runRandom(registry, ""));
  const saveRegistry = createSaveRegistry();
  /** Scene and sublevel entities as loaded and attached: what a fresh load and its sublevels make again. */
  const authored = new Set<string>();
  /** The play options the main scene loaded with, for a world save's fresh load. */
  let lastPlay: PlayOptions | undefined;
  const input = createInputState(registry, resolvePlayers(opts.project?.inputMap, registry.game));
  // Without a view the runtime is headless, which checks what the game sets as dev does.
  const persist = opts.persist ?? gamePersistCell(gameDef, (opts.dev ?? false) || view === null);
  const playClock = playClockOf(persist);
  /** Requests game code made since the host last took them. */
  let flowRequest: FlowRequest | null = null;
  let saveRequests: SaveRequest[] = [];
  /** The loaded scene's place in flow: null for a load that didn't come through `loadListed`. */
  let flowScene: AssetId | null = null;
  let flowEntry: string | null = null;
  /** The scene's asset id given by a load outside flow whose scene plays under another name (editor Play). */
  let playedAs: AssetId | null = null;
  /** The loaded scene's asset id: its flow scene, else the id its load gave, else its name. */
  const sceneIdNow = (): AssetId | null => flowScene ?? playedAs ?? mainScene?.name ?? null;
  /** The scene library the loaded scene's run keeps, read once at its load. */
  let runScenes: SceneLibrary | null = null;
  const live: RuntimeLive = opts.live ?? { version: () => null, boundary: () => {} };
  /** One queue per runtime: a request made outside a step joins the next tick's list. */
  const present = createPresentationQueue({
    record: opts.recordPresentation ?? false,
    tick: () => tick,
  });
  const behaviorOf: EngineContext["behavior"] = (name) => host?.system(name);
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
    behavior: behaviorOf,
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
    input,
    flow: {
      get scene() {
        return flowScene;
      },
      get entry() {
        return flowEntry;
      },
      request(req) {
        if (flowRequest) {
          if (opts.dev)
            console.warn(
              `[flow] dropped the request for "${req.to}": "${flowRequest.to}" was requested first this tick`,
            );
          return;
        }
        const listed = opts.dev ? readSceneLibrary(opts.scenes) : null;
        if (listed) {
          const refused = flowIssue(listed.list, req.to, "go");
          if (refused) console.warn(`[flow] the request will be refused: ${refused.message}`);
        }
        flowRequest = { ...req };
      },
      attach(scene, attachOpts) {
        const result = sublevels.attach(scene, attachOpts);
        if (result.ok) ctx.physics?.refreshQueries();
        return result;
      },
      detach(label) {
        sublevels.detach(label);
        for (const id of authored) if (sublevelLabelOf(id) === label) authored.delete(id);
      },
      sublevels: () => sublevels.list(),
    },
    persist: {
      get value() {
        return persist.value;
      },
      set: (next) => persist.set(next),
    },
    saves: {
      request(slot, saveOpts) {
        saveRequests.push({ slot, ...saveOpts });
      },
    },
    get bodies() {
      return bodies;
    },
    live: {
      get version() {
        // Inside a load (the game's `onLoad`) the host's runtime may still be the one before.
        const loading = loadedScene === null ? sceneIdNow() : null;
        return loading !== null && live.loading
          ? live.loading(loading, loadingBack)
          : live.version();
      },
      boundary: (label) => live.boundary(label),
    },
    present: present.queue,
    anim: animContext({ behavior: behaviorOf }),
    tweens: tweensContext({ behavior: behaviorOf }),
    entity: (id) => handles.entity(id),
    get entities() {
      return lookups.entities;
    },
    setPose: (id, x, y, rot, poseOpts) => setPose(id, x, y, rot, poseOpts),
    get findBehavior() {
      return lookups.findBehavior;
    },
    get findBehaviors() {
      return lookups.findBehaviors;
    },
    get tree() {
      return tree;
    },
  };
  bodies = createBodyControl(ctx);
  timers = createTimers(ctx);
  query = createQueryIndex(ctx);
  contacts = createContacts(ctx);
  rapierQueries = rapierSpace(ctx);
  space = rapierQueries;
  const wallTypes = gridWallTypes(registry);
  const gridState = createGridState(ctx, registry, wallTypes);
  grid = gridState;
  /** A wall-type entity spawned or was destroyed since the grid last synced. */
  let wallsMoved = false;
  /** Game code spawned or destroyed since the load began, so the loaded scene's list is stale. */
  let tableChanged = false;

  for (const name of registry.spawnGroups.flat()) {
    const type = registry.types.get(name)!;
    systems.set(name, systemFactoryOf(type)(ctx, type));
  }
  const ordered = [...systems.values()];
  /** With a collector, each step is one span of its `tick` scope, split at the laps `step` takes. */
  const tickTiming = opts.timing?.scope("tick") ?? null;
  const beforeStepParts = [...systems.keys()].map((type) => `system.${type}.beforeStep`);
  const beforePhysicsParts = [...systems.keys()].map((type) => `system.${type}.beforePhysics`);
  const afterStepParts = [...systems.keys()].map((type) => `system.${type}.afterStep`);
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
    attached: (label) => sublevels.has(label),
  });
  const sublevels = createSublevels({
    ctx,
    registry,
    library: attachLibrary,
    main: () => mainScene,
    holds: (label) => lifecycle.holdsSublevel(label),
    place(entities) {
      lifecycle.place(entities);
      for (const e of entities) authored.add(e.id);
    },
    destroy: (label) => lifecycle.destroySublevel(label),
    bounds(rects) {
      if (!mainScene) return;
      const b = [...mainScene.bounds] as Bounds;
      for (const [x0, y0, x1, y1] of rects) {
        b[0] = Math.min(b[0], x0);
        b[1] = Math.min(b[1], y0);
        b[2] = Math.max(b[2], x1);
        b[3] = Math.max(b[3], y1);
      }
      ctx.bounds = b;
      gridState.extend(rects);
    },
  });
  const { posed, entered, leaving, checkEntities, spawnOrder, spawnEntity, despawnEntity } =
    lifecycle;
  setPose = createSetPose({
    ctx,
    systems,
    behaviors,
    get: (id) => lifecycle.get(id),
    enabled: (id) => lifecycle.enabled(id),
  });
  handles = createEntityHandles({
    ctx,
    behaviors,
    entities: byId,
    enabledSelf: (id) => lifecycle.enabledSelf(id),
  });
  lookups = createLookups({ ctx, behaviors, query, handles });
  tree = lifecycle.tree;
  Object.defineProperty(ctx, LOAD_GENERATION, { value: () => lifecycle.generation });
  const flowLoader: FlowLoader = {
    read: () => readSceneLibrary(opts.scenes),
    current: () => runScenes,
    stepping: () => stepping,
    load: (scene, playOpts, flow) => load(scene, playOpts, flow),
  };
  Object.defineProperty(ctx, FLOW_LOADER, { value: flowLoader });
  Object.defineProperty(ctx, SAVE_REGISTRY, { value: saveRegistry });
  const game: GameRuntime | null = gameDef ? gameDef.createRuntime(ctx) : null;

  /** The run's library, with each scene whose live version moved since the load as the live layer has it now. */
  function attachLibrary(): SceneLibrary | null {
    const library = runScenes;
    if (!library || !live.sublevel) return library;
    return overlayLibrary(library, (id) => live.sublevel?.(id) ?? null);
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
  /** The main scene from the start of its load, so its `onLoad` may attach sublevels beside it. */
  let mainScene: ExpandedScene | null = null;
  /** While a swap's load puts back the version the swap left. */
  let loadingBack = false;
  let cachedScene: ExpandedScene | null = null;
  /** The prefab library a swap froze for the main scene's version, which reloading it uses; null until a swap. */
  let versionPrefabs: PrefabLibrary | null = null;
  let gameLoaded = false;
  let destroyed = false;

  function unload(): void {
    if (gameLoaded) {
      gameLoaded = false;
      inGame(() => game?.onUnload?.());
    }
    sublevels.clear();
    for (const e of [...byId.values()].reverse()) leaving(e);
    behaviors.clear();
    for (let i = ordered.length - 1; i >= 0; i--) ordered[i]!.clear();
    bodies.reset();
    for (const id of [...ctx.poses.ids()]) ctx.poses.remove(id);
    timers.reset();
    saveRegistry.clear();
    authored.clear();
    events.clear();
    query.clear();
    contacts.clear();
    lifecycle.reset();
    handles.clear();
    ctx.attachments.clear();
    ctx.tags.clear();
    gridState.clear();
    geometryWorld?.clear();
    ctx.geometry = null;
    space = rapierQueries;
    onRapier = false;
    byId.clear();
    loadedScene = null;
    mainScene = null;
    cachedScene = null;
    versionPrefabs = null;
    wallsMoved = false;
    tableChanged = false;
    play = null;
    tick = 0;
    flowRequest = null;
    saveRequests = [];
    present.take();
    flowScene = null;
    flowEntry = null;
    playedAs = null;
  }

  function takeRequests(): RuntimeRequests {
    const taken = { flow: flowRequest, saves: saveRequests };
    flowRequest = null;
    saveRequests = [];
    return taken;
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

  /** `startTick`: where `ctx.tick` starts, for a swap's reload that keeps the run's tick; default 0. */
  function load(
    next: ExpandedScene,
    playOpts?: PlayOptions,
    flow?: FlowIdentity | PlayedAs,
    library?: PrefabLibrary,
    startTick = 0,
  ): LoadReport {
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
    tick = startTick;
    mainScene = next;
    versionPrefabs = library ?? null;
    lastPlay = playOpts;
    if (flow && "library" in flow) {
      runScenes = flow.library;
      flowScene = flow.scene;
      flowEntry = flow.entry;
    } else {
      runScenes = readSceneLibrary(opts.scenes);
      if (flow) playedAs = flow.sceneId;
    }
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
      library ??
        (typeof opts.prefabs === "function" ? opts.prefabs() : (opts.prefabs ?? new Map())),
    );
    forks.clear();
    random = forks.root(runRandom(registry, next.name, playOpts?.seed));

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
      for (const e of next.entities) {
        byId.set(e.id, e);
        authored.add(e.id);
      }
      lifecycle.link(next.entities);
      lifecycle.ready(spawned);
      const offset = playOpts?.timeOffsetMs ?? 0;
      behaviors.reset();
      if (offset > 0) {
        seeking = true;
        try {
          for (const system of ordered) system.seek?.(offset);
          behaviors.seek(offset);
          timers.seek(wholeTicksIn(offset, time).ticks);
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
      const report: Extract<LoadReport, { ok: false }> = { ok: false, error: errorText(err) };
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
        return { ok: false, error: errorText(err), entityId: e.id };
      }
      spawned.push(e);
    }
    for (const e of entities) byId.set(e.id, e);
    const added = new Set(entities.map((e) => e.id));
    const adopted = [...byId.values()].filter(
      (e) =>
        !added.has(e.id) &&
        e.parent !== undefined &&
        added.has(e.parent) &&
        tree.parent(e.id) === null,
    );
    lifecycle.link([...entities, ...adopted]);
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
    const wasDisabled = !lifecycle.enabled(prev.id);
    despawnEntity(prev, { keepOwned: true });
    spawnEntity(e);
    if (wasDisabled) lifecycle.keepDisabled(e);
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

    const off = changes.map(({ prev }) => !lifecycle.enabled(prev.id));
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
          if (off[i]) lifecycle.keepDisabled(change.prev);
        }
        ctx.physics?.refreshQueries();
        return { ok: false, error: errorText(err), entityId: e.id };
      }
    }
    for (const { e } of changes) byId.set(e.id, e);
    const unlinked = relink(changes);
    reconciled();
    return unlinked ?? { ok: true };
  }

  /**
   * After an edit replaced records: one whose `parent` changed moves under
   * the new one (or becomes a root when that isn't live), keeping the pose
   * the edit gave it; the rest stay where they are among their siblings,
   * measured anew and asked to ride again, with their children, since a
   * respawn rebuilt their colliders and bodies. A parent the tree refuses
   * (a cycle, another sublevel) is the edit's refusal.
   */
  function relink(
    changes: readonly { e: RuntimeEntity; prev: RuntimeEntity }[],
  ): Extract<ReconcileReport, { ok: false }> | null {
    let refused: Extract<ReconcileReport, { ok: false }> | null = null;
    const refresh = new Set<string>();
    for (const { e, prev } of changes) {
      if ((e.parent ?? null) !== (prev.parent ?? null)) {
        const parent = e.parent !== undefined && e.parent !== e.id && byId.has(e.parent);
        try {
          tree.setParent(e.id, parent ? e.parent! : null);
        } catch (err) {
          refused ??= { ok: false, error: errorText(err), entityId: e.id };
        }
      } else {
        const parent = tree.parent(e.id);
        if (parent !== null) refresh.add(parent);
      }
      refresh.add(e.id);
    }
    const again = [...refresh].flatMap((id) => childrenOf(id, tree.children(id)));
    if (again.length > 0) tree.link(again);
    return refused;
  }

  function remove(ids: string[]): void {
    let removed = false;
    const going = new Set(ids);
    for (const id of ids) {
      const e = byId.get(id);
      if (!e) continue;
      for (const child of tree.children(id)) if (!going.has(child)) tree.setParent(child, null);
      despawnEntity(e);
      byId.delete(id);
      removed = true;
    }
    if (removed) reconciled();
  }

  function step(
    dtMs: number,
    given: TickInput | InputAction[],
    commands?: readonly GameCommand[],
  ): StepResult {
    const t = tick;
    engineEvents = [];
    gameEvents = [];
    raised = [];
    const timed = tickTiming?.begin() ? tickTiming : null;
    const tickInput = tickInputOf(given, commands, t);

    stepping = true;
    try {
      for (const event of input.update(tickInput)) ctx.emit(event);
      timed?.lap("input");
      for (let i = 0; i < ordered.length; i++) {
        const system = ordered[i]!;
        if (!system.beforeStep) continue;
        system.beforeStep(dtMs);
        timed?.lap(beforeStepParts[i]!);
      }
      if (game?.beforeStep) {
        inGame(() => game.beforeStep!(dtMs, tickInput.actions, tickInput.commands));
        timed?.lap("game.beforeStep");
      }
      behaviors.beforeStep(dtMs, timed);
      if (ctx.physics) {
        for (let i = 0; i < ordered.length; i++) {
          const system = ordered[i]!;
          if (!system.beforePhysics) continue;
          system.beforePhysics();
          timed?.lap(beforePhysicsParts[i]!);
        }
        behaviors.beforePhysics(timed);
        bodies.flush();
        ctx.physics.step();
        timed?.lap("physics.step");
        bodies.clear();
      } else behaviors.beforePhysics(timed);
      for (let i = 0; i < ordered.length; i++) {
        const system = ordered[i]!;
        if (!system.afterStep) continue;
        system.afterStep(dtMs);
        timed?.lap(afterStepParts[i]!);
      }
      contacts.read();
      timed?.lap("contacts");
      behaviors.step(dtMs, timed);
      timers.run();
      timed?.lap("timers");
      const delivered = events.dispatch(raised, 0);
      timed?.lap("events");
      if (game?.afterStep) {
        inGame(() => game.afterStep!(dtMs, [...engineEvents, ...gameEvents]));
        timed?.lap("game.afterStep");
      }
      lifecycle.flush();
      timed?.lap("lifecycle");
      const second = { delivered: 0 };
      let next = events.dispatch(raised, delivered, second);
      timed?.lap("events");
      for (let flushes = 1; lifecycle.pending(); flushes++) {
        if (flushes >= EVENT_PASS_LIMIT) {
          throw new EngineError(
            "event-loop",
            `the end-of-tick flush needed more than ${EVENT_PASS_LIMIT} passes; event handlers are destroying in a loop`,
          );
        }
        lifecycle.flush();
        timed?.lap("lifecycle");
        next = events.dispatch(raised, next, second);
        timed?.lap("events");
      }
    } finally {
      stepping = false;
      bodies.endTick();
    }
    if (sprites || ctx.view?.commit) {
      sprites?.settle();
      ctx.view?.commit?.(t);
      timed?.lap("view.commit");
    }

    tick++;
    playClock.ticks++;
    const result: StepResult = { tick: t, events: [...engineEvents, ...gameEvents], game: null };
    if (opts.recordPresentation) result.present = present.take();
    result.game = snapshot();
    if (game) timed?.lap("game.snapshot");
    timed?.end();
    return result;
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
      ...(opts.timing?.enabled ? { timing: opts.timing.report() } : {}),
    };
  }

  /** The loaded scene with every reconcile since applied, or null. */
  function currentScene(): ExpandedScene | null {
    if (!loadedScene) return null;
    cachedScene ??= { ...loadedScene, entities: [...byId.values()] };
    return cachedScene;
  }

  // ─── World saves ──────────────────────────────────────────

  function captureInput(): Record<string, JsonValue> {
    const out: Record<string, SavedSeatInput> = {};
    for (const { index } of input.players()) {
      const actions: Record<string, number[]> = {};
      for (const { action, kind } of registry.actions) {
        if (kind === "vector") {
          const v = input.vector(action, index);
          if (v.x !== 0 || v.y !== 0) actions[action] = [v.x, v.y];
        } else if (input.held(action, index) || input.value(action, index) !== 0) {
          actions[action] = [input.value(action, index)];
        }
      }
      const pointer = input.pointer(index);
      const seat: SavedSeatInput = {};
      if (Object.keys(actions).length > 0) seat.actions = actions;
      if (pointer) seat.pointer = { ...pointer };
      if (seat.actions || seat.pointer) out[index] = seat;
    }
    return out as Record<string, JsonValue>;
  }

  /**
   * Seats moved to where the save had them, and each seat's held actions
   * and pointer put back, through one input update outside a step whose
   * seat events are dropped: the next step's input reads from there.
   */
  function restoreInput(world: WorldState, saved: Readonly<Record<string, JsonValue>>): void {
    const want = new Map<DeviceId, number>();
    for (const { player, devices } of world.seats) for (const d of devices) want.set(d, player);
    const joins: SeatChange[] = [];
    for (const { index, devices } of input.players()) {
      for (const device of devices)
        if (want.get(device) !== index) joins.push({ player: index, device, joined: false });
    }
    for (const { player, devices } of world.seats)
      for (const device of devices) joins.push({ player, device, joined: true });
    const actions: InputAction[] = [];
    const pointers: TickInput["pointers"] = [];
    for (const [seat, value] of Object.entries(saved)) {
      const player = Number(seat);
      const held = value as SavedSeatInput;
      for (const [action, v] of Object.entries(held.actions ?? {})) {
        const at = { action, pressed: true, player, tick: world.tick, timestamp: 0 };
        actions.push(v.length === 2 ? { ...at, x: v[0]!, y: v[1]! } : { ...at, value: v[0] ?? 1 });
      }
      if (held.pointer) pointers[player] = held.pointer;
    }
    input.update({ tick: world.tick, actions, commands: [], pointers, joins });
  }

  /** `e`'s type system's state, then its behaviors', by owner. */
  function ownStates(e: RuntimeEntity): [string, JsonValue][] {
    const out: [string, JsonValue][] = [];
    const own = systems.get(e.type)?.save?.(e.id);
    if (own !== undefined) out.push([e.type, own]);
    out.push(...Object.entries(behaviors.save(e)));
    return out;
  }

  /** What game code registered with the save registry for `id`, by owner. */
  function registeredStates(id: string): [string, JsonValue][] {
    const out: [string, JsonValue][] = [];
    for (const [owner, entry] of saveRegistry.entries.get(id) ?? []) {
      const value = entry.save();
      if (value !== undefined) out.push([owner, value]);
    }
    return out;
  }

  /** Hands `e`'s type system (when it is on, or can be restored while off) and behaviors their states. */
  function restoreOwn(e: RuntimeEntity, states: Readonly<Record<string, JsonValue>>): void {
    const system = systems.get(e.type)!;
    const state = states[e.type];
    if (state !== undefined && (system.disable || lifecycle.enabled(e.id)))
      system.restore?.(e.id, state);
    behaviors.restore(e, states);
  }

  function restoreRegistered(id: string, states: Readonly<Record<string, JsonValue>>): void {
    for (const [owner, entry] of saveRegistry.entries.get(id) ?? []) {
      const state = states[owner];
      if (state !== undefined) entry.restore(state);
    }
  }

  /**
   * The records of `ids` that are `parent`'s children now, each naming it:
   * what `tree.link` takes to link them again in this order, which measures
   * their local poses anew and asks each to ride.
   */
  function childrenOf(parent: string, ids: readonly string[]): RuntimeEntity[] {
    return ids.flatMap((id) => {
      const e = byId.get(id);
      if (!e || tree.parent(id) !== parent) return [];
      return [e.parent === parent ? e : { ...e, parent }];
    });
  }

  /**
   * The links a fresh load and a restore's spawns would make again: a
   * spawn's or an instance node's from its record, anything else's from
   * its own `parent`, when that entity is live.
   */
  function loadedParents(): (id: string) => string | null {
    const spawned = new Map<string, string | undefined>();
    for (const rec of lifecycle.spawns())
      spawned.set(rec.id, rec.instance ? rec.instance.parent : rec.input.parent);
    return (id) => {
      const named = spawned.has(id) ? spawned.get(id) : byId.get(id)?.parent;
      return named !== undefined && named !== id && byId.has(named) ? named : null;
    };
  }

  /**
   * Walking the tree from each root, parents first and siblings in order:
   * each link that differs from the load's, the child order of each parent
   * those name, and each local pose that measuring the saved poses wouldn't
   * give back bit for bit.
   */
  function captureTree(): { parents: Record<string, string | null>; saved: SavedTree } {
    const parents: Record<string, string | null> = {};
    const locals: Record<string, [number, number, number]> = {};
    const loaded = loadedParents();
    for (const root of byId.keys()) {
      if (tree.parent(root) !== null) continue;
      for (const id of tree.subtree(root)) {
        const parent = tree.parent(id);
        if (parent !== loaded(id)) parents[id] = parent;
        if (parent === null) continue;
        const local = tree.local(id);
        const pose = ctx.poses.get(id);
        const frame = ctx.poses.get(parent);
        if (!local || !pose || !frame) continue;
        const measured = relativePose(pose, frame);
        if (measured.x !== local.x || measured.y !== local.y || measured.rot !== local.rot)
          locals[id] = [local.x, local.y, local.rot];
      }
    }
    const saved: SavedTree = {};
    if (Object.keys(locals).length > 0) saved.locals = locals;
    const named = new Set(Object.values(parents).filter((p): p is string => p !== null));
    if (named.size > 0)
      saved.children = Object.fromEntries([...named].map((p) => [p, [...tree.children(p)]]));
    return { parents, saved };
  }

  function captureWorld(): WorldState {
    const saved: Record<string, Record<string, JsonValue>> = {};
    const put = (id: string, owner: string, value: JsonValue) => {
      (saved[id] ??= {})[owner] = value;
    };
    for (const e of byId.values())
      for (const [owner, value] of ownStates(e)) put(e.id, owner, value);
    for (const id of saveRegistry.entries.keys()) {
      if (!byId.has(id)) continue;
      for (const [owner, value] of registeredStates(id)) put(id, owner, value);
    }
    const forked = forks.states();
    if (Object.keys(forked).length > 0) saved[SAVE_RANDOM_KEY] = forked;
    const timed = timers.capture(tick);
    saved[SAVE_TIMERS_KEY] = { next: timed.next };
    const touching = contacts.capture();
    if (touching.some((pairs) => pairs.length > 0))
      saved[SAVE_CONTACTS_KEY] = { watches: touching as unknown as JsonValue };
    const held = captureInput();
    if (Object.keys(held).length > 0) saved[SAVE_INPUT_KEY] = held;
    const linked = captureTree();
    if (Object.keys(linked.saved).length > 0) saved[SAVE_TREE_KEY] = linked.saved;

    const poses: Record<string, [number, number, number]> = {};
    for (const id of ctx.poses.ids()) {
      const pose = ctx.poses.get(id);
      if (pose && byId.has(id)) poses[id] = [pose.x, pose.y, pose.rot];
    }
    const spawns = lifecycle.spawns();
    const expected = [...authored, ...spawns.flatMap((r) => r.ids)];
    return {
      tick,
      counters: lifecycle.counters(),
      random: random.snapshot(),
      timers: timed.timers,
      enabled: Object.fromEntries(lifecycle.disabledIds().map((id) => [id, false as const])),
      ...(Object.keys(linked.parents).length > 0 ? { parents: linked.parents } : {}),
      destroyed: expected.filter((id) => !byId.has(id)),
      spawned: spawns.map(({ id, input: given, instance }) => ({
        id,
        input: given,
        ...(instance ? { instance } : {}),
      })),
      poses,
      systems: saved,
      seats: input
        .players()
        .filter((p) => p.devices.length > 0)
        .map((p) => ({ player: p.index, devices: [...p.devices] })),
    };
  }

  /** A restore step's refusal as an issue naming the entity. */
  function restoreRefused(what: string, err: unknown, entityId?: string): SceneIssue {
    const code =
      err instanceof EngineError && Object.hasOwn(ISSUE_CODES, err.code) ? err.code : "schema";
    return makeIssue(code as IssueCode, {
      message: `the save can't be restored: ${what}: ${errorText(err)}`,
      entityIds: entityId ? [entityId] : [],
    });
  }

  /**
   * After a fresh load of the save's scene, in order: sublevels as saved;
   * runtime spawns as saved (kept where the load made them again, spawned
   * again with their exact ids otherwise, and the rest destroyed); saved
   * destroys; counters; parents; enabled flags (own switches); the tick;
   * poses, then each child's local pose measured from them, or the saved
   * one; each owner's `restore` (type system, behaviors, then what
   * registered with the save registry) and the contact watches; timers;
   * `ctx.random` and its forks; seats and held input. Outside a step, so
   * none of it raises an event, and with the tree not following, so a
   * parent's pose write moves no child.
   */
  function restoreWorld(world: WorldState, levels: readonly SublevelInfo[]): SceneIssue | null {
    return tree.quietly(() => restoreWorldQuietly(world, levels));
  }

  /**
   * Destroys `id` for a restore. A descendant the save still holds is made
   * a root first, so it outlives the destroy; the save's `parents` puts it
   * back where it was.
   */
  function destroyKeeping(id: string, doomed: ReadonlySet<string>): void {
    for (const at of tree.subtree(id)) {
      const parent = tree.parent(at);
      if (at !== id && !doomed.has(at) && parent !== null && doomed.has(parent))
        tree.setParent(at, null);
    }
    lifecycle.destroy(id);
  }

  /**
   * Each child's local pose measured from the poses as they are, its
   * place among its siblings kept, and its ride asked again; then the
   * saved locals over them, deepest first, so a parent's write composes
   * its children from their saved locals. Their poses stay as saved.
   */
  function restoreLocals(world: WorldState, saved: SavedTree | undefined): void {
    const again = [...byId.keys()].flatMap((id) => childrenOf(id, tree.children(id)));
    if (again.length > 0) tree.link(again);
    const locals = saved?.locals;
    if (!locals) return;
    const order: string[] = [];
    for (const root of byId.keys())
      if (tree.parent(root) === null) order.push(...tree.subtree(root));
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i]!;
      const local = Object.hasOwn(locals, id) ? locals[id] : undefined;
      if (!local || tree.parent(id) === null) continue;
      tree.setLocal(id, local[0], local[1], local[2]);
    }
    for (const id of Object.keys(locals)) {
      const pose = Object.hasOwn(world.poses, id) ? world.poses[id] : undefined;
      if (pose && byId.has(id)) ctx.poses.set(id, pose[0], pose[1], pose[2], { snap: true });
    }
  }

  function restoreWorldQuietly(
    world: WorldState,
    levels: readonly SublevelInfo[],
  ): SceneIssue | null {
    const systemsSaved: SavedSystems = world.systems;
    const want = new Map(levels.map((l) => [l.label, l]));
    for (const l of sublevels.list()) {
      const w = want.get(l.label);
      if (!w || w.scene !== l.scene || w.at[0] !== l.at[0] || w.at[1] !== l.at[1])
        ctx.flow.detach(l.label);
    }
    for (const l of levels) {
      if (sublevels.has(l.label)) continue;
      const attached = ctx.flow.attach(l.scene, { label: l.label, at: [l.at[0], l.at[1]] });
      if (!attached.ok) return attached.issue;
    }

    const keep = new Set(world.spawned.map((s) => s.id));
    const dropped = lifecycle.spawns().filter((rec) => !keep.has(rec.id));
    const doomed = new Set([...world.destroyed, ...dropped.flatMap((rec) => rec.ids)]);
    for (const rec of dropped) destroyKeeping(rec.id, doomed);
    for (const rec of world.spawned) {
      if (lifecycle.exists(rec.id)) continue;
      try {
        lifecycle.restoreSpawn(rec);
      } catch (err) {
        return restoreRefused(`spawning "${rec.id}" again`, err, rec.id);
      }
    }
    for (const id of world.destroyed) if (lifecycle.exists(id)) destroyKeeping(id, doomed);
    lifecycle.setCounters(world.counters);
    const savedTree = systemsSaved[SAVE_TREE_KEY] as SavedTree | undefined;
    for (const [id, parent] of Object.entries(world.parents ?? {})) {
      try {
        tree.setParent(id, parent);
      } catch (err) {
        const under = parent === null ? "a root" : `under "${parent}"`;
        return restoreRefused(`putting "${id}" ${under}`, err, id);
      }
    }
    for (const [parent, order] of Object.entries(savedTree?.children ?? {})) {
      const again = childrenOf(parent, order);
      if (again.length > 0) tree.link(again);
    }
    for (const id of [...byId.keys()]) {
      const off = world.enabled[id] === false;
      try {
        if (lifecycle.enabledSelf(id) === off) lifecycle.setEnabled(id, !off);
      } catch (err) {
        return restoreRefused(`switching "${id}" ${off ? "off" : "on"}`, err, id);
      }
    }

    tick = world.tick;
    for (const [id, [x, y, rot]] of Object.entries(world.poses)) {
      if (byId.has(id)) ctx.poses.set(id, x, y, rot, { snap: true });
    }
    restoreLocals(world, savedTree);
    for (const e of byId.values()) {
      const states = systemsSaved[e.id];
      if (states) restoreOwn(e, states);
    }
    for (const id of saveRegistry.entries.keys()) {
      const states = systemsSaved[id];
      if (states) restoreRegistered(id, states);
    }
    const watches = systemsSaved[SAVE_CONTACTS_KEY]?.watches;
    contacts.restore((watches ?? []) as unknown as SavedTouch[][]);

    const next = systemsSaved[SAVE_TIMERS_KEY]?.next;
    timers.restore(world.timers, world.tick, isCount(next, 1) ? next : 1);
    setRngState(random, world.random);
    forks.restore(systemsSaved[SAVE_RANDOM_KEY] ?? {});
    restoreInput(world, systemsSaved[SAVE_INPUT_KEY] ?? {});
    ctx.physics?.refreshQueries();
    cachedScene = null;
    syncMovedWalls();
    return null;
  }

  /**
   * Loads a scene fresh as the main scene loaded last: its flow identity and
   * play options, taken now so a load that fails and unloads can still be
   * followed by another under the same identity.
   */
  function freshLoader(): (
    scene: ExpandedScene,
    library?: PrefabLibrary,
    tick?: number,
  ) => LoadReport {
    const identity: FlowIdentity | PlayedAs | undefined =
      flowScene !== null && runScenes
        ? { scene: flowScene, entry: flowEntry, library: runScenes }
        : playedAs !== null
          ? { sceneId: playedAs }
          : undefined;
    const playOpts = lastPlay;
    return (scene, library, at) => load(scene, playOpts, identity, library, at);
  }

  const saveHost: SaveHost = {
    mainScene: () => mainScene,
    sceneId: sceneIdNow,
    prefabs: () => lifecycle.library,
    play: () => lastPlay,
    stepping: () => stepping,
    unsaveable: () => timers.unsaveable(),
    reloadMain() {
      const scene = mainScene;
      if (!scene) return { ok: false, error: "no scene loaded" };
      return freshLoader()(scene, versionPrefabs ?? undefined);
    },
    captureWorld,
    restoreWorld,
    playClock: () => playClock,
  };
  Object.defineProperty(ctx, SAVE_HOST, { value: saveHost });

  const swapHost: SwapHost = {
    ctx,
    registry,
    game,
    save: saveHost,
    runtime: () => handle,
    scene: currentScene,
    add,
    update,
    remove,
    authored: () => authored,
    disabledIds: () => lifecycle.disabledIds(),
    spawns: () => lifecycle.spawns(),
    generation: () => lifecycle.generation,
    freshLoader: () => {
      const loadFresh = freshLoader();
      return (scene, library, at, back = false) => {
        loadingBack = back;
        try {
          return loadFresh(scene, new Map(library), at);
        } finally {
          loadingBack = false;
        }
      };
    },
    setVersion(scene, library) {
      mainScene = scene;
      loadedScene = scene;
      cachedScene = null;
      versionPrefabs = new Map(library);
      lifecycle.relibrary(library);
    },
    order(ids) {
      const first = ids.flatMap((id) => {
        const e = byId.get(id);
        return e ? [e] : [];
      });
      const placed = new Set(first.map((e) => e.id));
      const rest = [...byId.values()].filter((e) => !placed.has(e.id));
      byId.clear();
      for (const e of [...first, ...rest]) byId.set(e.id, e);
      cachedScene = null;
    },
    saveEntity: (e) => Object.fromEntries([...ownStates(e), ...registeredStates(e.id)]),
    restoreEntity(e, states) {
      restoreOwn(e, states);
      restoreRegistered(e.id, states);
    },
  };

  function destroy(): void {
    if (destroyed) return;
    unload();
    inGame(() => game?.destroy?.());
    world?.destroy();
    world = null;
    destroyed = true;
  }

  const handle: SceneRuntimeHandle = {
    load: (scene, playOpts, as) =>
      load(scene, playOpts, as?.sceneId !== undefined ? { sceneId: as.sceneId } : undefined),
    unload,
    add,
    update,
    remove,
    get: (id) => byId.get(id),
    step,
    busy: () => game?.busy?.() ?? false,
    snapshot,
    stats,
    takeRequests,
    swap: (next, swapOpts) => swapRuntime(swapHost, next, swapOpts),
    destroy,
    ctx,
    game,
    render: (alpha) => behaviors.render(alpha),
    reloadAssets(next, changed) {
      project = next;
      return behaviors.reloadAssets(changed).map(({ entityId, error, reattached }) => ({
        entityId,
        error: errorText(error),
        reattached,
      }));
    },
    scene: currentScene,
  };
  return handle;
}

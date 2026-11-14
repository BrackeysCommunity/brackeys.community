import { zodIssueText } from "../game/fields";
import { PhysicsRequiredError } from "../game/physics-of";
import { NODE_TYPE, needsPhysics } from "../game/primitives";
import {
  parseRuntimeId,
  RUNTIME_ID_PATTERN,
  runtimeId,
  sublevelLabelOf,
} from "../game/runtime-ids";
import {
  EngineError,
  type EngineContext,
  type InstantiateOptions,
  type InstantiateResult,
  type Registry,
  type SceneSystem,
  type SpawnInput,
} from "../game/types";
import type { AssetId } from "../project/types";
import { expandInstance, runtimeEntity } from "../scene/expand";
import { makeIssue } from "../scene/issues";
import { gridTurns } from "../scene/resolve";
import { geometryFields, spawnSchemaFor } from "../scene/schema";
import { quarterTurns } from "../scene/shape-geometry";
import {
  applyPt,
  composeOrientations,
  dihedral,
  translation,
  type Dihedral,
} from "../scene/transform";
import { transformEntityDef } from "../scene/translate";
import type {
  EntityDef,
  EntityTypeName,
  InstanceDef,
  PrefabLibrary,
  Pt,
  RuntimeEntity,
} from "../scene/types";
import type { Vec2 } from "../types";
import type { BehaviorHost } from "./behaviors";
import { tweenSystemOf } from "./behaviors/tween";
import type { RuntimeContacts } from "./contacts";
import type { EntityTable } from "./entity-table";
import type { RuntimeEventBus } from "./events";
import { composePose, samePose, type Pose } from "./poses";
import type { RuntimeQueryIndex } from "./query-index";
import { spawnPoseOf, type GeometryFields } from "./spawn-pose";
import type { RuntimeTimers } from "./timers";
import { createSceneTree, type RuntimeSceneTree } from "./tree";
import { ENTITY_DESTROYED, ENTITY_DISABLED, ENTITY_ENABLED, ENTITY_SPAWNED } from "./types";

/**
 * A child's record and its system's hooks as the scene tree's `follows`
 * last read them, at entity table `version`; `bare` when the record has
 * no behaviors. The hooks are held bound, so a tick's follows read one
 * shape of slot however many kinds of system the scene has.
 */
type Followed = {
  e: RuntimeEntity;
  posable: boolean;
  selfMoving: ((id: string) => boolean) | undefined;
  carried: NonNullable<SceneSystem["carried"]> | undefined;
  bare: boolean;
  version: number;
};

/** What the lifecycle works over: the runtime's systems, behavior host, entity table and seams. */
export type LifecycleDeps = {
  ctx: EngineContext;
  registry: Registry;
  /** One system per loadable type, in spawn-group order. */
  systems: ReadonlyMap<EntityTypeName, SceneSystem>;
  behaviors: BehaviorHost;
  /** The entity table: live entities, loaded and spawned, in spawn order. */
  entities: EntityTable;
  events: RuntimeEventBus;
  timers: RuntimeTimers;
  query: RuntimeQueryIndex;
  contacts: RuntimeContacts;
  /** True while the runtime is inside `step`, where destroys wait for the end of the tick. */
  stepping: () => boolean;
  /** An entity of `type` entered or left the table outside a load or reconcile batch. */
  changed: (type: EntityTypeName) => void;
  /** After an outside-step spawn or destroy, and after the end-of-tick flush. */
  settled: () => void;
  /** Whether a sublevel with this label is attached, so a spawn may belong to it; default none is. */
  attached?: (label: string) => boolean;
};

export type EntityRejection = { ok: false; error: string; entityId: string };

/**
 * What a live runtime spawn came from: a `spawn`'s input, or for an
 * instance its prefab and options, with `input` holding the prefab as
 * `type` and the placement as `at`. `ids` are the entities it made.
 * Geometry is always world: a `local` spawn is kept as the world fields it
 * became. `parent` (on `input`, or on `instance` for an instance) is the
 * spawn's parent now, so a restore links it where it is.
 */
export type SpawnRecord = {
  id: string;
  input: SpawnInput;
  instance?: InstantiateOptions & { prefab: AssetId };
  ids: readonly string[];
};

/** How entities enter and leave a runtime: the load, the editor's reconcile, and game code alike. */
export type Lifecycle = {
  /** `e`'s spawn pose (snapped), unless its system posed it itself. */
  posed: (e: RuntimeEntity) => void;
  /** Right after `e`'s system spawned it: its spawn pose, then its behaviors attach and may read it. */
  entered: (e: RuntimeEntity) => void;
  /** Right before `e`'s system despawns it: its behaviors detach, then its pose goes. */
  leaving: (e: RuntimeEntity) => void;
  /**
   * The edit fast path: an edit replaced `e`'s record in place, through its
   * system's `update` and then the behaviors'. Re-indexes the new record in
   * the query index (its fields and tags may have changed); nothing spawns,
   * despawns or raises an event, and owned timers and subscriptions stay.
   */
  updated: (e: RuntimeEntity) => void;
  /**
   * `e` into its system, posed, its behaviors attached and indexed; with
   * `table`, into the entity table too. A throw undoes all of it, then rethrows.
   */
  spawnEntity: (e: RuntimeEntity, opts?: { table?: boolean }) => void;
  /**
   * `e` out, in the destroy order: behaviors detach, owned timers and
   * subscriptions end (unless `keepOwned`, for an edit replacing the record),
   * the system despawns, the pose, index and contacts go. Leaves the table.
   */
  despawnEntity: (e: RuntimeEntity, opts?: { keepOwned?: boolean }) => void;
  /**
   * The id a spawn or an instantiate of `name` gets: `explicit` when it is a
   * free `<name>#<label>` with a label not all digits, else the name's next
   * counter id that isn't live (a scene loaded back from `scene()` may hold
   * some). Throws `EngineError("spawn-id-invalid")`.
   */
  claimId: (name: string, explicit?: string) => string;
  /** Rejects a duplicate id (within `entities`, or live when `taken` says so) or an unknown type. */
  checkEntities: (
    entities: readonly RuntimeEntity[],
    taken: (id: string) => boolean,
  ) => EntityRejection | null;
  /** `entities` in spawn order: by spawn group, keeping their order inside one. */
  spawnOrder: <T extends { type: EntityTypeName }>(entities: readonly T[]) => T[];
  /**
   * After a batch's entities exist and before their `ready`: links each one
   * that names a live `parent` under it, in the order given, and switches
   * off each one whose parent is off.
   */
  link: (entities: readonly RuntimeEntity[]) => void;
  /** Each system's `ready` with its ids, in spawn-group order, then the behaviors'. */
  ready: (entities: readonly RuntimeEntity[]) => void;
  spawn: (input: SpawnInput) => RuntimeEntity;
  /**
   * A sublevel's entities into the table as `SceneRuntime.add` spawns them,
   * then `ready`, then one `entity:spawned` each inside a step. A throw
   * undoes every one of them, then rethrows as an `EngineError`.
   */
  place: (entities: readonly RuntimeEntity[]) => void;
  /**
   * Destroys every live `<label>:*` entity and every spawn made with
   * `sublevel: label`, last spawned first, as `destroy` does: at the
   * end-of-tick flush inside a step, at once outside one.
   */
  destroySublevel: (label: string) => void;
  /** Whether any live entity's id carries `label`'s prefix. */
  holdsSublevel: (label: string) => boolean;
  destroy: (id: string) => void;
  instantiate: (prefab: AssetId, at: Pt | Vec2, opts?: InstantiateOptions) => InstantiateResult;
  /**
   * Flips `id`'s own switch, then enables or disables each entity of its
   * subtree whose effective state changed: parents first on the way on,
   * children first on the way off.
   */
  setEnabled: (id: string, enabled: boolean) => void;
  /** Switches off `e`, a record that just replaced a disabled one. */
  keepDisabled: (e: RuntimeEntity) => void;
  /** Whether `id` is live and on: its own switch and every ancestor's. */
  enabled: (id: string) => boolean;
  /** Whether `id` is live and its own switch is on, whatever its ancestors'. */
  enabledSelf: (id: string) => boolean;
  exists: (id: string) => boolean;
  get: (id: string) => RuntimeEntity | undefined;
  /**
   * The end-of-tick destroys, in request order: each id's subtree, children
   * first, gone ids skipped, and ids queued during the flush flushed in the
   * same pass.
   */
  flush: () => void;
  /** Whether destroys wait for the next `flush`. */
  pending: () => boolean;
  /** At each load, before anything spawns: the run's prefab library, frozen for the run. */
  load: (library: PrefabLibrary) => void;
  /**
   * A new version of the running scene's prefab library, frozen in place of
   * the load's from the next `instantiate` on; counters, spawns and flags stay.
   */
  relibrary: (library: PrefabLibrary) => void;
  /** At unload: forgets the library, every disabled flag, the counters and queued destroys. */
  reset: () => void;
  /** The library `load` froze; empty before a load. */
  readonly library: PrefabLibrary;
  /** The runtime spawns and instances with a live entity, in spawn order. */
  spawns: () => readonly SpawnRecord[];
  /**
   * Spawns `rec` again with its exact id, which may carry a counter label
   * (all digits) only the counter gives out otherwise, under its `parent`
   * when that is live and as a root when it isn't. Outside a step it raises
   * no event.
   */
  restoreSpawn: (rec: Omit<SpawnRecord, "ids">) => void;
  /** The counters' last ids given out, by type or prefab name. */
  counters: () => Record<string, number>;
  setCounters: (next: Readonly<Record<string, number>>) => void;
  /** The live entities whose own switch is off, in spawn order. */
  disabledIds: () => string[];
  /** Parents and children; `EngineContext.tree`. */
  readonly tree: RuntimeSceneTree;
  /**
   * Which load the runtime is in: it changes at every `load` and `reset`, so
   * state bound to one load (a pool, whose counter ids the next load gives
   * out again) can tell it outlived it.
   */
  readonly generation: number;
};

/** Why a prefab can't be placed: an issue or a refusal, each with its own `code`. */
type NotSpawnableCause = { code: string; message: string };

function notSpawnable(prefab: AssetId, id: string, cause: NotSpawnableCause): EngineError {
  const err = new EngineError(
    "prefab-not-spawnable",
    `can't instantiate prefab "${prefab}": ${cause.message}`,
    id,
  );
  err.cause = cause;
  return err;
}

const NO_TURN: Dihedral = { rot: 0, flip: false };

/**
 * A spawn's fields put in the world from a parent's frame. A parent turned
 * by whole quarter turns transforms them exactly, as a prefab instance does
 * its children; for any other angle they are moved so the entity's spawn
 * point lands where the frame puts it (to the file's length precision),
 * and `aim` holds that point exactly and the frame's angle, which the
 * entity is put at and turned by once it exists.
 */
type Placed = { def: EntityDef; turn: Dihedral; aim?: Aim };

/** Where a spawn placed in a turned frame goes, and the angle it turns by on top of its own. */
type Aim = { x: number; y: number; turn: number };

export function createLifecycle(deps: LifecycleDeps): Lifecycle {
  const { ctx, registry, systems, behaviors, entities, query } = deps;

  /** Each loadable type's geometry fields, for spawn poses. */
  const geometry = new Map<EntityTypeName, GeometryFields>(
    [...systems.keys()].map((name) => [name, geometryFields(registry.types.get(name)!)]),
  );

  let library: PrefabLibrary = new Map();
  /** Live entities whose own switch `setEnabled` turned off. */
  const off = new Set<string>();
  /** Live entities that are off, by their own switch or an ancestor's; every other live entity is enabled. */
  const disabled = new Set<string>();
  /** Each disabled entity's pose when it went off, to tell whether `setPose` moved it meanwhile. */
  const offPoses = new Map<string, { x: number; y: number; rot: number }>();
  /** Per type or prefab name, the last counter id given out this load. */
  const counters = new Map<string, number>();
  /** Destroys requested inside a step, in request order, until the flush. */
  let doomed: string[] = [];
  /** Per sublevel label, the live spawns made for it. */
  const sublevelSpawns = new Map<string, Set<string>>();
  /** Each runtime spawn with a live entity, by its id, in spawn order. */
  const records = new Map<string, SpawnRecord>();
  /** Each entity a runtime spawn made, to the spawn's id. */
  const recordOf = new Map<string, string>();
  let generation = 0;

  function posed(e: RuntimeEntity): void {
    if (!ctx.poses.has(e.id)) {
      const p = spawnPoseOf(e, geometry.get(e.type) ?? []);
      ctx.poses.set(e.id, p.x, p.y, p.rot, { snap: true });
    }
  }

  /** Where an entity event happens: the entity's pose, else the origin. */
  function poseAt(id: string): { x: number; y: number } {
    const pose = ctx.poses.get(id);
    return pose ? { x: pose.x, y: pose.y } : { x: 0, y: 0 };
  }

  /** An `entity:*` event carrying the entity's type, at `at`; only inside a step. */
  function raise(type: string, e: RuntimeEntity, at = poseAt(e.id)): void {
    if (deps.stepping()) ctx.emit({ type, entityId: e.id, at, data: { type: e.type } });
  }

  /**
   * Behaviors first (reverse registration order), then the type system: its
   * `disable`, or without one a despawn that keeps the record and the pose.
   * `announce` false raises no `entity:disabled`, for an entity that only
   * now joins the world under a parent that is off.
   */
  function disable(e: RuntimeEntity, announce = true): void {
    disabled.add(e.id);
    const at = ctx.poses.get(e.id);
    if (at) offPoses.set(e.id, { x: at.x, y: at.y, rot: at.rot });
    behaviors.disable(e);
    const system = systems.get(e.type)!;
    if (system.disable) system.disable(e.id);
    else system.despawn(e.id);
    query.enabledChanged(e.id, false);
    deps.timers.pauseOwner(e.id, true);
    tweenSystemOf(ctx)?.ownerEnabled(e.id, false);
    deps.contacts.forget(e.id);
    if (announce) raise(ENTITY_DISABLED, e);
  }

  /**
   * The type system first: its `enable`, or without a `disable` a spawn from
   * the record at its spawn pose (state reset); then the behaviors in
   * registration order. A driven child then goes where its parent puts it.
   */
  function enable(e: RuntimeEntity): void {
    const system = systems.get(e.type)!;
    if (system.disable) system.enable?.(e.id);
    else {
      const kept = ctx.poses.get(e.id);
      tree.quietly(() => {
        ctx.poses.remove(e.id);
        try {
          system.spawn(e);
          posed(e);
        } catch (err) {
          system.despawn(e.id);
          ctx.poses.remove(e.id);
          if (kept) ctx.poses.set(e.id, kept.x, kept.y, kept.rot, { snap: true });
          throw err;
        }
      });
    }
    disabled.delete(e.id);
    behaviors.enable(e);
    query.enabledChanged(e.id, true);
    deps.timers.pauseOwner(e.id, false);
    tweenSystemOf(ctx)?.ownerEnabled(e.id, true);
    // Posed while off: only the pose index moved, so the system and behaviors follow it now.
    const was = offPoses.get(e.id);
    offPoses.delete(e.id);
    const pose = ctx.poses.get(e.id);
    if (
      !tree.drive(e.id, { snap: true }) &&
      system.disable &&
      system.setPose &&
      was &&
      pose &&
      !samePose(was, pose)
    )
      ctx.setPose(e.id, pose.x, pose.y, pose.rot);
    raise(ENTITY_ENABLED, e);
  }

  const live = (id: string) => entities.has(id);

  /** Whether `id`'s own switch and every ancestor's are on. */
  function switchedOn(id: string): boolean {
    for (let at: string | null = id; at !== null; at = tree.parent(at))
      if (off.has(at)) return false;
    return true;
  }

  /** Brings each entity of `id`'s subtree to what the switches say: enables parents first, then disables children first. */
  function sync(id: string): void {
    const ids = tree.subtree(id);
    for (const at of ids) {
      const e = entities.get(at);
      if (e && disabled.has(at) && switchedOn(at)) enable(e);
    }
    for (let i = ids.length - 1; i >= 0; i--) {
      const at = ids[i]!;
      const e = entities.get(at);
      if (e && !disabled.has(at) && !switchedOn(at)) disable(e);
    }
  }

  function scopeOf(id: string): string | null {
    const label = sublevelLabelOf(id);
    if (label !== null) return label;
    for (const [spawned, ids] of sublevelSpawns) if (ids.has(id)) return spawned;
    return null;
  }

  const tree: RuntimeSceneTree = createSceneTree({
    poses: ctx.poses,
    setPose: (id, x, y, rot, opts) => ctx.setPose(id, x, y, rot, opts),
    exists: live,
    enabled: (id) => entities.has(id) && !disabled.has(id),
    selfMoving(id) {
      const e = entities.get(id);
      const system = e && systems.get(e.type);
      if (!e || !system?.setPose) return true;
      return system.selfMoving?.(id) === true || behaviors.selfMoving(e);
    },
    follows(id, parent, pose, snap, slot) {
      // A parent moving every tick asks this of each child every tick: the
      // record and its system are looked up again only once the table changed.
      let held = slot.held as Followed | undefined;
      if (held?.version !== entities.version) {
        const e = entities.get(id);
        const system = e && systems.get(e.type);
        held = e && {
          e,
          posable: system?.setPose !== undefined,
          selfMoving: system?.selfMoving?.bind(system),
          carried: system?.carried?.bind(system),
          bare: e.behaviors === undefined,
          version: entities.version,
        };
        slot.held = held;
      }
      if (!held || disabled.has(id)) return "still";
      const { e, bare } = held;
      if (!held.posable || held.selfMoving?.(id) === true || (!bare && behaviors.selfMoving(e)))
        return "still";
      if (!held.carried?.(id, parent, pose, snap)) return "pose";
      if (!bare) behaviors.posed(e, pose, snap);
      return "carried";
    },
    carries(id) {
      const kind = ctx.bodies.kind(id);
      return kind === "dynamic" || kind === "kinematic";
    },
    ride(id, host) {
      const e = entities.get(id);
      if (!e) return;
      systems.get(e.type)?.ride?.(id, host);
      behaviors.ride(e, host);
    },
    scopeOf,
    reparented: (id) => sync(id),
    stepping: deps.stepping,
    tick: () => ctx.tick,
  });

  /** The pose of the live `parent` a spawn goes under, after the tree's `checkParent`. */
  function parentFrame(parent: string, scope: string | null, what: string): Readonly<Pose> {
    tree.checkParent(parent, scope, what, "the spawn");
    return ctx.poses.get(parent) ?? { x: 0, y: 0, rot: 0 };
  }

  function placeLocal(def: EntityDef, frame: Readonly<Pose>): Placed {
    const q = quarterTurns(frame.rot);
    if (q !== null) {
      const turn: Dihedral = { rot: q, flip: false };
      const t = dihedral(turn, [frame.x, frame.y]);
      return { def: transformEntityDef(registry, def, t) ?? def, turn };
    }
    const type = registry.types.get(def.type)!;
    const local = spawnPoseOf(
      runtimeEntity(registry, def, type, NO_TURN),
      geometry.get(def.type) ?? [],
    );
    const world = composePose(frame.x, frame.y, frame.rot, local);
    const by: Pt = [world.x - local.x, world.y - local.y];
    const moved = transformEntityDef(registry, def, translation(by)) ?? def;
    return { def: moved, turn: NO_TURN, aim: { x: world.x, y: world.y, turn: frame.rot } };
  }

  /** Puts a just-linked spawn where `aim` says, turned by its angle, when its type can be posed. */
  function turnPlaced(e: RuntimeEntity, aim: Aim | undefined): void {
    const pose = ctx.poses.get(e.id);
    if (!aim || !pose || !systems.get(e.type)?.setPose) return;
    ctx.setPose(e.id, aim.x, aim.y, pose.rot + aim.turn, { snap: true });
  }

  /** `rec` with the parent its entity has now. */
  function withParentNow(rec: SpawnRecord): SpawnRecord {
    const now = tree.parent(rec.id) ?? undefined;
    if (rec.instance) {
      if (rec.instance.parent === now) return rec;
      const { parent: _was, ...rest } = rec.instance;
      return { ...rec, instance: now === undefined ? rest : { ...rest, parent: now } };
    }
    if (rec.input.parent === now) return rec;
    const { parent: _was, ...rest } = rec.input;
    return { ...rec, input: now === undefined ? rest : { ...rest, parent: now } };
  }

  function record(rec: SpawnRecord): void {
    records.set(rec.id, rec);
    for (const id of rec.ids) recordOf.set(id, rec.id);
  }

  /** `id` left the table: its spawn is forgotten once none of what it made is live. */
  function forgetSpawn(id: string): void {
    const of = recordOf.get(id);
    if (of === undefined) return;
    recordOf.delete(id);
    const rec = records.get(of);
    if (rec && !rec.ids.some((e) => entities.has(e))) records.delete(of);
  }

  /** A copy that a caller changing its input later can't reach; kept as given when it can't be cloned. */
  function copied<T>(value: T): T {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }

  function claimExact(id: string): string {
    if (live(id)) throw new EngineError("spawn-id-invalid", `spawn id "${id}" is already live`, id);
    return id;
  }

  function claimId(name: string, explicit?: string): string {
    if (explicit === undefined) {
      let n = counters.get(name) ?? 0;
      do n++;
      while (live(runtimeId(name, n)));
      counters.set(name, n);
      return runtimeId(name, n);
    }
    const parsed = RUNTIME_ID_PATTERN.test(explicit) ? parseRuntimeId(explicit) : null;
    const why = !parsed
      ? `isn't <name>#<label> (lowercase letters, digits and dashes)`
      : parsed.name !== name
        ? `names "${parsed.name}", not "${name}"`
        : /^\d+$/.test(parsed.label)
          ? "has an all-digit label, which only the runtime's counter gives"
          : live(explicit)
            ? "is already live"
            : null;
    if (why) throw new EngineError("spawn-id-invalid", `spawn id "${explicit}" ${why}`, explicit);
    return explicit;
  }

  function spawnEntity(e: RuntimeEntity, opts?: { table?: boolean }): void {
    const system = systems.get(e.type)!;
    try {
      system.spawn(e);
      posed(e);
      behaviors.attach(e);
      if (opts?.table) entities.set(e.id, e);
      query.added(e);
    } catch (err) {
      if (opts?.table) entities.delete(e.id);
      query.removed(e.id);
      behaviors.detach(e);
      system.despawn(e.id);
      ctx.poses.remove(e.id);
      throw err;
    }
  }

  function despawnEntity(e: RuntimeEntity, opts?: { keepOwned?: boolean }): void {
    behaviors.detach(e);
    if (!opts?.keepOwned) {
      deps.timers.cancelOwner(e.id);
      deps.events.dropOwner(e.id);
      tweenSystemOf(ctx)?.ownerDestroyed(e.id);
    }
    systems.get(e.type)!.despawn(e.id);
    ctx.poses.remove(e.id);
    query.removed(e.id);
    deps.contacts.forget(e.id);
    disabled.delete(e.id);
    offPoses.delete(e.id);
    if (!opts?.keepOwned) {
      off.delete(e.id);
      tree.forget(e.id);
    }
  }

  const asEngineError = (err: unknown, entityId: string) =>
    err instanceof EngineError
      ? err
      : new EngineError("schema", err instanceof Error ? err.message : String(err), entityId);

  /** In a scene without physics, the first child whose type needs physics. */
  function physicsCause(children: readonly RuntimeEntity[]): EngineError | null {
    if (ctx.physics) return null;
    for (const e of children) {
      const t = registry.types.get(e.type);
      if (t && needsPhysics(t)) return new PhysicsRequiredError(`a ${e.type}`, e.id);
    }
    return null;
  }

  function instantiate(
    prefab: AssetId,
    at: Pt | Vec2,
    opts: InstantiateOptions = {},
    exact?: string,
  ): InstantiateResult {
    if (!library.has(prefab)) {
      throw notSpawnable(
        prefab,
        opts.id ?? prefab,
        makeIssue("prefab-unknown", {
          message: `the run's prefab library has no "${prefab}"`,
          got: prefab,
          ...(library.size > 0 ? { expected: [...library.keys()].join(", ") } : {}),
        }),
      );
    }
    const parent = opts.parent;
    const frame =
      parent === undefined ? undefined : parentFrame(parent, null, `instantiate "${prefab}"`);
    const given: Pt = Array.isArray(at) ? [at[0], at[1]] : [at.x, at.y];
    let where = given;
    let rot = opts.rot ?? 0;
    if (frame && opts.local === true) {
      const q = quarterTurns(frame.rot);
      if (q !== null) {
        where = applyPt(dihedral({ rot: q, flip: false }, [frame.x, frame.y]), given);
        rot = (((rot + 90 * q) % 360) + 360) % 360;
      } else {
        const world = composePose(frame.x, frame.y, frame.rot, {
          x: given[0],
          y: given[1],
          rot: 0,
        });
        where = [world.x, world.y];
        const turn = { rot: (frame.rot * 180) / Math.PI, flip: false };
        rot = composeOrientations(turn, { rot, flip: false }).rot;
      }
    }
    const id = exact !== undefined ? claimExact(exact) : claimId(prefab, opts.id);
    const inst: InstanceDef = {
      id,
      prefab,
      at: where,
      ...(rot ? { rot } : {}),
      ...(opts.flip ? { flip: true as const } : {}),
      ...(opts.z !== undefined ? { z: opts.z } : {}),
      ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
      ...(opts.params ? { params: structuredClone({ ...opts.params }) } : {}),
      ...(opts.overrides ? { overrides: structuredClone({ ...opts.overrides }) } : {}),
    };
    let expanded: readonly RuntimeEntity[];
    let nodes: number;
    let children: RuntimeEntity[];
    try {
      const out = expandInstance(inst, library, registry, {
        cells: gridTurns({ settings: { grid: ctx.settings.grid ?? undefined } }),
      });
      if (!out.ok) throw notSpawnable(prefab, id, out.issue);
      expanded = out.entities;
      nodes = out.nodes;
      if (parent !== undefined) {
        const node = expanded.find((e) => e.id === id);
        if (node) node.parent = parent;
      }
      children = lifecycle.spawnOrder(expanded);
    } catch (err) {
      if (err instanceof EngineError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw notSpawnable(prefab, id, new EngineError("unknown-type", message, id));
    }
    const needs = physicsCause(children);
    if (needs) throw notSpawnable(prefab, id, needs);
    const rejected = lifecycle.checkEntities(children, (child) => entities.has(child));
    if (rejected) throw new EngineError("spawn-id-invalid", rejected.error, rejected.entityId);

    const spawned: RuntimeEntity[] = [];
    const undo = () => {
      for (let i = spawned.length - 1; i >= 0; i--) {
        const e = spawned[i]!;
        despawnEntity(e);
        entities.delete(e.id);
      }
    };
    try {
      for (const e of children) {
        spawnEntity(e, { table: true });
        spawned.push(e);
      }
      lifecycle.link(expanded);
      lifecycle.ready(spawned);
    } catch (err) {
      undo();
      if (err instanceof PhysicsRequiredError) throw notSpawnable(prefab, id, err);
      throw asEngineError(err, id);
    }
    const { id: _asked, local: _local, ...kept } = opts;
    if ((kept.rot ?? 0) !== rot) {
      if (rot) kept.rot = rot;
      else delete kept.rot;
    }
    record({
      id,
      input: { type: prefab, at: [...inst.at] },
      instance: { prefab, ...copied(kept) },
      ids: spawned.map((e) => e.id),
    });
    for (const e of spawned) {
      deps.changed(e.type);
      raise(ENTITY_SPAWNED, e);
    }
    if (!deps.stepping()) deps.settled();
    return { id, entities: expanded.slice(nodes).map((e) => e.id) };
  }

  /** The dev and headless check of a spawn's fields: the type's spawn schema, its id aside. */
  function parseSpawn(type: EntityTypeName, fields: Record<string, unknown>, id: string): void {
    const schema = spawnSchemaFor(registry, type);
    if (!schema) return;
    const parsed = schema.safeParse(fields);
    if (parsed.success) return;
    throw new EngineError(
      "schema",
      `spawn of "${type}" doesn't match its schema: ${zodIssueText(parsed.error)}`,
      id,
    );
  }

  function spawn(input: SpawnInput, exact?: string): RuntimeEntity {
    const type = registry.types.get(input.type);
    if (!type || !systems.has(input.type)) {
      const why = type ? "doesn't load" : "isn't registered";
      throw new EngineError("unknown-type", `can't spawn type "${input.type}": it ${why}`);
    }
    const label = input.sublevel;
    if (label !== undefined && !deps.attached?.(label)) {
      throw new EngineError(
        "sublevel-invalid",
        `can't spawn "${input.type}" for sublevel "${label}": no sublevel with that label is attached`,
      );
    }
    const parent = input.parent;
    const frame =
      parent === undefined
        ? undefined
        : parentFrame(parent, label ?? null, `spawn "${input.type}"`);
    const id = exact !== undefined ? claimExact(exact) : claimId(input.type, input.id);
    const { id: _id, sublevel: _sublevel, parent: _parent, local, ...fields } = input;
    if (ctx.dev || ctx.view === null) parseSpawn(input.type, fields, id);
    let placed: Placed = { def: { ...fields, id } as EntityDef, turn: NO_TURN };
    let e: RuntimeEntity;
    try {
      if (frame && local === true) placed = placeLocal(placed.def, frame);
      e = runtimeEntity(
        registry,
        placed.def,
        type,
        { rot: placed.turn.rot * 90, flip: placed.turn.flip },
        parent,
      );
      spawnEntity(e, { table: true });
    } catch (err) {
      throw asEngineError(err, id);
    }
    try {
      lifecycle.link([e]);
      turnPlaced(e, placed.aim);
      lifecycle.ready([e]);
    } catch (err) {
      despawnEntity(e);
      entities.delete(id);
      throw asEngineError(err, id);
    }
    if (label !== undefined) {
      const ids = sublevelSpawns.get(label);
      if (ids) ids.add(id);
      else sublevelSpawns.set(label, new Set([id]));
    }
    const { id: _placedId, ...world } = placed.def;
    const { local: _given, ...asked } = input;
    record({
      id,
      input: copied(local === true && frame ? { ...asked, ...world } : asked),
      ids: [id],
    });
    deps.changed(e.type);
    raise(ENTITY_SPAWNED, e);
    if (!deps.stepping()) deps.settled();
    return e;
  }

  function place(list: readonly RuntimeEntity[]): void {
    const rejected = lifecycle.checkEntities(list, (id) => entities.has(id));
    if (rejected) throw new EngineError("spawn-id-invalid", rejected.error, rejected.entityId);
    const spawned: RuntimeEntity[] = [];
    let current: string | undefined;
    try {
      for (const e of lifecycle.spawnOrder(list)) {
        current = e.id;
        spawnEntity(e, { table: true });
        spawned.push(e);
      }
      current = undefined;
      lifecycle.link(list);
      lifecycle.ready(spawned);
    } catch (err) {
      for (let i = spawned.length - 1; i >= 0; i--) {
        const e = spawned[i]!;
        despawnEntity(e);
        entities.delete(e.id);
      }
      throw asEngineError(err, current ?? spawned[0]?.id ?? "");
    }
    for (const e of spawned) {
      deps.changed(e.type);
      raise(ENTITY_SPAWNED, e);
    }
    if (!deps.stepping()) deps.settled();
  }

  function destroySublevel(label: string): void {
    const prefix = `${label}:`;
    const spawns = sublevelSpawns.get(label);
    const ids = [...entities.keys()]
      .filter((id) => id.startsWith(prefix) || spawns?.has(id))
      .reverse();
    sublevelSpawns.delete(label);
    if (deps.stepping()) {
      doomed.push(...ids);
      return;
    }
    for (const id of ids) remove(id);
    deps.settled();
  }

  /** `id`'s subtree, children first in reverse child order; gone ids are skipped. */
  function remove(id: string): void {
    if (!entities.has(id)) return;
    const ids = tree.subtree(id);
    for (let i = ids.length - 1; i >= 0; i--) {
      const e = entities.get(ids[i]!);
      if (!e) continue;
      const last = poseAt(e.id);
      despawnEntity(e);
      entities.delete(e.id);
      forgetSpawn(e.id);
      for (const ids of sublevelSpawns.values()) ids.delete(e.id);
      deps.changed(e.type);
      raise(ENTITY_DESTROYED, e, last);
    }
  }

  const lifecycle: Lifecycle = {
    posed,
    entered(e) {
      posed(e);
      behaviors.attach(e);
      query.added(e);
    },
    leaving(e) {
      disabled.delete(e.id);
      offPoses.delete(e.id);
      behaviors.detach(e);
      ctx.poses.remove(e.id);
      query.removed(e.id);
    },
    updated(e) {
      query.added(e);
    },
    spawnEntity,
    despawnEntity,
    claimId,
    checkEntities(list, taken) {
      const seen = new Set<string>();
      for (const e of list) {
        if (seen.has(e.id) || taken(e.id))
          return { ok: false, error: `duplicate entity id "${e.id}"`, entityId: e.id };
        if (!systems.has(e.type)) {
          return { ok: false, error: `unknown type "${e.type}"`, entityId: e.id };
        }
        seen.add(e.id);
      }
      return null;
    },
    spawnOrder(list) {
      return list
        .map((e, i) => [e, i] as const)
        .sort(
          ([a, i], [b, j]) =>
            registry.spawnGroupOf(a.type)! - registry.spawnGroupOf(b.type)! || i - j,
        )
        .map(([e]) => e);
    },
    link(list) {
      tree.link(childOrder(list));
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i]!;
        if (tree.parent(e.id) !== null && !disabled.has(e.id) && !switchedOn(e.id)) {
          disable(e, false);
        }
      }
    },
    ready(list) {
      if (list.length === 0) return;
      const byType = new Map<EntityTypeName, string[]>();
      for (const e of list) {
        const ids = byType.get(e.type);
        if (ids) ids.push(e.id);
        else byType.set(e.type, [e.id]);
      }
      for (const [type, system] of systems) {
        const ids = byType.get(type);
        if (ids) system.ready?.(ids);
      }
      behaviors.ready(list.map((e) => e.id));
    },
    spawn: (input) => spawn(input),
    place,
    destroySublevel,
    holdsSublevel(label) {
      for (const id of entities.keys()) if (sublevelLabelOf(id) === label) return true;
      return false;
    },
    destroy(id) {
      if (deps.stepping()) {
        doomed.push(id);
        return;
      }
      remove(id);
      deps.settled();
    },
    instantiate: (prefab, at, opts) => instantiate(prefab, at, opts),
    setEnabled(id, on) {
      if (!entities.has(id) || off.has(id) !== on) return;
      if (on) off.delete(id);
      else off.add(id);
      sync(id);
    },
    keepDisabled(e) {
      if (entities.has(e.id) && !disabled.has(e.id)) disable(e);
    },
    enabled: (id) => entities.has(id) && !disabled.has(id),
    enabledSelf: (id) => entities.has(id) && !off.has(id),
    exists: live,
    get: (id) => entities.get(id),
    flush() {
      if (doomed.length > 0) {
        for (let i = 0; i < doomed.length; i++) remove(doomed[i]!);
        doomed = [];
      }
      deps.settled();
    },
    pending: () => doomed.length > 0,
    load(next) {
      library = new Map(next);
      counters.clear();
      doomed = [];
      sublevelSpawns.clear();
      records.clear();
      recordOf.clear();
      generation++;
    },
    relibrary(next) {
      library = new Map(next);
    },
    reset() {
      library = new Map();
      off.clear();
      disabled.clear();
      offPoses.clear();
      tree.clear();
      counters.clear();
      doomed = [];
      sublevelSpawns.clear();
      records.clear();
      recordOf.clear();
      generation++;
    },
    get library() {
      return library;
    },
    spawns: () => [...records.values()].map(withParentNow),
    restoreSpawn(rec) {
      if (rec.instance) {
        const { prefab, parent, ...opts } = rec.instance;
        const at = rec.input.at as Pt;
        const under = parent !== undefined && live(parent) ? { parent } : {};
        instantiate(prefab, [at[0], at[1]], { ...opts, ...under }, rec.id);
        return;
      }
      const { parent, ...input } = copied(rec.input);
      spawn(parent !== undefined && live(parent) ? { ...input, parent } : input, rec.id);
    },
    counters: () => Object.fromEntries(counters),
    setCounters(next) {
      counters.clear();
      for (const [name, n] of Object.entries(next)) counters.set(name, n);
    },
    disabledIds: () => [...entities.keys()].filter((id) => off.has(id)),
    tree,
    get generation() {
      return generation;
    },
  };
  return lifecycle;
}

/**
 * `list` in the order its entities join their parents: a parent's own
 * entities first, then its nested instances' nodes (a `node` whose id is
 * under its parent's and that holds children of its own).
 */
function childOrder(list: readonly RuntimeEntity[]): readonly RuntimeEntity[] {
  const holders = new Set<string>();
  for (const e of list) if (e.parent !== undefined) holders.add(e.parent);
  const instanceNode = (e: RuntimeEntity) =>
    e.type === NODE_TYPE &&
    e.parent !== undefined &&
    e.id.startsWith(`${e.parent}/`) &&
    holders.has(e.id);
  if (!list.some(instanceNode)) return list;
  return [...list.filter((e) => !instanceNode(e)), ...list.filter(instanceNode)];
}

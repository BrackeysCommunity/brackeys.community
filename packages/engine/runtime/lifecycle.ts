import { PhysicsRequiredError } from "../game/physics-of";
import { physicsNeeds } from "../game/primitives";
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
import type { RuntimeQueryIndex } from "./query-index";
import { spawnPoseOf, type GeometryFields } from "./spawn-pose";
import type { RuntimeTimers } from "./timers";
import { ENTITY_DESTROYED, ENTITY_DISABLED, ENTITY_ENABLED, ENTITY_SPAWNED } from "./types";

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
  setEnabled: (id: string, enabled: boolean) => void;
  /** Switches off `e`, a record that just replaced a disabled one, as `setEnabled(id, false)` would. */
  keepDisabled: (e: RuntimeEntity) => void;
  /** Whether `id` is live and on; an instance id when any of its live children is. */
  enabled: (id: string) => boolean;
  /** Whether `id` is live; an instance id when it has a live child. */
  exists: (id: string) => boolean;
  get: (id: string) => RuntimeEntity | undefined;
  /**
   * The end-of-tick destroys, in request order: an instance id's live
   * children in reverse spawn order, gone ids skipped, and ids queued during
   * the flush flushed in the same pass.
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
   * (all digits) only the counter gives out otherwise. Outside a step it
   * raises no event.
   */
  restoreSpawn: (rec: Omit<SpawnRecord, "ids">) => void;
  /** The counters' last ids given out, by type or prefab name. */
  counters: () => Record<string, number>;
  setCounters: (next: Readonly<Record<string, number>>) => void;
  /** The live entities switched off, in the order they were. */
  disabledIds: () => string[];
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

export function createLifecycle(deps: LifecycleDeps): Lifecycle {
  const { ctx, registry, systems, behaviors, entities, query } = deps;

  /** Each loadable type's geometry fields, for spawn poses. */
  const geometry = new Map<EntityTypeName, GeometryFields>(
    [...systems.keys()].map((name) => [name, geometryFields(registry.types.get(name)!)]),
  );

  let library: PrefabLibrary = new Map();
  /** Live entities switched off with `setEnabled`; every other live entity is enabled. */
  const disabled = new Set<string>();
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
   */
  function disable(e: RuntimeEntity): void {
    disabled.add(e.id);
    behaviors.disable(e);
    const system = systems.get(e.type)!;
    if (system.disable) system.disable(e.id);
    else system.despawn(e.id);
    query.enabledChanged(e.id, false);
    deps.timers.pauseOwner(e.id, true);
    tweenSystemOf(ctx)?.ownerEnabled(e.id, false);
    deps.contacts.forget(e.id);
    raise(ENTITY_DISABLED, e);
  }

  /**
   * The type system first: its `enable`, or without a `disable` a spawn from
   * the record at its spawn pose (state reset); then the behaviors in
   * registration order.
   */
  function enable(e: RuntimeEntity): void {
    const system = systems.get(e.type)!;
    if (system.disable) system.enable?.(e.id);
    else {
      const kept = ctx.poses.get(e.id);
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
    }
    disabled.delete(e.id);
    behaviors.enable(e);
    query.enabledChanged(e.id, true);
    deps.timers.pauseOwner(e.id, false);
    tweenSystemOf(ctx)?.ownerEnabled(e.id, true);
    raise(ENTITY_ENABLED, e);
  }

  const live = (id: string) => entities.has(id) || entities.hasUnder(id);

  /** The live entities under instance id `id` (`id/…`, at any depth), in spawn order. */
  function childrenOf(id: string): RuntimeEntity[] {
    const out: RuntimeEntity[] = [];
    if (!entities.hasUnder(id)) return out;
    const prefix = `${id}/`;
    for (const [key, e] of entities) if (key.startsWith(prefix)) out.push(e);
    return out;
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
  }

  const asEngineError = (err: unknown, entityId: string) =>
    err instanceof EngineError
      ? err
      : new EngineError("schema", err instanceof Error ? err.message : String(err), entityId);

  /** In a scene without physics, the first child whose type needs physics or that rides another. */
  function physicsCause(children: readonly RuntimeEntity[]): EngineError | null {
    if (ctx.physics) return null;
    for (const e of children) {
      const t = registry.types.get(e.type);
      const need = t ? physicsNeeds(t, e)[0] : undefined;
      if (need) {
        return new PhysicsRequiredError(
          need.field === undefined ? `a ${e.type}` : `${e.type}.${need.field}`,
          e.id,
        );
      }
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
    const id = exact !== undefined ? claimExact(exact) : claimId(prefab, opts.id);
    const inst: InstanceDef = {
      id,
      prefab,
      at: Array.isArray(at) ? [at[0], at[1]] : [at.x, at.y],
      ...(opts.rot ? { rot: opts.rot } : {}),
      ...(opts.flip ? { flip: true as const } : {}),
      ...(opts.z !== undefined ? { z: opts.z } : {}),
      ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
      ...(opts.params ? { params: structuredClone({ ...opts.params }) } : {}),
      ...(opts.overrides ? { overrides: structuredClone({ ...opts.overrides }) } : {}),
    };
    let children: RuntimeEntity[];
    try {
      const out = expandInstance(inst, library, registry, {
        cells: gridTurns({ settings: { grid: ctx.settings.grid ?? undefined } }),
      });
      if (!out.ok) throw notSpawnable(prefab, id, out.issue);
      children = lifecycle.spawnOrder(out.entities);
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
      lifecycle.ready(spawned);
    } catch (err) {
      undo();
      if (err instanceof PhysicsRequiredError) throw notSpawnable(prefab, id, err);
      throw asEngineError(err, id);
    }
    const { id: _asked, ...kept } = opts;
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
    return { id, entities: spawned.map((e) => e.id) };
  }

  /** The dev and headless check of a spawn's fields: the type's spawn schema, its id aside. */
  function parseSpawn(type: EntityTypeName, fields: Record<string, unknown>, id: string): void {
    const schema = spawnSchemaFor(registry, type);
    if (!schema) return;
    const parsed = schema.safeParse(fields);
    if (parsed.success) return;
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new EngineError(
      "schema",
      `spawn of "${type}" doesn't match its schema: ${where}${issue?.message ?? "invalid"}`,
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
    const id = exact !== undefined ? claimExact(exact) : claimId(input.type, input.id);
    const { id: _id, sublevel: _sublevel, ...fields } = input;
    if (ctx.dev || ctx.view === null) parseSpawn(input.type, fields, id);
    let e: RuntimeEntity;
    try {
      e = runtimeEntity(registry, { ...fields, id } as EntityDef, type, { rot: 0, flip: false });
      spawnEntity(e, { table: true });
    } catch (err) {
      throw asEngineError(err, id);
    }
    try {
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
    record({ id, input: copied({ ...input }), ids: [id] });
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

  /** `id` and, for an instance id, its live children in reverse spawn order; gone ids are skipped. */
  function remove(id: string): void {
    const own = entities.get(id);
    for (const e of own ? [own] : childrenOf(id).reverse()) {
      if (entities.get(e.id) !== e) continue;
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
      const e = entities.get(id);
      if (!e || disabled.has(id) !== on) return;
      if (on) enable(e);
      else disable(e);
    },
    keepDisabled(e) {
      if (entities.has(e.id) && !disabled.has(e.id)) disable(e);
    },
    enabled: (id) =>
      entities.has(id)
        ? !disabled.has(id)
        : childrenOf(id).some((child) => !disabled.has(child.id)),
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
      disabled.clear();
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
    spawns: () => [...records.values()],
    restoreSpawn(rec) {
      if (rec.instance) {
        const { prefab, ...opts } = rec.instance;
        const at = rec.input.at as Pt;
        instantiate(prefab, [at[0], at[1]], opts, rec.id);
        return;
      }
      spawn(copied(rec.input), rec.id);
    },
    counters: () => Object.fromEntries(counters),
    setCounters(next) {
      counters.clear();
      for (const [name, n] of Object.entries(next)) counters.set(name, n);
    },
    disabledIds: () => [...entities.keys()].filter((id) => disabled.has(id)),
    get generation() {
      return generation;
    },
  };
  return lifecycle;
}

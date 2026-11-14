import type {
  BehaviorBlock,
  BehaviorName,
  BehaviorSystem,
  BehaviorSystemFactory,
  RegisteredBehavior,
} from "../game/behaviors";
import {
  ENGINE_REGISTRY_ID,
  type EngineContext,
  type JsonValue,
  type Registry,
} from "../game/types";
import { schemaRefSites } from "../project/refs";
import type { AssetId } from "../project/types";
import type { RuntimeEntity } from "../scene/types";
import { ENGINE_BEHAVIOR_SYSTEMS } from "./behaviors/index";
import type { Pose } from "./poses";
import type { TimingScope } from "./timing";
import type { AssetReloadError } from "./types";

/**
 * Runs each registered behavior's system for one runtime, around the type
 * systems: attach after a spawn, detach before a despawn.
 */
export type BehaviorHost = {
  /**
   * After the type system spawned `e`: attach each block in registration
   * order. A throwing attach detaches `e` from every system, then rethrows.
   */
  attach(e: RuntimeEntity): void;
  /** Before the type system despawns: detach in reverse order. */
  detach(e: RuntimeEntity): void;
  /**
   * `e` replaced `prev`: update, attach or detach each block as it changed.
   * A block a failed asset reload left detached is attached afresh instead
   * of updated. A throw detaches `e` from every system, then rethrows.
   */
  update(e: RuntimeEntity, prev: RuntimeEntity): void;
  /** Each system's `beforeStep`, in registration order; with `timing`, a lap `behavior.<name>.beforeStep` after each. */
  beforeStep(dtMs: number, timing?: Pick<TimingScope, "lap"> | null): void;
  /** Each system's `beforePhysics`, in registration order; with `timing`, a lap `behavior.<name>.beforePhysics` after each. */
  beforePhysics(timing?: Pick<TimingScope, "lap"> | null): void;
  /** Each system's `step`, in registration order; with `timing`, a lap `behavior.<name>` after each. */
  step(dtMs: number, timing?: Pick<TimingScope, "lap"> | null): void;
  render(alpha: number): void;
  reset(): void;
  seek(ms: number): void;
  clear(): void;
  /** Each built system's live attachments, by behavior; zeros left out. */
  stats(): Record<BehaviorName, number>;
  /** After a load's or a spawn's entities attached: each system's `ready` with the ids carrying it, in registration order. */
  ready(ids: readonly string[]): void;
  /**
   * `e` is disabled: each of its blocks in reverse registration order, through
   * the system's `disable`, or a detach when the system has none.
   */
  disable(e: RuntimeEntity): void;
  /**
   * `e` is enabled again, in registration order: `enable` where the system
   * has a `disable`, else the block detached on disable attaches afresh.
   */
  enable(e: RuntimeEntity): void;
  /** The built system for `name`; undefined for a data-only behavior or a visual-only one headless. */
  system<S extends BehaviorSystem = BehaviorSystem>(name: BehaviorName): S | undefined;
  /**
   * Redraws each attached entity's blocks that name one of `changed` (or an
   * atlas cut from one) through the block's asset fields: `update` with the
   * same block, else detach and attach. Systems read the project's new info.
   * When an entity's redraw throws, just those blocks are detached and
   * attached afresh; if that throws too they stay detached until an edit
   * replaces the entity. Its other blocks keep their state. Either way it is
   * reported and the remaining entities still redraw.
   */
  reloadAssets(changed: readonly AssetId[]): HostReloadError[];
  /** Each of `e`'s attached blocks' `save`, by behavior name; blocks that return undefined are left out. */
  save(e: RuntimeEntity): Record<BehaviorName, JsonValue>;
  /** Hands each of `e`'s attached blocks its entry in `states`, through the system's `restore`. */
  restore(e: RuntimeEntity, states: Readonly<Record<string, JsonValue>>): void;
  /**
   * The cached `getBehavior` object for `e`'s `name` block, with live
   * `fields`; undefined when the block isn't attached or has no handle yet.
   */
  handle(e: RuntimeEntity, name: BehaviorName): object | undefined;
  /** `ctx.setPose` moved `e`: each attached block's `posed`, in registration order. */
  posed(e: RuntimeEntity, pose: Readonly<Pose>, snap: boolean): void;
  /** The record `attach` is attaching under `id` right now, before the entity table holds it. */
  attaching(id: string): RuntimeEntity | undefined;
  /** Whether any attached block's system says it moves `e` in world space. */
  selfMoving(e: RuntimeEntity): boolean;
  /** Each attached block's `ride`, in registration order. */
  ride(e: RuntimeEntity, host: string | null): void;
};

type HostReloadError = Omit<AssetReloadError, "error"> & { error: unknown };

type Built = { name: BehaviorName; system: BehaviorSystem };

/** The factory a behavior builds from: the engine's map for its own, the def's for a game's. */
function factoryOf(def: RegisteredBehavior): BehaviorSystemFactory | undefined {
  if (def.origin === ENGINE_REGISTRY_ID) return ENGINE_BEHAVIOR_SYSTEMS[def.name];
  return def.system;
}

const blockOf = (e: RuntimeEntity, name: BehaviorName): BehaviorBlock | undefined =>
  e.behaviors?.[name];

/** The behaviors whose blocks `e` carries, in its record's order. */
export const carriedBehaviors = (e: RuntimeEntity): BehaviorName[] =>
  Object.keys(e.behaviors ?? {}).filter((name) => blockOf(e, name));

/**
 * The behavior host for a runtime's context: one system per behavior that
 * has one, built now in registration order. Visual-only behaviors build
 * only when the context has a view.
 */
export function createBehaviorHost(ctx: EngineContext, registry: Registry): BehaviorHost {
  const built: Built[] = [];
  const byName = new Map<BehaviorName, BehaviorSystem>();
  /** The entities carrying blocks, as last attached or updated. */
  const carriers = new Map<string, RuntimeEntity>();
  /** Per entity, the blocks a failed asset reload left detached. */
  const dropped = new Map<string, Set<BehaviorName>>();
  /** Per disabled entity, the blocks detached because their system has no `disable`. */
  const parked = new Map<string, Set<BehaviorName>>();
  /** Per entity, the handles `handle` made, until their blocks detach. */
  const handles = new Map<string, Map<BehaviorName, object>>();
  /** The record `attach` is attaching, so its hooks reach `ctx.entity` before the table insert. */
  let current: RuntimeEntity | undefined;
  for (const name of registry.behaviorNames) {
    const def = registry.behaviors.get(name);
    if (!def || (def.visualOnly && ctx.view === null)) continue;
    const factory = factoryOf(def);
    if (!factory) continue;
    const system = factory(ctx, def);
    built.push({ name, system });
    byName.set(name, system);
  }
  const stepParts = built.map(({ name }) => `behavior.${name}`);
  const beforeStepParts = built.map(({ name }) => `behavior.${name}.beforeStep`);
  const beforePhysicsParts = built.map(({ name }) => `behavior.${name}.beforePhysics`);

  /** Drops `id`'s cached handle for `name`, or every one of its handles. */
  function forget(id: string, name?: BehaviorName): void {
    if (name === undefined) handles.delete(id);
    else handles.get(id)?.delete(name);
  }

  /** Detaches `id` from every built system, in reverse; each `detach` is idempotent. */
  function detachEverywhere(id: string): void {
    forget(id);
    for (let i = built.length - 1; i >= 0; i--) built[i]!.system.detach(id);
  }

  function attached(e: RuntimeEntity, run: () => void): void {
    try {
      run();
    } catch (err) {
      detachEverywhere(e.id);
      carriers.delete(e.id);
      dropped.delete(e.id);
      throw err;
    }
  }

  /** Whether `block`'s asset fields name an id in `changed`, directly or as an atlas's texture. */
  function namesChanged(name: BehaviorName, block: BehaviorBlock, changed: ReadonlySet<AssetId>) {
    const def = registry.behaviors.get(name);
    if (!def) return false;
    return schemaRefSites(def.shape, block, "").some(({ id }) => {
      if (changed.has(id)) return true;
      const texture = ctx.project?.asset(id)?.texture;
      return texture !== undefined && changed.has(texture);
    });
  }

  const noneLive: readonly Built[] = [];
  /** The systems holding one of `e`'s blocks now: not left detached by a failed reload or a disable. */
  function live(e: RuntimeEntity): readonly Built[] {
    if (!e.behaviors || !carriers.has(e.id)) return noneLive;
    const gone = dropped.get(e.id);
    const off = parked.get(e.id);
    return built.filter(
      ({ name }) => blockOf(e, name) !== undefined && !gone?.has(name) && !off?.has(name),
    );
  }

  return {
    attach(e) {
      dropped.delete(e.id);
      parked.delete(e.id);
      forget(e.id);
      if (!e.behaviors) return;
      carriers.set(e.id, e);
      const outer = current;
      current = e;
      try {
        attached(e, () => {
          for (const { name, system } of built) {
            const block = blockOf(e, name);
            if (block) system.attach(e.id, block, e);
          }
        });
      } finally {
        current = outer;
      }
    },
    attaching: (id) => (current?.id === id ? current : undefined),
    detach(e) {
      carriers.delete(e.id);
      dropped.delete(e.id);
      parked.delete(e.id);
      forget(e.id);
      if (!e.behaviors) return;
      for (let i = built.length - 1; i >= 0; i--) {
        const { name, system } = built[i]!;
        if (blockOf(e, name)) system.detach(e.id);
      }
    },
    update(e, prev) {
      if (!e.behaviors && !prev.behaviors) return;
      const gone = dropped.get(prev.id);
      dropped.delete(prev.id);
      carriers.delete(prev.id);
      if (e.behaviors) carriers.set(e.id, e);
      attached(e, () => {
        for (let i = built.length - 1; i >= 0; i--) {
          const { name, system } = built[i]!;
          if (blockOf(prev, name) && !blockOf(e, name) && !gone?.has(name)) {
            forget(prev.id, name);
            system.detach(prev.id);
          }
        }
        for (const { name, system } of built) {
          const block = blockOf(e, name);
          if (!block) continue;
          const before = gone?.has(name) ? undefined : blockOf(prev, name);
          if (before && system.update) {
            if (system.update(e.id, block, before, e) === true) forget(e.id, name);
          } else {
            forget(e.id, name);
            if (before) system.detach(prev.id);
            system.attach(e.id, block, e);
          }
        }
      });
    },
    beforeStep(dtMs, timing) {
      for (let i = 0; i < built.length; i++) {
        const { system } = built[i]!;
        if (!system.beforeStep) continue;
        system.beforeStep(dtMs);
        timing?.lap(beforeStepParts[i]!);
      }
    },
    beforePhysics(timing) {
      for (let i = 0; i < built.length; i++) {
        const { system } = built[i]!;
        if (!system.beforePhysics) continue;
        system.beforePhysics();
        timing?.lap(beforePhysicsParts[i]!);
      }
    },
    step(dtMs, timing) {
      for (let i = 0; i < built.length; i++) {
        const { system } = built[i]!;
        if (!system.step) continue;
        system.step(dtMs);
        timing?.lap(stepParts[i]!);
      }
    },
    render(alpha) {
      for (const { system } of built) system.render?.(alpha);
    },
    reset() {
      for (const { system } of built) system.reset?.();
    },
    seek(ms) {
      for (const { system } of built) system.seek?.(ms);
    },
    clear() {
      carriers.clear();
      dropped.clear();
      parked.clear();
      handles.clear();
      for (let i = built.length - 1; i >= 0; i--) built[i]!.system.clear();
    },
    ready(ids) {
      for (const { name, system } of built) {
        if (!system.ready) continue;
        const carrying = ids.filter((id) => {
          const e = carriers.get(id);
          return e !== undefined && blockOf(e, name) && !dropped.get(id)?.has(name);
        });
        if (carrying.length > 0) system.ready(carrying);
      }
    },
    disable(e) {
      if (!e.behaviors) return;
      const gone = dropped.get(e.id);
      const off = new Set<BehaviorName>();
      for (let i = built.length - 1; i >= 0; i--) {
        const { name, system } = built[i]!;
        if (!blockOf(e, name) || gone?.has(name)) continue;
        if (system.disable) system.disable(e.id);
        else {
          forget(e.id, name);
          system.detach(e.id);
          off.add(name);
        }
      }
      if (off.size > 0) parked.set(e.id, off);
    },
    enable(e) {
      if (!e.behaviors) return;
      const gone = dropped.get(e.id);
      const off = parked.get(e.id);
      parked.delete(e.id);
      attached(e, () => {
        for (const { name, system } of built) {
          const block = blockOf(e, name);
          if (!block || gone?.has(name)) continue;
          if (off?.has(name)) system.attach(e.id, block, e);
          else if (system.disable) system.enable?.(e.id);
        }
      });
    },
    stats() {
      const out: Record<BehaviorName, number> = {};
      for (const { name, system } of built) {
        const n = system.size();
        if (n > 0) out[name] = n;
      }
      return out;
    },
    system: <S extends BehaviorSystem = BehaviorSystem>(name: BehaviorName) =>
      byName.get(name) as S | undefined,
    save(e) {
      const out: Record<BehaviorName, JsonValue> = {};
      for (const { name, system } of live(e)) {
        const state = system.save?.(e.id);
        if (state !== undefined) out[name] = state;
      }
      return out;
    },
    restore(e, states) {
      for (const { name, system } of live(e)) {
        const state = states[name];
        if (state !== undefined) system.restore?.(e.id, state);
      }
    },
    handle(e, name) {
      const current = carriers.get(e.id);
      if (!current || !blockOf(current, name)) return undefined;
      const cached = handles.get(e.id)?.get(name);
      if (cached) return cached;
      const def = registry.behaviors.get(name);
      if (!def) return undefined;
      const system = byName.get(name);
      if (system) {
        if (dropped.get(e.id)?.has(name) || parked.get(e.id)?.has(name)) return undefined;
      } else if (factoryOf(def)) return undefined;
      const made = system?.handle ? system.handle(e.id) : {};
      if (!made) return undefined;
      if (!("fields" in made)) {
        Object.defineProperty(made, "fields", {
          get: () => blockOf(carriers.get(e.id) ?? current, name),
          enumerable: true,
        });
      }
      let own = handles.get(e.id);
      if (!own) handles.set(e.id, (own = new Map()));
      own.set(name, made);
      return made;
    },
    posed(e, pose, snap) {
      for (const { system } of live(e)) system.posed?.(e.id, pose, snap);
    },
    selfMoving(e) {
      for (const { system } of live(e)) if (system.selfMoving?.(e.id) === true) return true;
      return false;
    },
    ride(e, host) {
      for (const { system } of live(e)) system.ride?.(e.id, host);
    },
    reloadAssets(changed) {
      if (changed.length === 0) return [];
      const ids = new Set(changed);
      const errors: HostReloadError[] = [];
      for (const e of [...carriers.values()]) {
        const gone = dropped.get(e.id);
        const off = parked.get(e.id);
        const touched: (Built & { block: BehaviorBlock })[] = [];
        for (const { name, system } of built) {
          const block = blockOf(e, name);
          if (block && !gone?.has(name) && !off?.has(name) && namesChanged(name, block, ids))
            touched.push({ name, system, block });
        }
        const detachTouched = () => {
          for (let i = touched.length - 1; i >= 0; i--) {
            forget(e.id, touched[i]!.name);
            touched[i]!.system.detach(e.id);
          }
        };
        try {
          for (const { name, system, block } of touched) {
            if (system.update) {
              if (system.update(e.id, block, block, e) === true) forget(e.id, name);
            } else {
              forget(e.id, name);
              system.detach(e.id);
              system.attach(e.id, block, e);
            }
          }
        } catch (err) {
          detachTouched();
          let reattached = true;
          try {
            for (const { system, block } of touched) system.attach(e.id, block, e);
          } catch {
            detachTouched();
            const names = gone ?? new Set<BehaviorName>();
            for (const { name } of touched) names.add(name);
            dropped.set(e.id, names);
            reattached = false;
          }
          errors.push({ entityId: e.id, error: err, reattached });
        }
      }
      return errors;
    },
  };
}

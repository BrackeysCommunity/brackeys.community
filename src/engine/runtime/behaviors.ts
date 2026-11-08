import type {
  BehaviorBlock,
  BehaviorName,
  BehaviorSystem,
  BehaviorSystemFactory,
  RegisteredBehavior,
} from "../game/behaviors";
import { ENGINE_REGISTRY_ID, type EngineContext, type Registry } from "../game/types";
import { schemaRefSites } from "../project/refs";
import type { AssetId } from "../project/types";
import type { RuntimeEntity } from "../scene/types";
import { ENGINE_BEHAVIOR_SYSTEMS } from "./behaviors/index";

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
   * A throw detaches `e` from every system, then rethrows.
   */
  update(e: RuntimeEntity, prev: RuntimeEntity): void;
  step(dtMs: number): void;
  render(alpha: number): void;
  reset(): void;
  seek(ms: number): void;
  clear(): void;
  /** Each built system's live attachments, by behavior; zeros left out. */
  stats(): Record<BehaviorName, number>;
  /** The built system for `name`; undefined for a data-only behavior or a visual-only one headless. */
  system<S extends BehaviorSystem = BehaviorSystem>(name: BehaviorName): S | undefined;
  /**
   * Redraws each attached entity's blocks that name one of `changed` (or an
   * atlas cut from one) through the block's asset fields: `update` with the
   * same block, else detach and attach. Systems read the project's new info.
   */
  reloadAssets(changed: readonly AssetId[]): void;
};

type Built = { name: BehaviorName; system: BehaviorSystem };

/** The factory a behavior builds from: the engine's map for its own, the def's for a game's. */
function factoryOf(def: RegisteredBehavior): BehaviorSystemFactory | undefined {
  if (def.origin === ENGINE_REGISTRY_ID) return ENGINE_BEHAVIOR_SYSTEMS[def.name];
  return def.system;
}

const blockOf = (e: RuntimeEntity, name: BehaviorName): BehaviorBlock | undefined =>
  e.behaviors?.[name];

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
  for (const name of registry.behaviorNames) {
    const def = registry.behaviors.get(name);
    if (!def || (def.visualOnly && ctx.view === null)) continue;
    const factory = factoryOf(def);
    if (!factory) continue;
    const system = factory(ctx, def);
    built.push({ name, system });
    byName.set(name, system);
  }

  /** Detaches `id` from every built system, in reverse; each `detach` is idempotent. */
  function detachEverywhere(id: string): void {
    for (let i = built.length - 1; i >= 0; i--) built[i]!.system.detach(id);
  }

  function attached(e: RuntimeEntity, run: () => void): void {
    try {
      run();
    } catch (err) {
      detachEverywhere(e.id);
      carriers.delete(e.id);
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

  return {
    attach(e) {
      if (!e.behaviors) return;
      carriers.set(e.id, e);
      attached(e, () => {
        for (const { name, system } of built) {
          const block = blockOf(e, name);
          if (block) system.attach(e.id, block, e);
        }
      });
    },
    detach(e) {
      carriers.delete(e.id);
      if (!e.behaviors) return;
      for (let i = built.length - 1; i >= 0; i--) {
        const { name, system } = built[i]!;
        if (blockOf(e, name)) system.detach(e.id);
      }
    },
    update(e, prev) {
      if (!e.behaviors && !prev.behaviors) return;
      carriers.delete(prev.id);
      if (e.behaviors) carriers.set(e.id, e);
      attached(e, () => {
        for (let i = built.length - 1; i >= 0; i--) {
          const { name, system } = built[i]!;
          if (blockOf(prev, name) && !blockOf(e, name)) system.detach(prev.id);
        }
        for (const { name, system } of built) {
          const block = blockOf(e, name);
          if (!block) continue;
          const before = blockOf(prev, name);
          if (!before) system.attach(e.id, block, e);
          else if (system.update) system.update(e.id, block, before, e);
          else {
            system.detach(prev.id);
            system.attach(e.id, block, e);
          }
        }
      });
    },
    step(dtMs) {
      for (const { system } of built) system.step?.(dtMs);
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
      for (let i = built.length - 1; i >= 0; i--) built[i]!.system.clear();
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
    reloadAssets(changed) {
      if (changed.length === 0) return;
      const ids = new Set(changed);
      for (const e of [...carriers.values()]) {
        attached(e, () => {
          for (const { name, system } of built) {
            const block = blockOf(e, name);
            if (!block || !namesChanged(name, block, ids)) continue;
            if (system.update) system.update(e.id, block, block, e);
            else {
              system.detach(e.id);
              system.attach(e.id, block, e);
            }
          }
        });
      }
    },
  };
}

import type { BehaviorName } from "../game/behaviors";
import type { BehaviorKey, Entity, HandleOf } from "../game/entity";
import { behaviorNameOf } from "../game/script";
import type { EngineContext } from "../game/types";
import type { BehaviorHost } from "./behaviors";
import { behaviorHandlesOn, type EntityHandles } from "./entities";
import type { RuntimeQueryIndex } from "./query-index";

export type LookupDeps = {
  ctx: EngineContext;
  behaviors: BehaviorHost;
  query: RuntimeQueryIndex;
  handles: EntityHandles;
};

/** `EngineContext.entities`, `findBehavior` and `findBehaviors`: handles found by selector or by behavior. */
export type Lookups = Pick<EngineContext, "entities" | "findBehavior" | "findBehaviors">;

/**
 * Lookups over the query index, answered as handles through `ctx.entity`.
 * A behavior lookup skips an entity whose block has no handle now: its
 * system isn't built (visual-only, headless) or holds the block detached.
 */
export function createLookups(deps: LookupDeps): Lookups {
  const { query, handles } = deps;

  /** The selector's default leaves disabled carriers out. */
  const carrying = (name: BehaviorName, first: boolean) =>
    behaviorHandlesOn(query.select({ behavior: name }), first, (id) =>
      handles.entity(id)?.getBehavior(name),
    );

  return {
    entities(sel) {
      const out: Entity[] = [];
      for (const id of query.select(sel)) {
        const entity = handles.entity(id);
        if (entity) out.push(entity);
      }
      return out;
    },
    findBehavior<D extends BehaviorKey = never>(def: D | BehaviorName) {
      return carrying(behaviorNameOf(def), true)[0] as HandleOf<D> | undefined;
    },
    findBehaviors<D extends BehaviorKey = never>(def: D | BehaviorName) {
      return carrying(behaviorNameOf(def), false) as HandleOf<D>[];
    },
  };
}

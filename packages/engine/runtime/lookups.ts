import type { BehaviorName } from "../game/behaviors";
import type { BehaviorKey, Entity, HandleOf } from "../game/entity";
import { behaviorNameOf } from "../game/script";
import type { EngineContext } from "../game/types";
import type { BehaviorHost } from "./behaviors";
import type { EntityHandles } from "./entities";
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

  function* carrying(name: BehaviorName): Generator<object> {
    for (const id of query.select({ behavior: name })) {
      const found = handles.entity(id)?.getBehavior(name);
      if (found) yield found;
    }
  }

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
      const name = behaviorNameOf(def);
      for (const found of carrying(name)) return found as HandleOf<D>;
      return undefined;
    },
    findBehaviors<D extends BehaviorKey = never>(def: D | BehaviorName) {
      const name = behaviorNameOf(def);
      return [...carrying(name)] as HandleOf<D>[];
    },
  };
}

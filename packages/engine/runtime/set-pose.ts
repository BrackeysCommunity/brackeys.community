import { EngineError, type EngineContext, type SceneSystem } from "../game/types";
import type { EntityTypeName, RuntimeEntity } from "../scene/types";
import type { BehaviorHost } from "./behaviors";

export type SetPoseDeps = {
  ctx: EngineContext;
  systems: ReadonlyMap<EntityTypeName, SceneSystem>;
  behaviors: BehaviorHost;
  /** A live entity's record. */
  get(id: string): RuntimeEntity | undefined;
  /** Whether a live entity is on. */
  enabled(id: string): boolean;
};

/**
 * `EngineContext.setPose`: the type system's `setPose`, then the snap
 * write, then each attached behavior's `posed` in registration order. A
 * disabled entity takes the pose index write alone. A type whose system
 * has no `setPose` refuses with `pose-not-settable`.
 */
export function createSetPose(deps: SetPoseDeps): EngineContext["setPose"] {
  const { ctx, systems, behaviors } = deps;
  return (id, x, y, rot, opts) => {
    const e = deps.get(id);
    if (!e)
      throw new EngineError("entity-gone", `can't pose "${id}": no live entity has that id`, id);
    const system = systems.get(e.type);
    if (!system?.setPose) {
      throw new EngineError(
        "pose-not-settable",
        `can't pose "${id}": its type "${e.type}" has no setPose, so nothing can move it`,
        id,
      );
    }
    const angle = rot ?? ctx.poses.get(id)?.rot ?? 0;
    const snap = opts?.snap === true;
    if (!deps.enabled(id)) {
      ctx.poses.set(id, x, y, angle, snap ? { snap } : undefined);
      return;
    }
    system.setPose(id, x, y, angle);
    if (snap) ctx.poses.set(id, x, y, angle, { snap });
    behaviors.posed(e, ctx.poses.get(id) ?? { x, y, rot: angle }, snap);
  };
}

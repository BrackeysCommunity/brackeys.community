import { bindTo, type BehaviorSystem, type BehaviorSystemFactory } from "../../game/behaviors";
import type { BodyBlock, BodyHandle } from "../../game/behaviors/body";
import { COLLIDER, type ColliderSystem } from "../../game/behaviors/collider";
import type { EngineContext, JsonValue } from "../../game/types";

/**
 * A body's velocity in a world save, m/s then rad/s, each left out at 0.
 * Even an empty one makes the restore rebuild the body at its restored pose.
 */
type SavedMotion = { v?: [number, number]; w?: number };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * The `body` behavior's system. The `collider` system builds the body for
 * both blocks; this one asks it to rebuild when the `body` block comes,
 * changes or goes, and keeps the body's velocity through saves. A disabled
 * body keeps its velocity for when it is enabled.
 */
export const createBodySystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const carried = new Set<string>();
  const colliders = () => ctx.behavior<ColliderSystem>(COLLIDER.name);

  function rebuild(id: string): void {
    const collider = colliders();
    if (collider?.has(id)) collider.rebuild(id);
  }

  const system: BehaviorSystem<BodyBlock> = {
    attach(id) {
      carried.add(id);
      rebuild(id);
    },
    update(id) {
      rebuild(id);
    },
    detach(id) {
      if (carried.delete(id)) rebuild(id);
    },
    /** The collider system takes the body out of the world, which keeps its velocity. */
    disable() {},
    enable() {},
    clear() {
      carried.clear();
    },
    size: () => carried.size,
    handle: (id): BodyHandle =>
      bindTo(ctx.bodies, id, [
        "kind",
        "velocity",
        "setVelocity",
        "angularVelocity",
        "setAngularVelocity",
        "applyImpulse",
        "applyForce",
        "applyTorque",
        "mass",
        "wake",
      ]),
    save(id): JsonValue | undefined {
      if (!ctx.bodies.has(id) || ctx.bodies.kind(id) === "static") return undefined;
      const v = ctx.bodies.velocity(id);
      const w = ctx.bodies.angularVelocity(id);
      const saved: SavedMotion = {};
      if (v.x !== 0 || v.y !== 0) saved.v = [v.x, v.y];
      if (w !== 0) saved.w = w;
      return saved;
    },
    restore(id, state) {
      rebuild(id);
      if (typeof state !== "object" || state === null || Array.isArray(state)) return;
      if (!ctx.bodies.has(id) || ctx.bodies.kind(id) === "static") return;
      const { v, w } = state;
      if (Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]))
        ctx.bodies.setVelocity(id, { x: v[0], y: v[1] });
      if (finite(w)) ctx.bodies.setAngularVelocity(id, w);
    },
  };
  return system as BehaviorSystem;
};

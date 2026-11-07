import type { RuntimeBehavior, RuntimeEntity } from "../scene/types";

export type EntityOf<B extends RuntimeBehavior> = Extract<RuntimeEntity, { b: B }>;

/**
 * One behavior's slice of a scene. A system owns the bodies, colliders, tags
 * and visuals it creates and never reads another system's geometry.
 */
export interface SceneSystem<E extends RuntimeEntity = RuntimeEntity> {
  readonly behaviors: readonly RuntimeBehavior[];
  spawn(e: E): void;
  /** Idempotent: an unknown id is a no-op. */
  despawn(id: string): void;
  clear(): void;
  /** Fast path for an edit; without it the runtime despawns and respawns. */
  update?(e: E, prev: E): void;
  /** Back to t = 0 without respawning. */
  reset?(): void;
  /** Live entities, scene and runtime alike. */
  size(): number;
}

import type { EngineContext, SceneSystem } from "@jams/engine/game";

import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import { createPlayerEntity, PLAYER_HEIGHT, type PlayerEntity } from "../entities/player";
import type { ConstructSystem } from "../entities/shaper-constructs";
import { TYPE } from "../type-names";
import type { PlayerTypeEntity } from "../types";

/**
 * The player type's system. It has no step hooks: the game runtime drives
 * each actor's `update` from its own hooks, so the type's place in the
 * spawn order can't change a step.
 */
export type PlayerSystem = SceneSystem<PlayerTypeEntity> & {
  /** The live actor `id`, if any. */
  actor(id: string): PlayerEntity | undefined;
  /** Writes each actor's pose (its feet, as `at`) from its body; call after the physics step. */
  syncPoses(): void;
};

export function createPlayerSystem(ctx: EngineContext): PlayerSystem {
  const actors = new Map<string, PlayerEntity>();

  function pose(id: string, actor: PlayerEntity, snap: boolean): void {
    const { x, y } = actor.getPosition();
    ctx.poses.set(id, x, y + PLAYER_HEIGHT / 2, 0, snap ? { snap } : undefined);
  }

  function despawn(id: string): void {
    const actor = actors.get(id);
    if (!actor) return;
    actors.delete(id);
    actor.destroy();
  }

  return {
    spawn(e) {
      const actor = createPlayerEntity(
        ctx,
        { x: e.at[0], y: e.at[1] },
        {
          anchors: ctx.system<GrappleAnchorSystem>(TYPE.anchor),
          forces: ctx.system<ConstructSystem>(TYPE.construct)?.forces,
        },
        e.id,
      );
      actors.set(e.id, actor);
      pose(e.id, actor, true);
    },
    despawn,
    clear() {
      for (const id of [...actors.keys()]) despawn(id);
    },
    size: () => actors.size,
    actor: (id) => actors.get(id),
    syncPoses() {
      for (const [id, actor] of actors) pose(id, actor, false);
    },
  };
}

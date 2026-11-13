/**
 * The `path-follow` behavior's schema: moves any entity along a waypoint
 * path, as the follower type moves its body. Zod only; the system lives in
 * `runtime/behaviors/path-follow.ts`.
 */
import type { z } from "zod";

import type { Vec2 } from "../../types";
import { defineBehavior, type BehaviorSystem } from "../behaviors";
import { PathSchema } from "../fields";

const pathFollowFields = {
  path: PathSchema,
};

/** A `path-follow` block as an entity carries it. */
export type PathFollowBlock = z.infer<z.ZodObject<typeof pathFollowFields>>;

export type PathFollowSystem = BehaviorSystem<PathFollowBlock> & {
  /** Where the entity is on its path now, world m; null for one not attached. */
  position(entityId: string): Vec2 | null;
  /** How far the entity's body moved in the last beforeStep, for carrying riders; null when this behavior moves no body of it. */
  frameDelta(entityId: string): Vec2 | null;
};

export const PATH_FOLLOW = defineBehavior({
  name: "path-follow",
  description:
    "Moves the entity along a waypoint path; with a kinematic body it carries what stands on it.",
  fields: pathFollowFields,
  conflicts: ["character-top-down", "character-side-view", "nav-agent"],
  inspector: { category: "movement", label: "Path follow", order: ["path"] },
  template: {
    path: {
      pts: [
        [0, 0],
        [2, 0],
      ],
      mode: "ping_pong",
      speed: 1,
    },
  },
});

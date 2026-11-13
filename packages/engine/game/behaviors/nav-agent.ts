/**
 * The `nav-agent` behavior's schema: an entity that walks the scene's walk
 * areas to a destination. Zod only; the system lives in
 * `runtime/behaviors/nav-agent.ts`.
 */
import { z } from "zod";

import type { Vec2 } from "../../types";
import { defineBehavior, type BehaviorSystem } from "../behaviors";
import { pointField, refField } from "../fields";

const metres = (title: string, fallback: number, description: string) =>
  z
    .number()
    .positive()
    .default(fallback)
    .describe(`${description} Default ${fallback}.`)
    .meta({ title, unit: "m", group: "navigation" });

const navAgentFields = {
  speed: z
    .number()
    .positive()
    .default(1.2)
    .describe("Walking speed, m/s. Default 1.2.")
    .meta({ title: "Speed", unit: "m/s", group: "navigation" }),
  arrive: metres(
    "Arrive within",
    0.12,
    "How close to a waypoint or the destination counts as there, m.",
  ),
  radius: metres("Radius", 0.3, "Other agents closer than this are pushed apart from it, m."),
  separation: z
    .number()
    .min(0)
    .default(1.5)
    .describe("How hard that push is against the pull of the path: 0 never pushes. Default 1.5.")
    .meta({ title: "Separation", group: "navigation" }),
  repathTicks: z
    .number()
    .int()
    .min(1)
    .default(180)
    .describe(
      "Ticks between plans toward a moving entity, and how long without progress before it is blocked. Default 180: 3 s at 60 ticks a second.",
    )
    .meta({ title: "Repath every", unit: "ticks", group: "navigation" }),
  to: z
    .union([
      pointField("A point in world metres: placed with the entity, as a path is."),
      refField("An entity's id: it follows that entity."),
    ])
    .optional()
    .describe(
      "Where it walks from the start: a point, world m, or an entity it follows; omitted, it waits for setDestination.",
    )
    .meta({ title: "Destination", group: "navigation" }),
};

/** A `nav-agent` block as an entity carries it, defaults applied. */
export type NavAgentBlock = z.infer<z.ZodObject<typeof navAgentFields>>;

export type NavAgentSystem = BehaviorSystem<NavAgentBlock> & {
  /** Walks to a point, world m, or follows an entity by id; raises nav:arrived or nav:blocked. */
  setDestination(entityId: string, to: Vec2 | string): void;
  /** Stops where it is and forgets its destination. */
  stop(entityId: string): void;
  /** The waypoints left on its route, world m; null with no destination. */
  path(entityId: string): readonly Vec2[] | null;
};

export const NAV_AGENT = defineBehavior({
  name: "nav-agent",
  description:
    "Walks the entity through the scene's walk areas to a point or another entity, kept apart from other agents; raises nav:arrived and nav:blocked.",
  fields: navAgentFields,
  conflicts: ["character-top-down", "character-side-view", "path-follow"],
  inspector: {
    category: "movement",
    label: "Nav agent",
    order: ["speed", "arrive", "radius", "separation", "repathTicks", "to"],
  },
});

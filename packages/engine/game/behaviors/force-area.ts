/**
 * The `force-area` behavior's schema: pushes the dynamic bodies inside the
 * entity's sensor collider. Zod only; the system lives in
 * `runtime/behaviors/force-area.ts`.
 */
import { z } from "zod";

import type { Vec2 } from "../../types";
import { defineBehavior, type BehaviorSystem } from "../behaviors";
import { ID_PATTERN } from "../fields";

const names = (description: string) =>
  z.array(z.string().regex(ID_PATTERN)).min(1).optional().describe(description);

const forceAreaFields = {
  kind: z
    .enum(["directional", "point"])
    .default("directional")
    .describe(
      "directional: one acceleration everywhere inside. point: toward (or, negative, away from) the entity's pose. Default directional.",
    )
    .meta({ title: "Kind", group: "force" }),
  force: z
    .tuple([
      z.number().describe("x, m/s².").meta({ unit: "m/s²" }),
      z.number().describe("y, m/s²; y is down.").meta({ unit: "m/s²" }),
    ])
    .optional()
    .describe("directional: the acceleration it gives what is inside, m/s²; turns with the entity.")
    .meta({
      title: "Force",
      unit: "m/s²",
      kind: "vector",
      group: "force",
      when: { kind: ["directional"] },
    }),
  strength: z
    .number()
    .optional()
    .describe("point: the acceleration toward its pose, m/s²; negative pushes away.")
    .meta({ title: "Strength", unit: "m/s²", group: "force", when: { kind: ["point"] } }),
  falloff: z
    .enum(["none", "linear", "inverse-square"])
    .default("none")
    .describe(
      "point: how strength fades with distance from the pose: none, linear to zero at the collider's edge, or inverse-square past 1 m. Default none.",
    )
    .meta({ title: "Falloff", group: "force", when: { kind: ["point"] } }),
  drag: z
    .number()
    .min(0)
    .default(0)
    .describe("Slows what is inside against its velocity, per second: 0 none. Default 0.")
    .meta({ title: "Drag", unit: "/s", group: "force" }),
  affects: z
    .strictObject({
      groups: names("Only bodies in one of these collision groups.").meta({
        widget: "collision-group",
      }),
      tags: names("Only entities with one of these tags."),
    })
    .optional()
    .describe("Which bodies it pushes; omitted, every dynamic body inside.")
    .meta({ title: "Affects", group: "force" }),
};

/** A `force-area` block as an entity carries it, defaults applied. */
export type ForceAreaBlock = z.infer<z.ZodObject<typeof forceAreaFields>>;

export type ForceAreaSystem = BehaviorSystem<ForceAreaBlock> & {
  /**
   * The summed acceleration every area containing `point` gives, m/s²: what
   * a kinematic controller adds. With `entityId`, only the areas whose
   * `affects` takes that entity count, by the rule they push bodies by. The
   * characters add it to their own velocity, which their `decel` then works
   * against while idle: a push weaker than the decel builds no speed, and a
   * stronger one carries the character at the difference.
   */
  sample(point: Vec2, entityId?: string): Vec2;
};

/** The refusal of a force area whose collider isn't a sensor, at validation and at attach alike. */
export function forceAreaSensorMessage(entityId: string): string {
  return `${entityId}'s force-area needs its collider to be a sensor (sensor: true)`;
}

export const FORCE_AREA = defineBehavior({
  name: "force-area",
  description:
    "Pushes the dynamic bodies inside the entity's sensor collider: one way, or toward or away from a point.",
  fields: forceAreaFields,
  requires: ["collider"],
  inspector: {
    category: "physics",
    label: "Force area",
    order: ["kind", "force", "strength", "falloff", "drag", "affects"],
  },
  template: { kind: "directional", force: [0, -20] },
  refine(block) {
    if (block.kind === "point") {
      if (block.strength === undefined) return "a point force-area needs `strength`";
      if (block.force !== undefined) return "a point force-area takes `strength`, not `force`";
    } else {
      if (block.force === undefined) return "a directional force-area needs `force`";
      if (block.strength !== undefined)
        return "a directional force-area takes `force`, not `strength`";
    }
    return undefined;
  },
});

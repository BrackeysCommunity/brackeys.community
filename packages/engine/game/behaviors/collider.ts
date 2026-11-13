/**
 * The `collider` behavior's schema: a collision shape on any entity, static
 * on its own, moved by a `body` beside it. Zod only; the system lives in
 * `runtime/behaviors/collider.ts`.
 */
import { z } from "zod";

import { defineBehavior, type BehaviorSystem } from "../behaviors";
import { bodyShapeField, ID_PATTERN, materialField } from "../fields";
import type { FieldEnv } from "../types";

const colliderFields = (env: FieldEnv) => ({
  shape: bodyShapeField(
    'The collision shape, local to the entity\'s pose: centred on 0, 0 for one around it (e.g. ["box", 0, 0, 0.25, 0.25]). Not chain.',
  ).meta({ title: "Shape", group: "collider" }),
  sensor: z
    .boolean()
    .default(false)
    .describe(
      "When true it collides with nothing and raises sensor:enter and sensor:exit, as the sensor type does.",
    )
    .meta({ title: "Sensor", group: "collider" }),
  material: materialField(env),
  group: z
    .string()
    .regex(ID_PATTERN)
    .optional()
    .describe(
      "The collision group it belongs to, one of the game's; omitted: sensor for a sensor (dynamic in a project with no game), dynamic on a dynamic body, else static.",
    )
    .meta({ title: "Collision group", group: "collider" }),
  density: z
    .number()
    .positive()
    .default(1)
    .describe("Density in kg/m²; with a dynamic body it sets the mass.")
    .meta({ title: "Density", unit: "kg/m²", group: "surface" }),
  friction: z
    .number()
    .min(0)
    .optional()
    .describe("Surface friction; omitted uses the material's, else the physics default.")
    .meta({ title: "Friction", group: "surface", placeholder: "from material" }),
  restitution: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Bounciness: 0 doesn't bounce, 1 keeps all its speed; omitted uses the material's, else 0.",
    )
    .meta({ title: "Restitution", group: "surface", placeholder: "from material" }),
});

/** A `collider` block as an entity carries it, defaults applied. */
export type ColliderBlock = z.infer<z.ZodObject<ReturnType<typeof colliderFields>>>;

/**
 * The `collider` behavior's system. It owns the entity's physics body and
 * collider for its `collider` and `body` blocks both.
 */
export type ColliderSystem = BehaviorSystem<ColliderBlock> & {
  /** Whether `entityId` carries an attached collider. */
  has(entityId: string): boolean;
  /** Builds the entity's body and collider again from its current blocks. */
  rebuild(entityId: string): void;
};

export const COLLIDER = defineBehavior({
  name: "collider",
  description:
    "A collision shape on the entity: static on its own, moved by a body beside it, or a trigger with sensor.",
  fields: colliderFields,
  inspector: {
    category: "physics",
    label: "Collider",
    order: ["shape", "sensor", "group", "material", "density", "friction", "restitution"],
  },
  template: { shape: ["box", 0, 0, 0.25, 0.25] },
});

/**
 * The `body` behavior's schema: makes an entity's collider a dynamic,
 * kinematic or static physics body. Zod only; the `collider` system builds
 * the body, and `runtime/behaviors/body.ts` keeps its motion.
 */
import { z } from "zod";

import { defineBehavior } from "../behaviors";
import { BODY_FIELDS } from "../primitives";

/** What moves a body: forces and contacts, code alone, or nothing. */
export const BODY_KINDS = ["dynamic", "kinematic", "static"] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

const bodyFields = {
  kind: z
    .enum(BODY_KINDS)
    .default("dynamic")
    .describe(
      "dynamic: gravity, forces and contacts move it. kinematic: only code moves it, and it carries what stands on it. static: it never moves.",
    )
    .meta({ title: "Kind", group: "body" }),
  ...BODY_FIELDS,
};

/** A `body` block as an entity carries it, defaults applied. */
export type BodyBlock = z.infer<z.ZodObject<typeof bodyFields>>;

export const BODY = defineBehavior({
  name: "body",
  description:
    "Makes the entity's collider a physics body: dynamic, kinematic or static. A dynamic body needs physics.",
  fields: bodyFields,
  requires: ["collider"],
  inspector: {
    label: "Body",
    order: ["kind", "gravityScale", "linearDamping", "angularDamping", "fixedRotation", "ccd"],
  },
});

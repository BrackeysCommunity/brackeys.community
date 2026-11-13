/**
 * The `joint` behavior's schema: links the entity's body to another
 * entity's. Zod only; the system lives in `runtime/behaviors/joint.ts`.
 */
import { z } from "zod";

import { defineBehavior, type BehaviorSystem } from "../behaviors";
import { refField, vectorField } from "../fields";

/** Rapier's joint constructors, by what they do. */
export const JOINT_KINDS = ["revolute", "prismatic", "rope", "weld", "spring"] as const;
export type JointKind = (typeof JOINT_KINDS)[number];

const jointFields = {
  kind: z
    .enum(JOINT_KINDS)
    .describe(
      "revolute: a hinge. prismatic: a slider along axis. rope: at most length apart. weld: held rigidly. spring: pulled toward length apart.",
    )
    .meta({ title: "Kind", group: "joint" }),
  to: refField(
    "The other entity's id: one with a body or a collider that isn't a sensor (joint-ref-type otherwise), never this one (joint-self).",
  ).meta({ title: "To", group: "joint" }),
  anchorA: vectorField("Where the joint holds this entity's body, from its pose, m.")
    .optional()
    .meta({ title: "Anchor", group: "joint" }),
  anchorB: vectorField(
    "Where the joint holds the other entity's body, from its pose, m. Default: the point under `anchorA` when the joint is first made.",
  )
    .optional()
    .meta({ title: "Anchor on `to`", group: "joint" }),
  axis: vectorField("prismatic: the slide direction, in this body's frame. Default [1, 0].")
    .optional()
    .meta({ title: "Axis", group: "joint" }),
  limits: z
    .tuple([z.number().describe("The low limit."), z.number().describe("The high limit.")])
    .optional()
    .describe(
      "revolute: this body's angle relative to `to`, radians. prismatic: its travel along axis, m.",
    )
    .meta({ title: "Limits", group: "limits" }),
  motor: z
    .strictObject({
      velocity: z.number().describe("The target speed: rad/s for revolute, m/s for prismatic."),
      maxForce: z.number().positive().describe("The most force (or torque) it uses, N."),
    })
    .optional()
    .describe("revolute and prismatic: drives this body's speed relative to `to` toward velocity.")
    .meta({ title: "Motor", group: "limits" }),
  length: z
    .number()
    .positive()
    .optional()
    .describe("rope: the most they can be apart, m. spring: the rest length, m.")
    .meta({ title: "Length", unit: "m", group: "joint" }),
  stiffness: z
    .number()
    .positive()
    .optional()
    .describe("spring: how hard it pulls toward its rest length, N/m. Default 100.")
    .meta({ title: "Stiffness", group: "spring" }),
  damping: z
    .number()
    .min(0)
    .optional()
    .describe("spring: how fast its bounce dies down, N·s/m. Default 1.")
    .meta({ title: "Damping", group: "spring" }),
  collide: z
    .boolean()
    .default(false)
    .describe("Whether the two bodies still collide with each other. Default false.")
    .meta({ title: "Collide", group: "joint" }),
};

/** A `joint` block as an entity carries it, defaults applied. */
export type JointBlock = z.infer<z.ZodObject<typeof jointFields>>;

export type JointSystem = BehaviorSystem<JointBlock> & {
  /** Whether the entity's joint exists now: both bodies are live and enabled. */
  joined(entityId: string): boolean;
};

export const JOINT = defineBehavior({
  name: "joint",
  description:
    "Links the entity's body to another entity's: a hinge, a slider, a rope, a weld or a spring. Needs physics.",
  fields: jointFields,
  requires: ["body"],
  inspector: {
    label: "Joint",
    order: [
      "kind",
      "to",
      "anchorA",
      "anchorB",
      "axis",
      "limits",
      "motor",
      "length",
      "stiffness",
      "damping",
      "collide",
    ],
  },
  template: { kind: "revolute" },
  refine(block) {
    const kind = block.kind as JointKind;
    if ((kind === "rope" || kind === "spring") && block.length === undefined)
      return `a ${kind} joint needs \`length\``;
    if (kind !== "prismatic" && block.axis !== undefined)
      return "only a prismatic joint takes `axis`";
    const axis = block.axis as JointBlock["axis"];
    if (kind === "prismatic" && axis && axis[0] === 0 && axis[1] === 0)
      return "a prismatic joint's `axis` needs a direction";
    if (kind !== "revolute" && kind !== "prismatic") {
      if (block.limits !== undefined) return `a ${kind} joint takes no \`limits\``;
      if (block.motor !== undefined) return `a ${kind} joint takes no \`motor\``;
    }
    if (kind !== "spring" && (block.stiffness !== undefined || block.damping !== undefined))
      return "only a spring joint takes `stiffness` and `damping`";
    return undefined;
  },
});

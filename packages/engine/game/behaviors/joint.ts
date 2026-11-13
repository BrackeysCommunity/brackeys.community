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
    .meta({
      title: "Kind",
      group: "joint",
      options: {
        revolute: { label: "Hinge", description: "Turns about the anchors, within limits." },
        prismatic: { label: "Slider", description: "Slides along axis, within limits." },
        rope: { label: "Rope", description: "Keeps them at most length apart." },
        weld: { label: "Weld", description: "Holds them rigidly together." },
        spring: { label: "Spring", description: "Pulls them toward length apart." },
      },
    }),
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
    .meta({ title: "Other anchor", group: "joint" }),
  axis: vectorField("prismatic: the slide direction, in this body's frame. Default [1, 0].")
    .optional()
    .meta({ title: "Axis", group: "joint", when: { kind: ["prismatic"] } }),
  limits: z
    .tuple([z.number().describe("The low limit."), z.number().describe("The high limit.")])
    .optional()
    .describe(
      "revolute: this body's angle relative to `to`, radians (the editor shows degrees). prismatic: its travel along axis, m.",
    )
    .meta({
      title: "Limits",
      widget: "range",
      units: { kind: { revolute: "rad", prismatic: "m" } },
      group: "limits",
      when: { kind: ["revolute", "prismatic"] },
    }),
  motor: z
    .strictObject({
      velocity: z
        .number()
        .describe(
          "The target speed: rad/s for revolute (the editor shows deg/s), m/s for prismatic.",
        )
        .meta({ title: "Velocity", units: { kind: { revolute: "rad/s", prismatic: "m/s" } } }),
      maxForce: z
        .number()
        .positive()
        .describe("The most force it uses, N; torque for revolute, N·m.")
        .meta({ title: "Max force", units: { kind: { revolute: "N·m", prismatic: "N" } } }),
    })
    .optional()
    .describe("revolute and prismatic: drives this body's speed relative to `to` toward velocity.")
    .meta({ title: "Motor", group: "motor", when: { kind: ["revolute", "prismatic"] } }),
  length: z
    .number()
    .positive()
    .optional()
    .describe("rope: the most they can be apart, m. spring: the rest length, m.")
    .meta({ title: "Length", unit: "m", group: "joint", when: { kind: ["rope", "spring"] } }),
  stiffness: z
    .number()
    .positive()
    .optional()
    .describe("spring: how hard it pulls toward its rest length, N/m. Default 100.")
    .meta({ title: "Stiffness", unit: "N/m", group: "spring", when: { kind: ["spring"] } }),
  damping: z
    .number()
    .min(0)
    .optional()
    .describe("spring: how fast its bounce dies down, N·s/m. Default 1.")
    .meta({ title: "Damping", unit: "N·s/m", group: "spring", when: { kind: ["spring"] } }),
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
    category: "physics",
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
    const limits = block.limits as JointBlock["limits"];
    if (limits && limits[0] > limits[1]) return "limits: low must not exceed high";
    if (kind !== "revolute" && kind !== "prismatic") {
      if (block.limits !== undefined) return `a ${kind} joint takes no \`limits\``;
      if (block.motor !== undefined) return `a ${kind} joint takes no \`motor\``;
    }
    if (kind !== "spring" && (block.stiffness !== undefined || block.damping !== undefined))
      return "only a spring joint takes `stiffness` and `damping`";
    return undefined;
  },
});

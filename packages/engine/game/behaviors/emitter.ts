/**
 * The `emitter` behavior's schema: particles from an emitter preset at the
 * entity, drawn only. Zod and game/ only; the system lives in
 * `runtime/behaviors/emitter.ts` and draws through the view's particle layer.
 */
import { z } from "zod";

import type { EmitterFollow } from "../../context";
import { EMITTER_KIND } from "../../project/kinds/emitter";
import type { Pose } from "../../runtime/poses";
import { defineBehavior, handleType } from "../behaviors";
import { assetField, vectorField } from "../fields";
import type { FieldEnv } from "../types";
import { spriteOffset } from "./sprite";

const emitterFields = (env: FieldEnv) => ({
  preset: assetField(env, [EMITTER_KIND], "The emitter preset."),
  emitting: z
    .boolean()
    .optional()
    .describe("Default true.")
    .meta({ default: true, group: "emission" }),
  offset: vectorField("World metres from the pose; turns and flips with the instance.")
    .optional()
    .meta({ default: [0, 0], group: "emission" }),
  rate: z
    .number()
    .min(0)
    .optional()
    .describe("Particles per second; overrides the preset's rate.")
    .meta({ unit: "/s", placeholder: "from preset", group: "emission" }),
});

/** An `emitter` block as an entity carries it. */
export type EmitterBlock = z.infer<z.ZodObject<ReturnType<typeof emitterFields>>>;

/** Nothing beside `fields` yet. */
export type EmitterHandle = Record<never, never>;

export const EMITTER = defineBehavior({
  name: "emitter",
  handle: handleType<EmitterHandle>(),
  description:
    "Emits particles from an emitter preset at the entity, drawn only (never in the simulation).",
  visualOnly: true,
  fields: emitterFields,
  inspector: { category: "visual", label: "Emitter", order: ["preset", "emitting"] },
});

/** Where an emitter following `pose` emits: plus the offset, turned with the pose and mirrored when `flip`. */
export function followedPose(pose: Pose, follow: Omit<EmitterFollow, "entity">): Pose {
  if (!follow.offset) return pose;
  const [dx, dy] = spriteOffset(follow.offset, { rot: 0, flip: follow.flip === true }, pose.rot);
  return { x: pose.x + dx, y: pose.y + dy, rot: pose.rot };
}

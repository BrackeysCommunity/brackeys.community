/**
 * The `emitter` behavior's schema: particles from an emitter preset at the
 * entity, drawn only. Zod only; the system lives in
 * `runtime/behaviors/emitter.ts` and draws through the view's particle layer.
 */
import { z } from "zod";

import { EMITTER_KIND } from "../../project/kinds/emitter";
import { defineBehavior } from "../behaviors";
import { assetField, vectorField } from "../fields";
import type { FieldEnv } from "../types";

const emitterFields = (env: FieldEnv) => ({
  preset: assetField(env, [EMITTER_KIND], "The emitter preset."),
  emitting: z.boolean().optional().describe("Default true."),
  offset: vectorField("World metres from the pose; turns and flips with the instance.").optional(),
  rate: z
    .number()
    .min(0)
    .optional()
    .describe("Particles per second; overrides the preset's rate.")
    .meta({ unit: "/s" }),
});

/** An `emitter` block as an entity carries it. */
export type EmitterBlock = z.infer<z.ZodObject<ReturnType<typeof emitterFields>>>;

export const EMITTER = defineBehavior({
  name: "emitter",
  description:
    "Emits particles from an emitter preset at the entity, drawn only (never in the simulation).",
  visualOnly: true,
  fields: emitterFields,
  inspector: { category: "visual", label: "Emitter", order: ["preset", "emitting"] },
});

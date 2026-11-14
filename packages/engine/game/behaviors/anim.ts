/**
 * The `anim` behavior's schema: an entity's sprite plays an atlas's tags or
 * an animation's clips on the simulation's ticks, headless included. Zod
 * only; the system lives in `runtime/behaviors/anim.ts`.
 */
import { z } from "zod";

import { defineBehavior } from "../behaviors";
import { assetField } from "../fields";
import type { FieldEnv } from "../types";

const animFields = (env: FieldEnv) => ({
  source: assetField(
    env,
    ["animation", "atlas"],
    "The clips: an animation, or an atlas whose tags are clips.",
  ),
  clip: z.string().min(1).describe("The clip playing at spawn."),
  speed: z
    .number()
    .positive()
    .max(16)
    .optional()
    .describe("Multiplies the clip's speed; default 1."),
  playing: z.boolean().optional().describe("Default true."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Starts this many ticks into the clip, so a row of torches doesn't flicker in step."),
});

/** An `anim` block as an entity carries it. */
export type AnimBlock = z.infer<z.ZodObject<ReturnType<typeof animFields>>>;

export const ANIM = defineBehavior({
  name: "anim",
  description: "Plays an atlas's tags or an animation's clips on the simulation's ticks.",
  requires: ["sprite"],
  fields: animFields,
  inspector: { category: "visual", label: "Animation", order: ["source", "clip"] },
});

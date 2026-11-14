/**
 * The `anim` behavior's schema: an entity's sprite plays an atlas's tags or
 * an animation's clips on the simulation's ticks, headless included. Zod
 * only; the system lives in `runtime/behaviors/anim.ts`.
 */
import { z } from "zod";

import { ANIMATION_KIND } from "../../project/kinds/animation";
import { ATLAS_KIND } from "../../project/kinds/atlas";
import type { AnimContext } from "../../runtime/behaviors/anim";
import { type Bound, defineBehavior, handleType } from "../behaviors";
import { delayField } from "../delay-field";
import { assetField } from "../fields";
import type { FieldEnv } from "../types";

const animFields = (env: FieldEnv) => ({
  source: assetField(
    env,
    [ANIMATION_KIND, ATLAS_KIND],
    "The clips: an animation, or an atlas whose tags are clips.",
  ),
  clip: z.string().min(1).describe("The clip playing at spawn.").meta({ group: "assets" }),
  speed: z
    .number()
    .positive()
    .max(16)
    .optional()
    .describe("Multiplies the clip's speed; default 1.")
    .meta({ default: 1, group: "playback" }),
  playing: z
    .boolean()
    .optional()
    .describe("Default true.")
    .meta({ default: true, group: "playback" }),
  offset: delayField(
    "Starts this far into the clip, so a row of torches doesn't flicker in step; default 0.",
    0,
  )
    .optional()
    .meta({ title: "Start offset", default: 0, group: "playback" }),
});

/** An `anim` block as an entity carries it. */
export type AnimBlock = z.infer<z.ZodObject<ReturnType<typeof animFields>>>;

/** What `getBehavior(ANIM)` adds beside `fields`: the entity's clip. */
export type AnimHandle = Bound<AnimContext, "play" | "stop" | "state" | "shapes">;

export const ANIM = defineBehavior({
  name: "anim",
  handle: handleType<AnimHandle>(),
  description: "Plays an atlas's tags or an animation's clips on the simulation's ticks.",
  requires: ["sprite"],
  fields: animFields,
  inspector: { category: "visual", label: "Animation", order: ["source", "clip"] },
});

/**
 * The `tween` behavior's schema, the tween spec every tween is checked by,
 * and the ease names. Zod only, so a server validates a scene's tweens; the
 * system lives in `runtime/behaviors/tween.ts`, the eases in `anim/ease.ts`.
 */
import { z } from "zod";

import { defineBehavior } from "../behaviors";
import { ENGINE_REGISTRY_ID, type EntityTypeDef } from "../types";

const EASE_FAMILIES = [
  "quad",
  "cubic",
  "quart",
  "quint",
  "sine",
  "expo",
  "circ",
  "back",
  "elastic",
  "bounce",
] as const;
const EASE_ENDS = ["In", "Out", "InOut"] as const;

/** A named ease: `linear`, or a family with `In`, `Out` or `InOut`. */
export type EaseName = "linear" | `${(typeof EASE_FAMILIES)[number]}${(typeof EASE_ENDS)[number]}`;

/** Every ease, `linear` first, then each family's `In`, `Out` and `InOut`. */
export const EASE_NAMES: readonly EaseName[] = Object.freeze([
  "linear",
  ...EASE_FAMILIES.flatMap((family) => EASE_ENDS.map((end): EaseName => `${family}${end}`)),
]);

/** What a tween can animate: the pose, and a sprite's look. */
export type TweenChannel = "x" | "y" | "rot" | "alpha" | "tint" | "scale";

/** The channels that move the pose; the rest are a sprite's. */
export const POSE_CHANNELS: readonly TweenChannel[] = Object.freeze(["x", "y", "rot"]);

/** The channels that change a sprite's look: every channel that isn't the pose's. */
export const LOOK_CHANNELS = Object.freeze([
  "alpha",
  "tint",
  "scale",
] as const satisfies readonly TweenChannel[]);

/** A channel of a sprite's look. */
export type LookChannel = (typeof LOOK_CHANNELS)[number];

/** Whether `channel` is one of a sprite's look. */
export const isLookChannel = (channel: string): channel is LookChannel =>
  (LOOK_CHANNELS as readonly string[]).includes(channel);

/** The engine primitives whose systems have `setPose`; zod-only code can't ask the systems. */
export const POSED_PRIMITIVES: readonly string[] = Object.freeze([
  "marker",
  "decor",
  "solid",
  "sensor",
]);

/**
 * Whether entities of `type` can be posed, as the registry tells it: an
 * engine primitive by whether its system has `setPose`, a game type on a
 * base with no system of its own by its base's; null for a game type with
 * its own system, which only a run can tell.
 */
export function posableType(
  type: Pick<EntityTypeDef, "type" | "base" | "system"> & { origin: string },
): boolean | null {
  if (type.origin === ENGINE_REGISTRY_ID) return POSED_PRIMITIVES.includes(type.type);
  if (type.base !== undefined && type.system === undefined)
    return POSED_PRIMITIVES.includes(type.base);
  return null;
}

/** The channels a tween writes: those its `to` or `from` gives a value. */
export function tweenChannels(spec: {
  to: TweenSpec["to"];
  from?: TweenSpec["to"];
}): TweenChannel[] {
  const named = new Set<TweenChannel>();
  for (const side of [spec.to, spec.from]) {
    if (!side) continue;
    for (const [channel, value] of Object.entries(side))
      if (value !== undefined) named.add(channel as TweenChannel);
  }
  return [...named];
}

/**
 * Why an entity of `type` can't be tweened on `channels`, or null when it
 * can: a pose channel needs a type that can be posed (`posable` false
 * refuses, null leaves it to the run), a visual one a `sprite` block. Every
 * check of a tween's target goes through here: the scene validator, the
 * `tween` block's attach and `ctx.tweens.to`.
 */
export function tweenTargetProblem(
  type: { type: string; posable: boolean | null },
  channels: readonly TweenChannel[],
  hasSprite: boolean,
): string | null {
  const pose = channels.filter((c) => POSE_CHANNELS.includes(c));
  if (pose.length > 0 && type.posable === false)
    return `it is a ${type.type}, which can't be posed, so a tween can't move its ${pose.join(", ")}`;
  const visual = channels.filter(isLookChannel);
  if (visual.length > 0 && !hasSprite)
    return `it has no sprite, so a tween can't animate its ${visual.join(", ")}`;
  return null;
}

const delaySchema = (description: string, min: number) =>
  z
    .union([
      z.number().int().min(min).describe("Ticks.").meta({ unit: "ticks" }),
      z.strictObject({
        ms: z.number().min(min).describe("Milliseconds, rounded to ticks once at the run's rate."),
      }),
    ])
    .describe(description);

const channels = (description: string) =>
  z
    .strictObject({
      x: z.number().optional().describe("World x, m.").meta({ unit: "m" }),
      y: z.number().optional().describe("World y, m.").meta({ unit: "m" }),
      rot: z.number().optional().describe("Rotation, radians.").meta({ unit: "rad" }),
      alpha: z.number().min(0).max(1).optional().describe("The sprite's opacity, 0–1."),
      tint: z
        .number()
        .int()
        .min(0)
        .max(0xffffff)
        .optional()
        .describe("The sprite's tint, 0xRRGGBB, lerped per channel.")
        .meta({ widget: "color" }),
      scale: z
        .number()
        .positive()
        .optional()
        .describe("Multiplies the sprite's drawn size; 1 draws it as its block sizes it."),
    })
    .describe(description);

/** One tween as data: what a `tween` block lists and `ctx.tweens.to` takes. */
export const tweenSpecSchema = z
  .strictObject({
    to: channels("Values to reach."),
    from: channels("Values to start from; default the current ones.").optional(),
    duration: delaySchema("How long one play takes.", 1),
    ease: z
      .enum(EASE_NAMES as readonly [EaseName, ...EaseName[]])
      .optional()
      .describe("Default linear."),
    delay: delaySchema("Wait before the first play; default none.", 0).optional(),
    repeat: z
      .number()
      .int()
      .min(-1)
      .optional()
      .describe("Extra plays after the first; -1 forever. Default 0."),
    yoyo: z.boolean().optional().describe("Every other play runs backwards."),
    emit: z
      .strictObject({
        type: z.string().min(1).describe("The step event's type."),
        data: z.unknown().optional().describe("Plain JSON the event carries."),
      })
      .optional()
      .describe("Raised as a step event when the tween finishes; default `tween:end`."),
    key: z
      .string()
      .min(1)
      .optional()
      .describe("Tweens of one entity sharing a key replace each other."),
  })
  .refine((spec) => Object.values(spec.to).some((v) => v !== undefined), {
    message: "a tween's `to` names at least one channel",
  })
  .meta({ id: "TweenSpec", title: "Tween" });

/** A tween as data. */
export type TweenSpec = z.infer<typeof tweenSpecSchema>;

const tweenFields = {
  tweens: z
    .array(tweenSpecSchema)
    .min(1)
    .max(8)
    .describe("The tweens it plays from spawn, each on its own."),
};

/** A `tween` block as an entity carries it. */
export type TweenBlock = z.infer<z.ZodObject<typeof tweenFields>>;

export const TWEEN = defineBehavior({
  name: "tween",
  description:
    "Plays tweens on this entity from spawn: bobbing pickups, swinging signs, pulsing lights.",
  fields: tweenFields,
  template: { tweens: [{ to: { rot: 6.2832 }, duration: 120, repeat: -1 }] },
  inspector: { category: "movement", label: "Tween" },
});

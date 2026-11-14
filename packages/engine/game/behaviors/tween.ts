/**
 * The `tween` behavior's schema, the tween spec every tween is checked by,
 * the ease names, and the rule for what a tween can play on. Zod only, so a
 * server validates a scene's tweens; the system lives in
 * `runtime/behaviors/tween.ts`, the eases in `anim/ease.ts`.
 */
import { z } from "zod";

import type { Tweens } from "../../anim/tweens";
import { type Bound, defineBehavior, handleType } from "../behaviors";
import { rgbSchema } from "../color";
import { delayField } from "../delay-field";
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

const EASE_END_LABELS: Record<(typeof EASE_ENDS)[number], string> = {
  In: "in",
  Out: "out",
  InOut: "in-out",
};

/** Each ease's label as the inspector reads it: `sineInOut` is "Sine in-out". */
const EASE_OPTIONS = Object.fromEntries([
  ["linear", { label: "Linear" }],
  ...EASE_FAMILIES.flatMap((family) =>
    EASE_ENDS.map((end) => [
      `${family}${end}`,
      { label: `${family[0]!.toUpperCase()}${family.slice(1)} ${EASE_END_LABELS[end]}` },
    ]),
  ),
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

/** Whether `channel` moves the pose. */
export const isPoseChannel = (channel: string): channel is TweenChannel =>
  (POSE_CHANNELS as readonly string[]).includes(channel);

/** Whether `channel` is one of a sprite's look. */
export const isLookChannel = (channel: string): channel is LookChannel =>
  (LOOK_CHANNELS as readonly string[]).includes(channel);

/** The engine primitives whose systems have `setPose`; zod-only code can't ask the systems. */
export const POSED_PRIMITIVES: readonly string[] = Object.freeze([
  "node",
  "marker",
  "decor",
  "solid",
  "sensor",
  "prop",
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

/**
 * The channels a tween writes: those its `to` gives a value. `from` only
 * sets where those start; a channel named in `from` alone never moves.
 */
export function tweenChannels(spec: { to: TweenSpec["to"] }): TweenChannel[] {
  return Object.entries(spec.to)
    .filter(([, value]) => value !== undefined)
    .map(([channel]) => channel as TweenChannel);
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
  const pose = channels.filter(isPoseChannel);
  if (pose.length > 0 && type.posable === false)
    return `it is a ${type.type}, which can't be posed, so a tween can't move its ${pose.join(", ")}`;
  const visual = channels.filter(isLookChannel);
  if (visual.length > 0 && !hasSprite)
    return `it has no sprite, so a tween can't animate its ${visual.join(", ")}`;
  return null;
}

/**
 * What a tween plays on: an entity's type and whether it can be posed, as
 * `tweenTargetProblem` takes them.
 */
export type TweenTarget = { type: string; posable: boolean | null };

/**
 * Why `spec` can't play on `target`, or null when it can. A child moves in
 * its parent's frame like any other entity.
 */
export function tweenProblem(
  target: TweenTarget,
  spec: Pick<TweenSpec, "to">,
  hasSprite: boolean,
): string | null {
  return tweenTargetProblem(target, tweenChannels(spec), hasSprite);
}

/**
 * Each entry of `id`'s `tween` block that can't play on `target`: its index
 * and `tween-target-invalid`'s message, which counts entries from 1. The
 * scene validator and the block's attach both check a block through here.
 */
export function tweenBlockProblems(
  id: string,
  tweens: readonly Pick<TweenSpec, "to">[],
  target: TweenTarget,
  hasSprite: boolean,
): { index: number; message: string }[] {
  const out: { index: number; message: string }[] = [];
  tweens.forEach((spec, index) => {
    const problem = tweenProblem(target, spec, hasSprite);
    if (problem) out.push({ index, message: `${id}'s tween ${index + 1} can't play: ${problem}` });
  });
  return out;
}

/** A tween's channels; an unset one reads `placeholder` in the inspector. */
const channels = (description: string, placeholder: string) =>
  z
    .strictObject({
      x: z
        .number()
        .optional()
        .describe("x, m: world, or in the parent's frame for a child.")
        .meta({ unit: "m", placeholder }),
      y: z
        .number()
        .optional()
        .describe("y, m: world, or in the parent's frame for a child.")
        .meta({ unit: "m", placeholder }),
      rot: z
        .number()
        .optional()
        .describe("Rotation, radians: world, or in the parent's frame for a child.")
        .meta({ unit: "rad", placeholder }),
      alpha: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("The sprite's opacity, 0–1.")
        .meta({ placeholder }),
      tint: rgbSchema
        .optional()
        .describe("The sprite's tint, 0xRRGGBB, lerped per channel.")
        .meta({ widget: "color", placeholder }),
      scale: z
        .number()
        .positive()
        .optional()
        .describe("Multiplies the sprite's drawn size; 1 draws it as its block sizes it.")
        .meta({ placeholder }),
    })
    .describe(description);

/** One tween as data: what a `tween` block lists and `ctx.tweens.to` takes. */
export const tweenSpecSchema = z
  .strictObject({
    to: channels("Values to reach.", "not animated"),
    from: channels("Values to start from; default the current ones.", "current").optional(),
    duration: delayField("How long one play takes.", 1),
    ease: z
      .enum(EASE_NAMES as readonly [EaseName, ...EaseName[]])
      .optional()
      .describe("Default linear.")
      .meta({ default: "linear", options: EASE_OPTIONS }),
    delay: delayField("Wait before the first play; default none.", 0)
      .optional()
      .meta({ default: 0 }),
    repeat: z
      .number()
      .int()
      .min(-1)
      .optional()
      .describe("Extra plays after the first; -1 forever. Default 0.")
      .meta({ default: 0, named: { "-1": "forever" } }),
    yoyo: z
      .boolean()
      .optional()
      .describe("Every other play runs backwards.")
      .meta({ default: false }),
    emit: z
      .strictObject({
        type: z
          .string()
          .min(1)
          .optional()
          .describe("The step event's type; default `tween:end`.")
          .meta({ default: "tween:end" }),
        data: z
          .unknown()
          .optional()
          .describe("Plain JSON the event carries.")
          .meta({ widget: "json" }),
      })
      .optional()
      .describe(
        "Raised as a step event when the tween finishes; without one, `tween:end` carries its id and key.",
      ),
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

/** What `getBehavior(TWEEN)` adds beside `fields`. */
export type TweenHandle = Bound<Tweens, "to" | "cancelAll">;

export const TWEEN = defineBehavior({
  name: "tween",
  handle: handleType<TweenHandle>(),
  description:
    "Plays tweens on this entity from spawn: bobbing pickups, swinging signs, pulsing lights.",
  fields: tweenFields,
  template: { tweens: [{ to: { rot: 6.2832 }, duration: 120, repeat: -1 }] },
  inspector: { category: "visual", label: "Tween" },
});

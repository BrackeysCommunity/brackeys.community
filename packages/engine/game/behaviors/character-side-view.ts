/**
 * The `character-side-view` behavior's schema: run and jump under gravity.
 * Zod only; the system lives in `runtime/behaviors/character-side-view.ts`.
 */
import { z } from "zod";

import { defineBehavior, handleType } from "../behaviors";
import type { CharacterHandle } from "./character-top-down";
import { characterMovementFields } from "./character-top-down";
import { actionField } from "./player-input";

const number = (
  title: string,
  fallback: number,
  unit: string | null,
  group: string,
  description: string,
) =>
  z
    .number()
    .min(0)
    .default(fallback)
    .describe(`${description} Default ${fallback}.`)
    .meta({ title, group, ...(unit ? { unit } : {}) });

const characterSideViewFields = {
  ...characterMovementFields({ maxSpeed: 6, accel: 60, decel: 70, pushDynamic: true }),
  airControl: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .describe("The share of accel and decel it has in the air, 0–1. Default 0.6.")
    .meta({ title: "Air control", group: "movement" }),
  jumpHeight: number("Jump height", 1.2, "m", "jump", "How high a full jump rises, m."),
  gravityScale: z
    .number()
    .default(1)
    .describe("Multiplies the world's gravity on it: 0 floats. Default 1.")
    .meta({ title: "Gravity scale", group: "jump" }),
  maxFallSpeed: z
    .number()
    .positive()
    .default(15)
    .describe("The fastest it falls, m/s. Default 15.")
    .meta({ title: "Max fall speed", unit: "m/s", group: "jump" }),
  coyoteMs: number(
    "Coyote time",
    100,
    "ms",
    "jump",
    "How long after running off a ledge a jump still works, ms.",
  ),
  jumpBufferMs: number(
    "Jump buffer",
    100,
    "ms",
    "jump",
    "How long before landing a jump press is kept for the landing, ms.",
  ),
  jumpCut: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe(
      "The share of its upward speed kept when the jump is released early, 0–1: 1 makes every jump full height. Default 0.5.",
    )
    .meta({ title: "Jump cut", group: "jump" }),
  maxSlopeDeg: z
    .number()
    .min(0)
    .max(90)
    .default(50)
    .describe("The steepest slope it walks up, degrees. Default 50.")
    .meta({ title: "Max slope", unit: "deg", group: "ground" }),
  stepHeight: number(
    "Step height",
    0.04,
    "m",
    "ground",
    "The tallest step it climbs without jumping, m; 0 climbs none.",
  ),
  snapToGround: number(
    "Snap to ground",
    0.04,
    "m",
    "ground",
    "How far down it sticks to the ground over bumps and down slopes, m; 0 never snaps.",
  ),
  move: actionField("move", "The action it runs by: a vector's x, or an axis."),
  jump: actionField("jump", "The button it jumps with."),
};

/** A `character-side-view` block as an entity carries it, defaults applied. */
export type CharacterSideViewBlock = z.infer<z.ZodObject<typeof characterSideViewFields>>;

export const CHARACTER_SIDE_VIEW = defineBehavior({
  name: "character-side-view",
  handle: handleType<CharacterHandle>(),
  description:
    "Runs and jumps the entity under gravity from its seat's move and jump actions or an intent from code, with coyote time, jump buffering and one-way platforms.",
  fields: characterSideViewFields,
  requires: ["collider"],
  conflicts: ["character-top-down", "nav-agent", "path-follow"],
  inspector: {
    category: "movement",
    label: "Character (side view)",
    order: [
      "maxSpeed",
      "accel",
      "decel",
      "airControl",
      "jumpHeight",
      "gravityScale",
      "maxFallSpeed",
      "coyoteMs",
      "jumpBufferMs",
      "jumpCut",
      "maxSlopeDeg",
      "stepHeight",
      "snapToGround",
      "pushDynamic",
      "move",
      "jump",
    ],
  },
});

/**
 * The `character-top-down` behavior's schema and the system interface both
 * characters share. Zod only; the system lives in
 * `runtime/behaviors/character-top-down.ts`.
 */
import { z } from "zod";

import type { Vec2 } from "../../types";
import {
  bindTo,
  type BehaviorBlock,
  type BehaviorSystem,
  type Bound,
  defineBehavior,
  handleType,
} from "../behaviors";
import { actionField } from "./player-input";

/** What a character is asked to do this tick when no seat drives it. */
export type CharacterIntent = {
  /** Unit disc; a side-view character reads only `x`. */
  move: Vec2;
  /** Side view: held to jump, released early for a lower one. */
  jump?: boolean;
};

/** Both character behaviors' systems. */
export type CharacterSystem<B extends BehaviorBlock = BehaviorBlock> = BehaviorSystem<B> & {
  /** Drives an entity that carries no `player-input`, from this tick until the next call. */
  setIntent(entityId: string, intent: CharacterIntent): void;
  /** m/s. */
  velocity(entityId: string): Vec2;
  /** Standing on something; a top-down character always is. */
  grounded(entityId: string): boolean;
  /** Sets its velocity at once, m/s: a bounce pad, a knockback. */
  launch(entityId: string, velocity: Vec2): void;
};

const speed = (title: string, fallback: number, description: string) =>
  z
    .number()
    .positive()
    .default(fallback)
    .describe(`${description} Default ${fallback}.`)
    .meta({ title, unit: "m/s", group: "movement" });

const rate = (title: string, fallback: number, description: string) =>
  z
    .number()
    .positive()
    .default(fallback)
    .describe(`${description} Default ${fallback}.`)
    .meta({ title, unit: "m/s²", group: "movement" });

/** The speed, acceleration and push fields both characters share, with each one's defaults. */
export function characterMovementFields(defaults: {
  maxSpeed: number;
  accel: number;
  decel: number;
  pushDynamic: boolean;
}) {
  return {
    maxSpeed: speed("Max speed", defaults.maxSpeed, "Top speed under full input, m/s."),
    accel: rate("Acceleration", defaults.accel, "How fast it speeds up toward max speed, m/s²."),
    decel: rate("Deceleration", defaults.decel, "How fast it slows to rest with no input, m/s²."),
    pushDynamic: z
      .boolean()
      .default(defaults.pushDynamic)
      .describe(`Whether it pushes dynamic bodies it runs into. Default ${defaults.pushDynamic}.`)
      .meta({ title: "Push bodies", group: "movement" }),
  };
}

const characterTopDownFields = {
  ...characterMovementFields({ maxSpeed: 4, accel: 40, decel: 40, pushDynamic: false }),
  move: actionField("move", "The vector action it walks by."),
};

/** A `character-top-down` block as an entity carries it, defaults applied. */
export type CharacterTopDownBlock = z.infer<z.ZodObject<typeof characterTopDownFields>>;

/** What `getBehavior` adds beside `fields` for either character behavior. */
export type CharacterHandle = Bound<
  CharacterSystem,
  "grounded" | "launch" | "setIntent" | "velocity"
>;

/** Either character behavior's `handle(id)`. */
export function characterHandle(system: CharacterSystem, id: string): CharacterHandle {
  return bindTo(system, id, ["grounded", "launch", "setIntent", "velocity"]);
}

/** A character moves itself, so a pose written to it teleports its motion body. */
export function characterPoseHooks(
  characters: ReadonlyMap<
    string,
    { body: { teleport(x: number, y: number, opts: { snap: boolean }): void } }
  >,
): Required<Pick<BehaviorSystem, "posed" | "selfMoving">> {
  return {
    posed(id, pose, snap) {
      characters.get(id)?.body.teleport(pose.x, pose.y, { snap });
    },
    selfMoving: (id) => characters.has(id),
  };
}

export const CHARACTER_TOP_DOWN = defineBehavior({
  name: "character-top-down",
  handle: handleType<CharacterHandle>(),
  description:
    "Walks the entity in the plane from its seat's move action or an intent from code: a kinematic controller stopped and slid along by walls.",
  fields: characterTopDownFields,
  requires: ["collider"],
  conflicts: ["character-side-view", "nav-agent", "path-follow"],
  inspector: {
    category: "movement",
    label: "Character (top-down)",
    order: ["maxSpeed", "accel", "decel", "pushDynamic", "move"],
  },
});

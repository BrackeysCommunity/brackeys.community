/**
 * The `player-input` behavior's schema: binds an entity to an input seat,
 * which `inputFor` reads. Zod only; the system lives in
 * `runtime/behaviors/player-input.ts`.
 */
import { z } from "zod";

import { defineBehavior } from "../behaviors";

/** The most seats a game can have; seat indices are 0 to one less. */
const MAX_SEATS = 8;

/** A seat index field: 0 is the first player. */
export function seatField(description: string) {
  return z
    .number()
    .int()
    .min(0)
    .max(MAX_SEATS - 1)
    .describe(description)
    .meta({ title: "Seat" });
}

/** A field naming one of the game's actions, by default `fallback`. */
export function actionField(fallback: string, description: string) {
  return z
    .string()
    .min(1)
    .default(fallback)
    .describe(`${description} Default "${fallback}".`)
    .meta({
      title: `${fallback.charAt(0).toUpperCase()}${fallback.slice(1)} action`,
      group: "input",
      widget: "action",
    });
}

const playerInputFields = {
  seat: seatField("The seat whose input drives this entity: 0 is the first player.").default(0),
};

/** A `player-input` block as an entity carries it, defaults applied. */
export type PlayerInputBlock = z.infer<z.ZodObject<typeof playerInputFields>>;

export const PLAYER_INPUT = defineBehavior({
  name: "player-input",
  description:
    "Binds the entity to an input seat: behaviors on it read that player's actions through inputFor.",
  fields: playerInputFields,
  inspector: { label: "Player input", order: ["seat"] },
});

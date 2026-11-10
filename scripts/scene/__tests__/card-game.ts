import type { RigidBody } from "@dimforge/rapier2d";
import {
  defineBehavior,
  defineEntityType,
  defineGame,
  gridField,
  pointField,
} from "@jams/engine/game";
import { z } from "zod";

export const CARD_TABLE = "card";
export const CARD_SPEED = 300;

/** A data-only behavior: a glow color game code reads. */
export const GLOW = defineBehavior({
  name: "card-game/glow",
  description: "A colored glow around the entity.",
  fields: {
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .default("#ffcc00")
      .describe("The glow's color, #rrggbb; default #ffcc00."),
  },
});

/** A behavior that only makes sense on an entity that glows. */
export const FLICKER = defineBehavior({
  name: "card-game/flicker",
  description: "Flickers the entity's glow.",
  fields: { rate: z.number().positive().default(4).describe("Flickers per second; default 4.") },
  requires: [GLOW.name],
});

/** Cells painted on the scene's grid, local to `at`; carries no behaviors. */
export const TILES = defineEntityType({
  type: "tiles",
  description: "Floor tiles on the scene's grid.",
  base: "marker",
  fields: {
    at: pointField("The grid's origin."),
    cells: gridField("The tiles.", { values: ["grass", "water", "stone"] }),
  },
  behaviors: { forbidden: "all" },
});

/** A marker that always glows. */
export const LAMP = defineEntityType({
  type: "lamp",
  description: "A light that always glows.",
  base: "marker",
  fields: { at: pointField("Where the lamp stands.") },
  behaviors: { required: { [GLOW.name]: {} } },
});

/**
 * A game for tests of project data and of format features no repo game
 * uses: the prop `avatar` walks at the project's `avatarSpeed`, and the
 * first step raises a `card` event per row of its card table. It has a grid
 * type (`tiles`), a type with a required behavior (`lamp`) and a behavior
 * that requires another (`card-game/flicker`).
 */
export const cardGame = defineGame({
  id: "card-game",
  types: [TILES, LAMP],
  behaviors: [GLOW, FLICKER],
  actions: [
    { action: "left", keys: ["a"], description: "Walk left." },
    { action: "right", keys: ["d"], description: "Walk right." },
  ],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  tables: {
    [CARD_TABLE]: {
      description: "Cards a deck holds.",
      row: {
        cost: z.number().int().min(0).describe("What playing it costs."),
        damage: z.number().int().min(0).default(0).describe("What it deals; default 0."),
      },
    },
  },
  projectSettings: {
    avatarSpeed: z
      .number()
      .positive()
      .default(CARD_SPEED)
      .describe(`The avatar's walking speed, px/s; default ${CARD_SPEED}.`),
  },
  play: {
    focus: (s) => (s as { position: { x: number; y: number } } | null)?.position ?? null,
    movementActions: ["left", "right"],
  },
  createRuntime(ctx) {
    const held = new Set<string>();
    const speed = (ctx.project?.settings.avatarSpeed as number | undefined) ?? CARD_SPEED;
    let avatar: RigidBody | null = null;
    let dealt = false;
    return {
      onLoad() {
        const [handle] = ctx.tags.handlesOf("avatar");
        avatar =
          handle === undefined ? null : (ctx.physics!.world.getCollider(handle)?.parent() ?? null);
        avatar?.lockRotations(true, true);
      },
      beforeStep(_dt, actions) {
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        if (!avatar) return;
        const dir = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
        avatar.setLinvel({ x: dir * speed, y: avatar.linvel().y }, true);
      },
      afterStep() {
        if (dealt) return;
        dealt = true;
        for (const row of ctx.project?.table(CARD_TABLE) ?? [])
          ctx.emit({ type: "card", entityId: row.id, at: { x: 0, y: 0 } });
      },
      snapshot() {
        if (!avatar) return null;
        const { x, y } = avatar.translation();
        return { position: { x, y } };
      },
    };
  },
});

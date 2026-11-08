import type { RigidBody } from "@dimforge/rapier2d";
import { defineGame } from "@jams/engine/game";
import { z } from "zod";

export const CARD_TABLE = "card";
export const CARD_SPEED = 300;

/**
 * A game for tests of project data: the prop `avatar` walks at the
 * project's `avatarSpeed`, and the first step raises a `card` event per row
 * of its card table.
 */
export const cardGame = defineGame({
  id: "card-game",
  types: [],
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
          handle === undefined ? null : (ctx.physics.world.getCollider(handle)?.parent() ?? null);
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

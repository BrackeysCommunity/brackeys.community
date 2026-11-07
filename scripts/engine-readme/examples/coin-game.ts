import { defineEntityType, defineGame, primitiveFields, SENSOR_ENTER } from "@jams/engine/game";
import { z } from "zod";

/** A coin is a sensor with a value; anything entering it collects it. */
const coin = defineEntityType({
  type: "coin",
  description: "A coin: collected when something enters it.",
  base: "sensor",
  fields: (env) => ({
    ...primitiveFields("sensor", env),
    value: z.number().int().positive().default(1).describe("Points the coin is worth."),
  }),
  style: { fill: 0xffd700, stroke: 0xffd700 },
});

export type CoinSnapshot = { score: number; left: number };

export const coinGame = defineGame<CoinSnapshot>({
  id: "coin-game",
  types: [coin],
  actions: [
    { action: "left", keys: ["a", "arrowleft"], description: "Walk left." },
    { action: "right", keys: ["d", "arrowright"], description: "Walk right." },
  ],
  // Props (the engine's dynamic group) don't touch sensors unless a game says so.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  createRuntime() {
    const values = new Map<string, number>();
    let score = 0;
    return {
      onLoad(scene) {
        score = 0;
        values.clear();
        for (const e of scene.entities) {
          if (e.type === "coin") values.set(e.id, Number(e.value));
        }
      },
      afterStep(_dtMs, events) {
        for (const event of events) {
          const value = event.type === SENSOR_ENTER && values.get(event.entityId ?? "");
          if (!value) continue;
          score += value;
          values.delete(event.entityId!);
        }
      },
      snapshot: () => ({ score, left: values.size }),
    };
  },
  play: {
    results: ["won"],
    // After every tick; a result ends a playtest, null keeps it going.
    outcome: ({ snapshot }) => (snapshot.left === 0 ? { result: "won" } : null),
  },
});

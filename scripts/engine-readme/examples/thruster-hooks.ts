import { BODY, defineScript } from "@jams/engine/game";
import { z } from "zod";

/** The thruster as a function script: `create` runs once per ship and returns its hooks. */
export const thruster = defineScript({
  name: "thruster-game/thruster",
  description: "Pushes the entity's dynamic body along its seat's move action.",
  fields: {
    force: z.number().positive().default(2).describe("Force at full stick, N; default 2."),
  },
  requires: ["body"],
  create(self) {
    return {
      // Before the physics step, which takes the force and drops it after.
      beforeStep() {
        const move = self.input.vector("move");
        if (move.x === 0 && move.y === 0) return;
        const { force } = self.fields;
        self.entity.getBehavior(BODY)!.applyForce({ x: move.x * force, y: move.y * force });
      },
    };
  },
});

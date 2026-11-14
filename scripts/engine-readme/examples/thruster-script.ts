import { BODY, Script } from "@jams/engine/game";
import { z } from "zod";

/** The thruster as a script class: one instance per ship, pushing its body along its seat's move action. */
export class Thruster extends Script({
  name: "thruster-game/thruster",
  description: "Pushes the entity's dynamic body along its seat's move action.",
  fields: {
    force: z.number().positive().default(2).describe("Force at full stick, N; default 2."),
  },
  requires: ["body"],
}) {
  // Before the physics step, which takes the force and drops it after.
  beforeStep() {
    const move = this.input.vector("move");
    if (move.x === 0 && move.y === 0) return;
    const { force } = this.fields;
    this.entity.getBehavior(BODY)!.applyForce({ x: move.x * force, y: move.y * force });
  }
}

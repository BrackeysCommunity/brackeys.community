import { createMotionBody, defineBehavior, inputFor, type MotionBody } from "@jams/engine/game";
import { z } from "zod";

/** A controller of the game's own: a motion body its seat's move action walks at one speed. */
export const stroll = defineBehavior({
  name: "stroll-game/stroll",
  description: "Walks the entity at one speed from its seat's move action.",
  fields: { speed: z.number().positive().default(3).describe("Walking speed, m/s; default 3.") },
  system(ctx) {
    const walkers = new Map<string, { body: MotionBody; speed: number }>();
    const circle = { type: "circle", cx: 0, cy: 0, r: 0.2 } as const;
    return {
      attach(id, block) {
        const at = ctx.poses.get(id) ?? { x: 0, y: 0 };
        const body = createMotionBody(ctx, ctx.get(id)!, at, { shape: circle });
        walkers.set(id, { body, speed: Number(block.speed) });
      },
      detach(id) {
        walkers.get(id)?.body.destroy();
        walkers.delete(id);
      },
      // After the game's beforeStep and before the physics step.
      beforeStep(dtMs) {
        for (const [id, { body, speed }] of walkers) {
          const move = inputFor(ctx, id).vector("move");
          const d = (speed * dtMs) / 1000;
          body.move({ x: move.x * d, y: move.y * d });
        }
      },
      clear() {
        for (const { body } of walkers.values()) body.destroy();
        walkers.clear();
      },
      size: () => walkers.size,
    };
  },
});

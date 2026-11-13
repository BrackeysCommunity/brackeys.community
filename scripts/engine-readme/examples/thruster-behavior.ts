import {
  defineBehavior,
  defineGame,
  inputFor,
  type BehaviorSystem,
  type EngineContext,
} from "@jams/engine/game";
import { z } from "zod";

/** The thruster's system, with the ships it pushes in attach order. */
export type ThrusterSystem = BehaviorSystem & { ships(): readonly string[] };

/** Pushes a dynamic body along its seat's move action: physics movement, no character. */
export const thruster = defineBehavior({
  name: "thruster-game/thruster",
  description: "Pushes the entity's dynamic body along its seat's move action.",
  fields: {
    force: z.number().positive().default(2).describe("Force at full stick, N; default 2."),
  },
  requires: ["body"],
  system(ctx): ThrusterSystem {
    const force = new Map<string, number>();
    return {
      attach(id, block) {
        force.set(id, Number(block.force));
      },
      detach(id) {
        force.delete(id);
      },
      // Before the physics step, which takes the force and drops it after.
      beforeStep() {
        for (const [id, f] of force) {
          const move = inputFor(ctx, id).vector("move");
          if (move.x !== 0 || move.y !== 0)
            ctx.bodies.applyForce(id, { x: move.x * f, y: move.y * f });
        }
      },
      clear() {
        force.clear();
      },
      size: () => force.size,
      ships: () => [...force.keys()],
    };
  },
});

export type ThrusterSnapshot = {
  ships: { id: string; at: [number, number]; v: [number, number] }[];
};

export const thrusterGame = defineGame<ThrusterSnapshot>({
  id: "thruster-game",
  types: [],
  behaviors: [thruster],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [
        { device: "pad", stick: "left" },
        { device: "key", code: "ArrowLeft", axis: "x", value: -1 },
        { device: "key", code: "ArrowRight", axis: "x" },
        { device: "key", code: "ArrowUp", axis: "y", value: -1 },
        { device: "key", code: "ArrowDown", axis: "y" },
      ],
      description: "Thrust.",
    },
  ],
  world: { gravity: [0, 0] },
  // Dynamic bodies overlap sensors, so a force area over a ship pushes it too.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  createRuntime(ctx: EngineContext) {
    return {
      snapshot() {
        const ships = ctx.behavior<ThrusterSystem>(thruster.name)?.ships() ?? [];
        return {
          ships: ships.map((id) => {
            const p = ctx.poses.get(id);
            const v = ctx.bodies.velocity(id);
            return { id, at: [p?.x ?? 0, p?.y ?? 0], v: [v.x, v.y] };
          }),
        };
      },
    };
  },
});

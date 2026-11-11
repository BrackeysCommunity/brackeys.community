import type { RigidBody } from "@dimforge/rapier2d";
import {
  createRegistry,
  defineEntityType,
  defineGame,
  physicsOf,
  pointField,
} from "@jams/engine/game";
import { validateScene, type Pt, type SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

/** A balloon floats up: a Rapier body with a negative gravity scale, so it needs physics. */
export const balloon = defineEntityType({
  type: "balloon",
  description: "A balloon that floats up.",
  physics: "required",
  fields: {
    at: pointField("Where it starts."),
    lift: z
      .number()
      .positive()
      .default(0.3)
      .describe("How strongly it rises, as a share of gravity."),
  },
  style: { fill: 0xff6688, stroke: 0xff6688 },
  system(ctx, type) {
    const bodies = new Map<string, RigidBody>();
    return {
      spawn(e) {
        // Throws PhysicsRequiredError in a scene with physics "none"; the load reports it.
        const { rapier, physics } = physicsOf(ctx, type.type, e.id);
        const [x, y] = e.at as Pt;
        const body = physics.addRigidBody(
          rapier.RigidBodyDesc.dynamic().setTranslation(x, y).setGravityScale(-Number(e.lift)),
        );
        const desc = rapier.ColliderDesc.ball(0.1);
        desc.setCollisionGroups(ctx.registry.collisionGroups("dynamic"));
        ctx.tags.set(physics.addCollider(desc, body).handle, { entityId: e.id, type: type.type });
        ctx.poses.set(e.id, x, y, 0, { snap: true });
        bodies.set(e.id, body);
      },
      despawn(id) {
        const body = bodies.get(id);
        if (!body) return;
        for (let i = 0; i < body.numColliders(); i++) ctx.tags.delete(body.collider(i).handle);
        physicsOf(ctx, type.type, id).physics.removeRigidBody(body);
        bodies.delete(id);
      },
      clear() {
        for (const id of [...bodies.keys()]) this.despawn(id);
      },
      afterStep() {
        for (const [id, body] of bodies) {
          const p = body.translation();
          ctx.poses.set(id, p.x, p.y, body.rotation());
        }
      },
      size: () => bodies.size,
    };
  },
});

const party = defineGame({
  id: "party",
  types: [balloon],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(party);

/** The codes a physics-free scene with a balloon gets: `physics-required`, before anything loads. */
export function balloonIssues(): string[] {
  const scene: SceneDefinition = {
    v: 4,
    game: "party",
    name: "party",
    bounds: [0, 0, 4, 3],
    settings: { physics: "none" },
    entities: [{ id: "red", type: "balloon", at: [2, 2.5] }],
  };
  return validateScene(scene, registry).map((i) => i.code);
}

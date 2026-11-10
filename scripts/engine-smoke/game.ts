import type { RigidBody } from "@dimforge/rapier2d";
import { defineGame, SENSOR_ENTER, type EngineContext } from "@jams/engine/game";

export type SmokeSnapshot = { x: number; y: number; vx: number; vy: number } | null;

function avatarBody(ctx: EngineContext): RigidBody | null {
  const [handle] = ctx.tags.handlesOf("avatar");
  if (handle === undefined) return null;
  return ctx.physics?.world.getCollider(handle)?.parent() ?? null;
}

/**
 * A minimal game written only against `@jams/engine/game`: the prop `avatar`
 * walks with `left`/`right` and is shoved up on `push`, and wins when it
 * enters a sensor.
 */
export const smokeGame = defineGame<SmokeSnapshot>({
  id: "smoke-game",
  types: [],
  actions: [
    { action: "left", keys: ["a"], description: "Walk left." },
    { action: "right", keys: ["d"], description: "Walk right." },
    { action: "push", keys: ["space"], description: "Push the avatar up." },
  ],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  play: {
    focus: (s) => (s ? { x: s.x, y: s.y } : null),
    movementActions: ["left", "right"],
    results: ["won"],
    outcome: ({ events }) => {
      const hit = events.find((e) => e.type === SENSOR_ENTER && e.other === "avatar");
      return hit ? { result: "won", entityId: hit.entityId } : null;
    },
  },
  createRuntime(ctx) {
    const held = new Set<string>();
    let avatar: RigidBody | null = null;
    return {
      onLoad() {
        avatar = avatarBody(ctx);
        avatar?.lockRotations(true, true);
      },
      onUnload() {
        avatar = null;
        held.clear();
      },
      beforeStep(_dtMs, actions) {
        const pushed = actions.some((a) => a.action === "push" && a.pressed);
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        if (!avatar) return;
        const dir = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
        avatar.setLinvel({ x: dir * 300, y: avatar.linvel().y }, true);
        if (pushed) avatar.applyImpulse({ x: 0, y: -400 * avatar.mass() }, true);
      },
      snapshot() {
        if (!avatar) return null;
        const p = avatar.translation();
        const v = avatar.linvel();
        return { x: p.x, y: p.y, vx: v.x, vy: v.y };
      },
    };
  },
});

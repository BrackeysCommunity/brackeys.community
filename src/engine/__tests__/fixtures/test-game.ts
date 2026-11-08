import type { RigidBody } from "@dimforge/rapier2d";
import { z } from "zod";

import { defineGame } from "../../game/define";
import type { EngineContext } from "../../game/types";
import { SENSOR_ENTER } from "../../runtime/types";
import { makeIssue } from "../../scene/issues";
import { aabb } from "../../scene/shape-geometry";
import type { ShapeObj } from "../../scene/types";
import type { Vec2 } from "../../types";

export type TestGameSnapshot = { position: Vec2; velocity: Vec2 } | null;
export type TestGameOptions = { push?: boolean };

/** The event the test game raises when the avatar enters a sensor tagged `goal`. */
export const GOAL_EVENT = "goal";

export const AVATAR_SPEED = 300;

/** The test game's physical check: something under the avatar. */
export const AVATAR_FLOATING = "test-game/avatar-floating";
export const PUSH_IMPULSE = 400;

/** The test game's data table: cards with a cost and an optional damage. */
export const CARD_TABLE = "card";

function avatarBody(ctx: EngineContext): RigidBody | null {
  const [handle] = ctx.tags.handlesOf("avatar");
  if (handle === undefined) return null;
  return ctx.physics.world.getCollider(handle)?.parent() ?? null;
}

/**
 * A minimal game for engine tests: the prop `avatar` walks left and right and
 * pushes up, and wins on entering a sensor tagged `goal`. It implements every
 * play hook, has a data table, and walks at its project's `avatarSpeed`.
 */
export const testGame = defineGame<TestGameSnapshot, TestGameOptions>({
  id: "test-game",
  types: [],
  actions: [
    { action: "left", keys: ["a"], description: "Walk left." },
    { action: "right", keys: ["d"], description: "Walk right." },
    { action: "push", keys: ["space"], description: "Push the avatar up." },
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
      .default(AVATAR_SPEED)
      .describe(`The avatar's walking speed, px/s; default ${AVATAR_SPEED}.`),
    title: z.string().optional().describe("A name shown nowhere; tests read it back."),
  },
  editorKeys: [{ key: "1", scope: "edit", command: "test:one", description: "A game command." }],
  play: {
    spawnShape: { type: "box", hw: 20, hh: 20 },
    focus: (snap) => snap?.position ?? null,
    movementActions: ["left", "right"],
    results: ["won"],
    outcome({ events }) {
      const goal = events.find((e) => e.type === GOAL_EVENT);
      return goal ? { result: "won", cause: "reached the goal", entityId: goal.entityId } : null;
    },
    predicates: {
      past: {
        description: "The avatar's x is at least this.",
        arg: z.number(),
        test: (arg, { snapshot }) => (snapshot?.position.x ?? -Infinity) >= (arg as number),
      },
    },
    macro: (rng) => ({
      hold: rng.below(4) === 0 ? ["right", "push"] : [rng.pick(["right", "right", "left"])],
      ticks: rng.range(10, 40),
    }),
    options: z.object({
      push: z.boolean().optional().describe("False turns the push action off."),
    }),
  },
  createRuntime(ctx) {
    const held = new Set<string>();
    let avatar: RigidBody | null = null;
    let goals = new Set<string>();
    const speed = (ctx.project?.settings.avatarSpeed as number | undefined) ?? AVATAR_SPEED;

    return {
      onLoad(scene) {
        avatar = avatarBody(ctx);
        avatar?.lockRotations(true, true);
        const at = ctx.play?.at;
        if (avatar && at) avatar.setTranslation(at, true);
        goals = new Set(
          scene.entities
            .filter(
              (e) => e.type === "sensor" && (e.tags as string[] | undefined)?.includes("goal"),
            )
            .map((e) => e.id),
        );
      },
      onUnload() {
        avatar = null;
        held.clear();
        goals.clear();
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type === SENSOR_ENTER && e.other === "avatar" && goals.has(e.entityId!)) {
            ctx.emit({ type: GOAL_EVENT, entityId: e.entityId, at: e.at });
          }
        }
      },
      beforeStep(_dtMs, actions) {
        const options = (ctx.play?.game ?? {}) as TestGameOptions;
        const pushed =
          options.push !== false && actions.some((a) => a.action === "push" && a.pressed);
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        if (!avatar) return;
        const dir = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
        const v = avatar.linvel();
        avatar.setLinvel({ x: dir * speed, y: v.y }, true);
        if (pushed) avatar.applyImpulse({ x: 0, y: -PUSH_IMPULSE * avatar.mass() }, true);
      },
      snapshot() {
        if (!avatar) return null;
        const p = avatar.translation();
        const v = avatar.linvel();
        return { position: { x: p.x, y: p.y }, velocity: { x: v.x, y: v.y } };
      },
    };
  },
});

/** The test game with a physical check, its issue code and a `.checks.json` kind. */
export const checkedTestGame = defineGame<TestGameSnapshot, TestGameOptions>({
  ...testGame,
  issues: {
    [AVATAR_FLOATING]: {
      severity: "warn",
      summary: "Nothing is under the avatar.",
      hint: "Put a solid under the avatar.",
      fixable: false,
    },
  },
  physicalChecks: [
    {
      id: "avatar",
      description: "Something is under the avatar.",
      run(env) {
        const avatar = env.scene.entities.find((e) => e.id === "avatar");
        if (!avatar) return [];
        const shape = avatar.shape as ShapeObj;
        const fall = env.def.bounds[3] - aabb(shape).maxY;
        if (fall <= 0 || env.cast(shape, { x: 0, y: fall }, { exclude: ["avatar"] })) return [];
        return [
          makeIssue(
            AVATAR_FLOATING,
            { message: "nothing is under avatar", path: "", entityIds: ["avatar"] },
            env.registry.issueCodes,
          ),
        ];
      },
    },
  ],
  checks: {
    "test-game/props": {
      description: "The scene has at least this many props.",
      arg: z.strictObject({
        atLeast: z.number().int().min(0).describe("The fewest props that pass."),
      }),
      run(arg, env) {
        const { atLeast } = arg as { atLeast: number };
        const n = (env.def.entities ?? []).filter((e) => e.type === "prop").length;
        return { pass: n >= atLeast, message: `${n} props`, detail: { props: n } };
      },
    },
  },
});

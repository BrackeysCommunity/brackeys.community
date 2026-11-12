import type { RigidBody } from "@dimforge/rapier2d";
import { z } from "zod";

import { defineBehavior, type BehaviorSystem } from "../../game/behaviors";
import { defineEntityType, defineGame } from "../../game/define";
import { gridField, pointField } from "../../game/fields";
import { primitiveFields } from "../../game/primitives";
import type { EngineContext } from "../../game/types";
import { SENSOR_ENTER } from "../../runtime/types";
import { makeIssue } from "../../scene/issues";
import { DEFAULT_LAYERS } from "../../scene/layers";
import { aabb } from "../../scene/shape-geometry";
import type { ShapeObj } from "../../scene/types";
import { createSolidSystem } from "../../systems/bodies";
import type { Vec2 } from "../../types";

export type TestGameSnapshot = { position: Vec2; velocity: Vec2 } | null;
export type TestGameOptions = { push?: boolean };

/** The event the test game raises when the avatar enters a sensor tagged `goal`. */
export const GOAL_EVENT = "goal";

/** m/s. */
export const AVATAR_SPEED = 3;

/** The test game's physical check: something under the avatar. */
export const AVATAR_FLOATING = "test-game/avatar-floating";
/** The push's change in velocity, m/s. */
export const PUSH_IMPULSE = 4;

/** The test game's command: moves the avatar `dx` metres along x at once. */
export const NUDGE = "nudge";

/** The test game's data table: cards with a cost and an optional damage. */
export const CARD_TABLE = "card";

/** A data-only behavior: a color and an intensity game code reads. */
export const GLOW = defineBehavior({
  name: "test-game/glow",
  description: "A colored glow around the entity.",
  fields: {
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .default("#ffcc00")
      .describe("The glow's color, #rrggbb; default #ffcc00."),
    intensity: z.number().min(0).default(1).describe("How bright it glows; default 1."),
  },
  inspector: { label: "Glow", order: ["intensity", "color"] },
});

/** The entities the spin behavior's stub system has attached, by id. */
export type SpinSystem = BehaviorSystem & { spinning: Map<string, number> };

/** A behavior with a stub system that records what it attached. */
export const SPIN = defineBehavior({
  name: "test-game/spin",
  description: "Turns the entity at a steady rate.",
  fields: {
    speed: z.number().default(90).describe("Degrees per second; default 90."),
  },
  system: () => {
    const spinning = new Map<string, number>();
    const system: SpinSystem = {
      spinning,
      attach: (id, block) => void spinning.set(id, block.speed as number),
      detach: (id) => void spinning.delete(id),
      clear: () => spinning.clear(),
      size: () => spinning.size,
    };
    return system;
  },
});

/** A marker that always glows, a little brighter than the behavior's default, and spins slowly when it spins. */
export const LAMP = defineEntityType({
  type: "lamp",
  description: "A light that always glows.",
  base: "marker",
  fields: { at: pointField("Where the lamp stands.") },
  behaviors: {
    required: { [GLOW.name]: { intensity: 2 } },
    defaults: { [SPIN.name]: { speed: 30 } },
  },
});

/** A marker that carries no behaviors. */
export const PLAIN = defineEntityType({
  type: "plain",
  description: "A marker that refuses every behavior.",
  base: "marker",
  fields: { at: pointField("Where it stands.") },
  behaviors: { forbidden: "all" },
});

/** A grid of painted cells on the scene's grid, local to `at`. */
export const PAINT = defineEntityType({
  type: "paint",
  description: "Cells painted on the scene's grid.",
  base: "marker",
  fields: {
    at: pointField("The grid's origin."),
    cells: gridField("The painted cells.", { values: ["red", "green", "blue"] }),
  },
});

/** The test game's layers: the engine's four and a parallax backdrop under them. */
export const TEST_LAYERS = [
  {
    name: "backdrop",
    description: "A far backdrop.",
    draw: -5,
    scroll: [0.5, 0.5] as [number, number],
  },
  ...DEFAULT_LAYERS,
];

function avatarBody(ctx: EngineContext): RigidBody | null {
  const [handle] = ctx.tags.handlesOf("avatar");
  if (handle === undefined) return null;
  return ctx.physics!.world.getCollider(handle)?.parent() ?? null;
}

/**
 * A minimal game for engine tests: the prop `avatar` walks left and right and
 * pushes up, and wins on entering a sensor tagged `goal`. It implements every
 * play hook, has a data table and a `nudge` command, and walks at its
 * project's `avatarSpeed`.
 */
export const testGame = defineGame<TestGameSnapshot, TestGameOptions>({
  id: "test-game",
  types: [LAMP, PLAIN, PAINT],
  behaviors: [GLOW, SPIN],
  layers: TEST_LAYERS,
  actions: [
    { action: "left", keys: ["a"], description: "Walk left." },
    { action: "right", keys: ["d"], description: "Walk right." },
    { action: "push", keys: [" "], description: "Push the avatar up." },
  ],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  commands: {
    [NUDGE]: {
      description: "Move the avatar along x at once.",
      args: z.strictObject({
        dx: z
          .number()
          .int()
          .min(-200)
          .max(200)
          .describe("How far, m; negative is left.")
          .meta({ unit: "m" }),
      }),
    },
  },
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
      .describe(`The avatar's walking speed, m/s; default ${AVATAR_SPEED}.`)
      .meta({ unit: "m/s" }),
    title: z.string().optional().describe("A name shown nowhere; tests read it back."),
  },
  editorKeys: [{ key: "1", scope: "edit", command: "test:one", description: "A game command." }],
  play: {
    spawnShape: { type: "box", hw: 0.2, hh: 0.2 },
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
        arg: z.number().describe("x, m.").meta({ unit: "m" }),
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
      beforeStep(_dtMs, actions, commands) {
        const options = (ctx.play?.game ?? {}) as TestGameOptions;
        const pushed =
          options.push !== false && actions.some((a) => a.action === "push" && a.pressed);
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        if (!avatar) return;
        for (const c of commands) {
          if (c.name !== NUDGE) continue;
          const p = avatar.translation();
          avatar.setTranslation({ x: p.x + (c.args as { dx: number }).dx, y: p.y }, true);
        }
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

/** The UI-only action of `uiTestGame`: resolved from devices, never delivered to the simulation. */
export const MENU_ACTION = "menu";

/** A solid its system makes one-way on its bottom face, declared type-wide so renderers draw that side. */
export const CEILING = defineEntityType({
  type: "ceiling",
  description: "A solid actors drop down through and bump from below.",
  base: "solid",
  fields: (env) => primitiveFields("solid", env),
  system: (ctx, type) => createSolidSystem(ctx, type, { oneWay: "down" }),
  oneWay: "down",
});

/** The test game with a UI-only action and a type-wide one-way type. */
export const uiTestGame = defineGame<TestGameSnapshot, TestGameOptions>({
  ...testGame,
  types: [...testGame.types, CEILING],
  actions: [
    ...testGame.actions,
    {
      action: MENU_ACTION,
      ui: true,
      bindings: [{ device: "key", code: "Escape" }],
      description: "Open the pause menu.",
    },
  ],
});

import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { BodyBlock } from "../../game/behaviors/body";
import type {
  CharacterIntent,
  CharacterSystem,
  CharacterTopDownBlock,
} from "../../game/behaviors/character-top-down";
import { COLLIDER, type ColliderBlock, type ColliderSystem } from "../../game/behaviors/collider";
import type { ForceAreaSystem } from "../../game/behaviors/force-area";
import { PLAYER_INPUT } from "../../game/behaviors/player-input";
import { inputFor, type PlayerInputSystem } from "../../game/input-for";
import { EngineError, type EngineContext, type JsonValue } from "../../game/types";
import {
  createMotionBody,
  createTopDownController,
  type MotionBody,
  type MotionResult,
  type TopDownController,
} from "../../motion/index";
import { parseShape } from "../../scene/shapes";
import type { RuntimeEntity } from "../../scene/types";

type Vec = { x: number; y: number };

type Character = {
  entity: RuntimeEntity;
  block: CharacterTopDownBlock;
  body: MotionBody;
  controller: TopDownController;
  /** The last `setIntent`, read when the entity carries no `player-input`. */
  intent: Vec | null;
  disabled: boolean;
};

/** A world save's state beyond what the motion body saves: the last `setIntent`. */
type SavedCharacter = { intent?: [number, number] };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function bodyKindOf(e: RuntimeEntity): string | null {
  const body = e.behaviors?.body as Partial<BodyBlock> | undefined;
  return body ? (body.kind ?? "dynamic") : null;
}

/**
 * The `character-top-down` behavior's system: a kinematic motion body of
 * the entity's collider shape, walked by a top-down controller from its
 * seat's move action, or from `setIntent` when it carries no
 * `player-input`. A force area it stands in adds its acceleration, which
 * its `decel` works against while idle (see `ForceAreaSystem.sample`), and with
 * `pushDynamic` it shoves the dynamic bodies it runs into. The motion body
 * stands in for the collider system's own body, which it takes out of the
 * world while the character is attached. Play from here starts seat 0's
 * character at the chosen point.
 */
export const createCharacterTopDownSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const characters = new Map<string, Character>();
  const colliders = () => ctx.behavior<ColliderSystem>(COLLIDER.name);
  const seats = () => ctx.behavior<PlayerInputSystem>(PLAYER_INPUT.name);
  /** Set by a load; the first tick after it places Play from here's hero. */
  let loaded = false;

  /** Play from here: on a play world's first tick (a restored one is past it), seat 0's first character starts at `ctx.play.at`, at rest. */
  function startAtPlay(): void {
    const at = ctx.play?.at;
    if (!at || ctx.tick !== 0) return;
    for (const [id, c] of characters) {
      if (seats()?.seatOf(id) !== 0) continue;
      c.body.teleport(at.x, at.y);
      c.body.setVelocity({ x: 0, y: 0 });
      return;
    }
  }

  function make(e: RuntimeEntity, at: Vec): MotionBody {
    if (bodyKindOf(e) === "dynamic")
      throw new EngineError(
        "character-body-kind",
        `${e.id} has a character-top-down on a dynamic body: the controller and the physics solver would both move it`,
        e.id,
      );
    const block = e.behaviors?.[COLLIDER.name] as ColliderBlock | undefined;
    if (!block)
      throw new EngineError(
        "behavior-missing",
        `${e.id}'s character-top-down needs a collider`,
        e.id,
      );
    const parsed = parseShape(block.shape, `${e.id}.behaviors.collider.shape`);
    if (!parsed.ok) throw new EngineError("schema", parsed.issue.message, e.id);
    return createMotionBody(ctx, e, at, {
      shape: parsed.shape,
      group: block.group ?? "dynamic",
      ...(block.material !== undefined ? { tag: { material: block.material } } : {}),
    });
  }

  const controllerOf = (body: MotionBody, block: CharacterTopDownBlock) =>
    createTopDownController(body, {
      maxSpeed: block.maxSpeed,
      accel: block.accel,
      decel: block.decel,
    });

  function own(id: string, what: string): Character {
    const c = characters.get(id);
    if (!c) throw new Error(`can't ${what} "${id}": it carries no character-top-down`);
    return c;
  }

  function intentOf(id: string, c: Character): Vec {
    if (seats()?.seatOf(id) != null) return inputFor(ctx, id).vector(c.block.move);
    return c.intent ?? { x: 0, y: 0 };
  }

  /** Each dynamic body it ran into takes the impulse that gives it the character's speed into it. */
  function push(c: Character, result: MotionResult, intent: Vec): void {
    for (const hit of result.hits) {
      const other = hit.tag.entityId;
      if (other === c.entity.id || ctx.bodies.kind(other) !== "dynamic") continue;
      const n = hit.normal;
      const want = Math.min(1, -(intent.x * n.x + intent.y * n.y)) * c.block.maxSpeed;
      if (!(want > 0)) continue;
      const v = ctx.bodies.velocity(other);
      const gap = want + (v.x * n.x + v.y * n.y);
      if (!(gap > 0)) continue;
      const mass = ctx.bodies.mass(other);
      ctx.bodies.applyImpulse(other, { x: -n.x * gap * mass, y: -n.y * gap * mass });
    }
  }

  function attach(id: string, block: CharacterTopDownBlock, e: RuntimeEntity): void {
    detach(id);
    const pose = ctx.poses.get(id);
    const body = make(e, { x: pose?.x ?? 0, y: pose?.y ?? 0 });
    characters.set(id, {
      entity: e,
      block,
      body,
      controller: controllerOf(body, block),
      intent: null,
      disabled: false,
    });
    colliders()?.standIn(id);
  }

  function detach(id: string): void {
    const c = characters.get(id);
    if (!c) return;
    characters.delete(id);
    c.body.destroy();
    if (ctx.exists(id)) colliders()?.release(id);
  }

  const system: CharacterSystem<CharacterTopDownBlock> = {
    attach,
    detach,
    /**
     * Any of the entity's blocks changed: the collider system has rebuilt its
     * own body, so the motion body is made again where it stands, keeping its
     * velocity, and takes back the entity's place in `ctx.bodies`.
     */
    update(id, block, _prev, e) {
      const c = characters.get(id);
      if (!c) return attach(id, block, e);
      c.entity = e;
      c.block = block;
      const at = c.body.position();
      const v = c.body.velocity();
      c.body.destroy();
      c.body = make(e, at);
      c.body.setVelocity(v);
      if (c.disabled) c.body.setEnabled(false);
      c.controller = controllerOf(c.body, block);
    },
    reset() {
      loaded = true;
    },
    beforeStep(dtMs) {
      if (loaded) {
        loaded = false;
        startAtPlay();
      }
      if (characters.size === 0) return;
      const forces = ctx.behavior<ForceAreaSystem>("force-area");
      const dt = dtMs / 1000;
      for (const [id, c] of characters) {
        if (c.disabled) continue;
        if (forces) {
          const a = forces.sample(c.body.position(), id);
          if (a.x !== 0 || a.y !== 0) {
            const v = c.body.velocity();
            c.body.setVelocity({ x: v.x + a.x * dt, y: v.y + a.y * dt });
          }
        }
        const intent = intentOf(id, c);
        const result = c.controller.step(dtMs, intent);
        if (c.block.pushDynamic && result.hits.length > 0) push(c, result, intent);
      }
    },
    disable(id) {
      const c = characters.get(id);
      if (!c || c.disabled) return;
      c.disabled = true;
      c.body.setEnabled(false);
    },
    enable(id) {
      const c = characters.get(id);
      if (!c || !c.disabled) return;
      c.disabled = false;
      c.body.setEnabled(true);
    },
    clear() {
      for (const id of [...characters.keys()]) detach(id);
    },
    size: () => characters.size,
    setIntent(id, intent: CharacterIntent) {
      own(id, "set the intent of").intent = { x: intent.move.x, y: intent.move.y };
    },
    velocity: (id) => characters.get(id)?.body.velocity() ?? { x: 0, y: 0 },
    grounded: (id) => characters.has(id),
    launch(id, v) {
      own(id, "launch").body.setVelocity({ x: v.x, y: v.y });
    },
    handle: (id) => ({
      grounded: () => system.grounded(id),
      launch: (v: Vec) => system.launch(id, v),
      setIntent: (intent: CharacterIntent) => system.setIntent(id, intent),
      velocity: () => system.velocity(id),
    }),
    posed(id, pose, snap) {
      characters.get(id)?.body.teleport(pose.x, pose.y, { snap });
    },
    selfMoving: (id) => characters.has(id),
    save(id): JsonValue | undefined {
      const intent = characters.get(id)?.intent;
      if (!intent) return undefined;
      const saved: SavedCharacter = { intent: [intent.x, intent.y] };
      return saved;
    },
    restore(id, state) {
      const c = characters.get(id);
      if (!c || typeof state !== "object" || state === null || Array.isArray(state)) return;
      const { intent } = state;
      c.intent =
        Array.isArray(intent) && intent.length === 2 && finite(intent[0]) && finite(intent[1])
          ? { x: intent[0], y: intent[1] }
          : null;
    },
  };
  return system as BehaviorSystem;
};

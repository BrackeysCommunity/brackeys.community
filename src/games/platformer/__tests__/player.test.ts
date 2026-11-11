import type { InputAction, RapierModule } from "@jams/engine";
import { createHeadlessRuntime } from "@jams/engine/headless";
import type { ExpandedScene } from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";
import { PLAYER_HEIGHT, PLAYER_TYPE, PLAYER_WIDTH } from "../entities/player";
import {
  computeDesiredMovement,
  deriveMovementState,
  JUMP_VELOCITY,
  JUMP_CUT_MULTIPLIER,
  MOVE_SPEED,
  MAX_FALL_SPEED,
  MOVEMENT_CONFIG,
} from "../entities/player";
import type { PlayerSystem } from "../systems/player";

const GRAVITY = platformerGame.world!.gravity![1];

function makeAction(action: string, pressed = true): InputAction {
  return { action, pressed, tick: 0, timestamp: 0 };
}

/** Helper: call computeDesiredMovement with sensible defaults for grounded tests */
function grounded(
  velocity: { x: number; y: number },
  actions: InputAction[] = [],
  opts: { jumpPressedThisFrame?: boolean; jumpReleasedThisFrame?: boolean } = {},
) {
  const dt = 1 / 60;
  return computeDesiredMovement(
    velocity,
    actions,
    true, // grounded
    true, // canJump
    dt,
    GRAVITY,
    opts.jumpPressedThisFrame ?? false,
    opts.jumpReleasedThisFrame ?? false,
  );
}

/** Helper: call computeDesiredMovement for airborne tests */
function airborne(
  velocity: { x: number; y: number },
  actions: InputAction[] = [],
  opts: { canJump?: boolean; jumpPressedThisFrame?: boolean; jumpReleasedThisFrame?: boolean } = {},
) {
  const dt = 1 / 60;
  return computeDesiredMovement(
    velocity,
    actions,
    false, // not grounded
    opts.canJump ?? false,
    dt,
    GRAVITY,
    opts.jumpPressedThisFrame ?? false,
    opts.jumpReleasedThisFrame ?? false,
  );
}

// ─── Basic movement ──────────────────────────────────────

describe("computeDesiredMovement", () => {
  it("applies gravity when in the air", () => {
    const result = airborne({ x: 0, y: 0 });
    expect(result.newVelocity.y).toBeGreaterThan(0);
    expect(result.desiredDelta.y).toBeGreaterThan(0);
  });

  it("produces leftward delta when move_left is active", () => {
    const result = grounded({ x: 0, y: 0 }, [makeAction("move_left")]);
    expect(result.desiredDelta.x).toBeLessThan(0);
  });

  it("produces rightward delta when move_right is active", () => {
    const result = grounded({ x: 0, y: 0 }, [makeAction("move_right")]);
    expect(result.desiredDelta.x).toBeGreaterThan(0);
  });

  it("jumps when grounded and jump freshly pressed", () => {
    const result = grounded({ x: 0, y: 0 }, [], { jumpPressedThisFrame: true });
    expect(result.newVelocity.y).toBeLessThan(0);
    expect(result.desiredDelta.y).toBeLessThan(0);
    expect(result.jumped).toBe(true);
  });

  it("does NOT jump when jump is held (not fresh press)", () => {
    // Jump held from previous frame — should not re-trigger
    const result = grounded({ x: 0, y: 0 }, [], { jumpPressedThisFrame: false });
    expect(result.jumped).toBe(false);
  });

  it("does not jump when in the air (no coyote)", () => {
    const result = airborne({ x: 0, y: -1 }, [], { canJump: false, jumpPressedThisFrame: true });
    // canJump is false, so even a fresh press shouldn't work
    expect(result.jumped).toBe(false);
  });

  it("decelerates when no horizontal input on ground", () => {
    const result = grounded({ x: 3, y: 0 });
    expect(result.newVelocity.x).toBeLessThan(3);
    expect(result.newVelocity.x).toBeGreaterThanOrEqual(0);
  });

  it("snaps to zero when velocity is small and no input on ground", () => {
    const result = grounded({ x: 0.05, y: 0 });
    expect(result.newVelocity.x).toBe(0);
    expect(result.desiredDelta.x).toBe(0);
  });

  it("left and right cancel out and decelerate on ground", () => {
    const result = grounded({ x: 2, y: 0 }, [makeAction("move_left"), makeAction("move_right")]);
    // On ground, both pressed = instant snap to MOVE_SPEED of inputDir=0, decel applies
    expect(result.newVelocity.x).toBeLessThan(2);
  });

  it("falls by the world's gravity it is given", () => {
    const dt = 1 / 60;
    const moon = computeDesiredMovement({ x: 0, y: 0 }, [], false, false, dt, 2, false, false);
    expect(moon.newVelocity.y).toBeCloseTo(2 * dt, 9);
  });

  it("gravity still applies when grounded", () => {
    const result = grounded({ x: 0, y: 0 });
    expect(result.newVelocity.y).toBeGreaterThan(0);
  });

  it("overrides velocity to full speed on fresh input (grounded)", () => {
    const result = grounded({ x: 0, y: 0 }, [makeAction("move_right")]);
    expect(result.newVelocity.x).toBe(MOVE_SPEED);
  });
});

describe("tuning in metres", () => {
  it("is M1's px tuning ÷ 100 at the platformer's 100 px per metre", () => {
    expect(platformerGame.world).toMatchObject({ gravity: [0, 12], lengthUnit: 100 });
    expect(MOVEMENT_CONFIG).toMatchObject({
      moveSpeed: 3,
      jumpVelocity: -5,
      groundDecel: 24,
      airAccel: 24,
      maxFallSpeed: 9,
      wallSlideSpeed: 1.2,
      wallJumpForce: { x: 3.5, y: -5 },
      dashSpeed: 6,
    });
    expect([PLAYER_WIDTH, PLAYER_HEIGHT]).toEqual([0.6, 0.6]);
  });
});

// ─── Variable jump height ────────────────────────────────

describe("variable jump height", () => {
  it("cuts upward velocity on jump release while rising", () => {
    const result = airborne({ x: 0, y: JUMP_VELOCITY }, [], { jumpReleasedThisFrame: true });

    const expectedCutVy = JUMP_VELOCITY * JUMP_CUT_MULTIPLIER;
    const expectedFinal = expectedCutVy + GRAVITY / 60;

    expect(result.newVelocity.y).toBeCloseTo(expectedFinal, 6);
    expect(result.newVelocity.y).toBeGreaterThan(JUMP_VELOCITY);
  });

  it("does not cut velocity when jump is still held (no release)", () => {
    const result = airborne({ x: 0, y: JUMP_VELOCITY }, [], { jumpReleasedThisFrame: false });

    const expected = JUMP_VELOCITY + GRAVITY / 60;
    expect(result.newVelocity.y).toBeCloseTo(expected, 6);
    expect(result.newVelocity.y).toBeLessThan(0);
  });

  it("does not cut velocity when falling (vy > 0)", () => {
    const result = airborne({ x: 0, y: 1 }, [], { jumpReleasedThisFrame: true });

    expect(result.newVelocity.y).toBeCloseTo(1 + GRAVITY / 60, 6);
  });
});

// ─── Coyote time ─────────────────────────────────────────

describe("coyote time", () => {
  it("allows jump when canJump is true even if not grounded", () => {
    const result = airborne(
      { x: 0, y: 0.5 }, // falling slowly
      [],
      { canJump: true, jumpPressedThisFrame: true },
    );

    expect(result.jumped).toBe(true);
    // vy should be set to JUMP_VELOCITY + gravity*dt
    expect(result.newVelocity.y).toBeCloseTo(JUMP_VELOCITY + GRAVITY / 60, 6);
  });

  it("does not allow jump when canJump is false and not grounded", () => {
    const result = airborne({ x: 0, y: 0.5 }, [], { canJump: false, jumpPressedThisFrame: true });

    expect(result.jumped).toBe(false);
    // vy should just be gravity applied: 0.5 + gravity*dt
    expect(result.newVelocity.y).toBeCloseTo(0.5 + GRAVITY / 60, 6);
  });
});

// ─── Air control ─────────────────────────────────────────

describe("air control", () => {
  it("does not instantly snap to MOVE_SPEED when airborne", () => {
    const result = airborne(
      { x: 0, y: -2 }, // rising
      [makeAction("move_right")],
    );

    // Should accelerate toward MOVE_SPEED but NOT reach it in one frame
    expect(result.newVelocity.x).toBeGreaterThan(0);
    expect(result.newVelocity.x).toBeLessThan(MOVE_SPEED);
  });

  it("accelerates toward MOVE_SPEED in the input direction", () => {
    const result = airborne({ x: 1, y: -2 }, [makeAction("move_right")]);

    // Should be closer to MOVE_SPEED than before
    expect(result.newVelocity.x).toBeGreaterThan(1);
  });

  it("can accelerate leftward while moving right in air", () => {
    const result = airborne({ x: 2, y: -1 }, [makeAction("move_left")]);

    // Air control should push vx toward -MOVE_SPEED
    expect(result.newVelocity.x).toBeLessThan(2);
  });

  it("preserves horizontal momentum in air with no input", () => {
    const result = airborne(
      { x: 2.5, y: -1 },
      [], // no input
    );

    // No deceleration in air — momentum preserved
    expect(result.newVelocity.x).toBe(2.5);
  });

  it("applies instant snap on ground even after being airborne", () => {
    const result = grounded({ x: 0, y: 0 }, [makeAction("move_right")]);

    expect(result.newVelocity.x).toBe(MOVE_SPEED);
  });
});

// ─── Max fall speed ──────────────────────────────────────

describe("max fall speed", () => {
  it("caps downward velocity at MAX_FALL_SPEED", () => {
    const result = airborne({ x: 0, y: MAX_FALL_SPEED + 1 });

    expect(result.newVelocity.y).toBeLessThanOrEqual(MAX_FALL_SPEED);
  });

  it("does not cap upward velocity", () => {
    // Very fast upward (negative) velocity should not be capped
    const result = airborne({ x: 0, y: -20 });

    // Should be -20 + gravity*dt, still negative
    expect(result.newVelocity.y).toBeCloseTo(-20 + GRAVITY / 60, 6);
    expect(result.newVelocity.y).toBeLessThan(0);
  });

  it("allows falling at MAX_FALL_SPEED exactly", () => {
    const result = airborne({ x: 0, y: MAX_FALL_SPEED - GRAVITY / 60 });

    // After gravity: should be ~MAX_FALL_SPEED
    expect(result.newVelocity.y).toBeCloseTo(MAX_FALL_SPEED, 6);
  });
});

// ─── Wall-slide / wall-jump (pure function aspects) ──────

describe("wall mechanics (pure function)", () => {
  it("allows jump when canJump is true (wall-sliding grants canJump)", () => {
    const result = airborne(
      { x: 0, y: 1 }, // falling
      [],
      { canJump: true, jumpPressedThisFrame: true },
    );

    expect(result.jumped).toBe(true);
    expect(result.newVelocity.y).toBeLessThan(0); // launched upward
  });

  it("reports jumped=true so entity can apply wall-jump override", () => {
    const result = airborne({ x: 0, y: 0.5 }, [], { canJump: true, jumpPressedThisFrame: true });

    expect(result.jumped).toBe(true);
  });

  it("does not jump when canJump=false even with fresh press", () => {
    const result = airborne({ x: 0, y: 0.5 }, [], { canJump: false, jumpPressedThisFrame: true });

    expect(result.jumped).toBe(false);
  });

  it("does not jump on held key even with canJump=true", () => {
    const result = airborne({ x: 0, y: 0.5 }, [], { canJump: true, jumpPressedThisFrame: false });

    expect(result.jumped).toBe(false);
  });
});

// ─── Movement state machine ─────────────────────────────

describe("deriveMovementState", () => {
  it("returns 'idle' when grounded and not moving", () => {
    expect(deriveMovementState(true, false, false, false, 0, 0)).toBe("idle");
  });

  it("returns 'idle' when grounded with negligible velocity", () => {
    expect(deriveMovementState(true, false, false, false, 0, 0.005)).toBe("idle");
  });

  it("returns 'walking' when grounded and moving", () => {
    expect(deriveMovementState(true, false, false, false, 0, 3)).toBe("walking");
    expect(deriveMovementState(true, false, false, false, 0, -3)).toBe("walking");
  });

  it("returns 'jumping' when airborne and rising", () => {
    expect(deriveMovementState(false, false, false, false, -2, 1)).toBe("jumping");
  });

  it("returns 'falling' when airborne and descending", () => {
    expect(deriveMovementState(false, false, false, false, 1, 0.5)).toBe("falling");
  });

  it("returns 'falling' when vy is exactly 0 (apex)", () => {
    expect(deriveMovementState(false, false, false, false, 0, 1)).toBe("falling");
  });

  it("returns 'wall_sliding' when wall-sliding regardless of other state", () => {
    expect(deriveMovementState(false, true, false, false, 1, 0)).toBe("wall_sliding");
    expect(deriveMovementState(false, true, false, false, -0.5, 3)).toBe("wall_sliding");
  });

  it("returns 'dashing' when dashing regardless of other state", () => {
    expect(deriveMovementState(true, false, true, false, 0, 6)).toBe("dashing");
    expect(deriveMovementState(false, false, true, false, -2, 6)).toBe("dashing");
    expect(deriveMovementState(false, true, true, false, 1, 6)).toBe("dashing");
  });

  it("returns 'grappling' when grappling (highest priority)", () => {
    expect(deriveMovementState(false, false, false, true, 0, 0)).toBe("grappling");
    expect(deriveMovementState(false, false, true, true, 0, 6)).toBe("grappling");
    expect(deriveMovementState(false, true, false, true, 1, 0)).toBe("grappling");
  });
});

// ─── Cheese weight ───────────────────────────────────────

describe("cheese weight multiplier", () => {
  const dt = 1 / 60;

  it("reduces jump velocity when carrying cheese", () => {
    const result = computeDesiredMovement(
      { x: 0, y: 0 },
      [],
      true,
      true,
      dt,
      GRAVITY,
      true,
      false,
      true,
    );

    const expectedJumpVy = JUMP_VELOCITY * MOVEMENT_CONFIG.cheeseWeightMultiplier;
    // After gravity: expectedJumpVy + GRAVITY * dt
    expect(result.newVelocity.y).toBeCloseTo(expectedJumpVy + GRAVITY * dt, 6);
    expect(result.jumped).toBe(true);
  });

  it("has weaker jump than normal (less negative vy)", () => {
    const normal = computeDesiredMovement(
      { x: 0, y: 0 },
      [],
      true,
      true,
      dt,
      GRAVITY,
      true,
      false,
      false,
    );
    const cheese = computeDesiredMovement(
      { x: 0, y: 0 },
      [],
      true,
      true,
      dt,
      GRAVITY,
      true,
      false,
      true,
    );

    // Cheese jump should be less negative (weaker) than normal
    expect(cheese.newVelocity.y).toBeGreaterThan(normal.newVelocity.y);
  });
});

// ─── The player type's system ───────────────────────────

describe("the player system", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  const empty: ExpandedScene = {
    name: "t",
    game: "platformer",
    bounds: [-10, -10, 10, 10],
    settings: {
      gravity: [0, 12],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities: [],
  };
  const runtime = () => createHeadlessRuntime({ rapier, game: platformerGame, scene: empty });

  it("has no step hooks, so its place in the spawn order can't change a step", () => {
    const rt = runtime();
    const system = rt.ctx.system<PlayerSystem>(PLAYER_TYPE)!;
    expect("beforeStep" in system).toBe(false);
    expect("afterStep" in system).toBe(false);
    rt.destroy();
  });

  it("spawns an actor under the entity's id, posed at its feet, and despawn destroys it", () => {
    const rt = runtime();
    const system = rt.ctx.system<PlayerSystem>(PLAYER_TYPE)!;
    // Values a 32-bit float holds exactly, as Rapier stores them.
    const e = rt.ctx.spawn({ type: PLAYER_TYPE, id: "player#lead", at: [0.5, -0.7] });
    expect(e.id).toBe("player#lead");
    const actor = system.actor("player#lead")!;
    expect(actor.getPosition()).toEqual({ x: 0.5, y: -0.7 - PLAYER_HEIGHT / 2 });
    expect(rt.ctx.poses.get("player#lead")).toEqual({ x: 0.5, y: -0.7, rot: 0 });
    const [handle] = rt.ctx.tags.handlesOf("player#lead");
    expect(rt.ctx.tags.get(handle!)).toEqual({ entityId: "player#lead", type: PLAYER_TYPE });
    expect(rt.stats()).toMatchObject({ bodies: 1, colliders: 1, perType: { player: 1 } });

    rt.ctx.destroy("player#lead");
    expect(system.actor("player#lead")).toBeUndefined();
    expect(system.size()).toBe(0);
    expect(rt.stats()).toMatchObject({ bodies: 0, colliders: 0, tags: 0 });
    system.despawn("player#lead");
    rt.destroy();
  });

  it("numbers further actors player#2, player#3 in spawn order", () => {
    const rt = runtime();
    const ids = [0, 1].map((i) => rt.ctx.spawn({ type: PLAYER_TYPE, at: [i, 0] }).id);
    expect(ids).toEqual(["player#1", "player#2"]);
    expect(rt.ctx.query.byType(PLAYER_TYPE)).toEqual(ids);
    rt.ctx.system<PlayerSystem>(PLAYER_TYPE)!.clear();
    expect(rt.stats().bodies).toBe(0);
    rt.destroy();
  });

  it("refuses a spawn without its feet", () => {
    const rt = runtime();
    expect(() => rt.ctx.spawn({ type: PLAYER_TYPE })).toThrow(
      expect.objectContaining({ code: "schema" }),
    );
    expect(rt.ctx.exists("player#1")).toBe(false);
    rt.destroy();
  });
});

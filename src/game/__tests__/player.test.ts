import { describe, expect, it } from "vite-plus/test";
import {
  computeDesiredMovement,
  deriveMovementState,
  JUMP_VELOCITY,
  JUMP_CUT_MULTIPLIER,
  MOVE_SPEED,
  MAX_FALL_SPEED,
  GRAVITY,
  MOVEMENT_CONFIG,
} from "../entities/player";
import type { InputAction } from "../types";

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
    const result = airborne({ x: 0, y: -100 }, [], { canJump: false, jumpPressedThisFrame: true });
    // canJump is false, so even a fresh press shouldn't work
    expect(result.jumped).toBe(false);
  });

  it("decelerates when no horizontal input on ground", () => {
    const result = grounded({ x: 300, y: 0 });
    expect(result.newVelocity.x).toBeLessThan(300);
    expect(result.newVelocity.x).toBeGreaterThanOrEqual(0);
  });

  it("snaps to zero when velocity is small and no input on ground", () => {
    const result = grounded({ x: 5, y: 0 });
    expect(result.newVelocity.x).toBe(0);
    expect(result.desiredDelta.x).toBe(0);
  });

  it("left and right cancel out and decelerate on ground", () => {
    const result = grounded({ x: 200, y: 0 }, [makeAction("move_left"), makeAction("move_right")]);
    // On ground, both pressed = instant snap to MOVE_SPEED of inputDir=0, decel applies
    expect(result.newVelocity.x).toBeLessThan(200);
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

// ─── Variable jump height ────────────────────────────────

describe("variable jump height", () => {
  it("cuts upward velocity on jump release while rising", () => {
    const result = airborne({ x: 0, y: JUMP_VELOCITY }, [], { jumpReleasedThisFrame: true });

    const expectedCutVy = JUMP_VELOCITY * JUMP_CUT_MULTIPLIER;
    const expectedFinal = expectedCutVy + GRAVITY / 60;

    expect(result.newVelocity.y).toBeCloseTo(expectedFinal, 1);
    expect(result.newVelocity.y).toBeGreaterThan(JUMP_VELOCITY);
  });

  it("does not cut velocity when jump is still held (no release)", () => {
    const result = airborne({ x: 0, y: JUMP_VELOCITY }, [], { jumpReleasedThisFrame: false });

    const expected = JUMP_VELOCITY + GRAVITY / 60;
    expect(result.newVelocity.y).toBeCloseTo(expected, 1);
    expect(result.newVelocity.y).toBeLessThan(0);
  });

  it("does not cut velocity when falling (vy > 0)", () => {
    const result = airborne({ x: 0, y: 100 }, [], { jumpReleasedThisFrame: true });

    expect(result.newVelocity.y).toBeCloseTo(100 + GRAVITY / 60, 1);
  });
});

// ─── Coyote time ─────────────────────────────────────────

describe("coyote time", () => {
  it("allows jump when canJump is true even if not grounded", () => {
    const result = airborne(
      { x: 0, y: 50 }, // falling slowly
      [],
      { canJump: true, jumpPressedThisFrame: true },
    );

    expect(result.jumped).toBe(true);
    // vy should be set to JUMP_VELOCITY + gravity*dt
    expect(result.newVelocity.y).toBeCloseTo(JUMP_VELOCITY + GRAVITY / 60, 1);
  });

  it("does not allow jump when canJump is false and not grounded", () => {
    const result = airborne({ x: 0, y: 50 }, [], { canJump: false, jumpPressedThisFrame: true });

    expect(result.jumped).toBe(false);
    // vy should just be gravity applied: 50 + gravity*dt
    expect(result.newVelocity.y).toBeCloseTo(50 + GRAVITY / 60, 1);
  });
});

// ─── Air control ─────────────────────────────────────────

describe("air control", () => {
  it("does not instantly snap to MOVE_SPEED when airborne", () => {
    const result = airborne(
      { x: 0, y: -200 }, // rising
      [makeAction("move_right")],
    );

    // Should accelerate toward MOVE_SPEED but NOT reach it in one frame
    expect(result.newVelocity.x).toBeGreaterThan(0);
    expect(result.newVelocity.x).toBeLessThan(MOVE_SPEED);
  });

  it("accelerates toward MOVE_SPEED in the input direction", () => {
    const result = airborne({ x: 100, y: -200 }, [makeAction("move_right")]);

    // Should be closer to MOVE_SPEED than before
    expect(result.newVelocity.x).toBeGreaterThan(100);
  });

  it("can accelerate leftward while moving right in air", () => {
    const result = airborne({ x: 200, y: -100 }, [makeAction("move_left")]);

    // Air control should push vx toward -MOVE_SPEED
    expect(result.newVelocity.x).toBeLessThan(200);
  });

  it("preserves horizontal momentum in air with no input", () => {
    const result = airborne(
      { x: 250, y: -100 },
      [], // no input
    );

    // No deceleration in air — momentum preserved
    expect(result.newVelocity.x).toBe(250);
  });

  it("applies instant snap on ground even after being airborne", () => {
    const result = grounded({ x: 0, y: 0 }, [makeAction("move_right")]);

    expect(result.newVelocity.x).toBe(MOVE_SPEED);
  });
});

// ─── Max fall speed ──────────────────────────────────────

describe("max fall speed", () => {
  it("caps downward velocity at MAX_FALL_SPEED", () => {
    const result = airborne({ x: 0, y: MAX_FALL_SPEED + 100 });

    expect(result.newVelocity.y).toBeLessThanOrEqual(MAX_FALL_SPEED);
  });

  it("does not cap upward velocity", () => {
    // Very fast upward (negative) velocity should not be capped
    const result = airborne({ x: 0, y: -2000 });

    // Should be -2000 + gravity*dt, still negative
    expect(result.newVelocity.y).toBeCloseTo(-2000 + GRAVITY / 60, 1);
    expect(result.newVelocity.y).toBeLessThan(0);
  });

  it("allows falling at MAX_FALL_SPEED exactly", () => {
    const result = airborne({ x: 0, y: MAX_FALL_SPEED - GRAVITY / 60 });

    // After gravity: should be ~MAX_FALL_SPEED
    expect(result.newVelocity.y).toBeCloseTo(MAX_FALL_SPEED, 0);
  });
});

// ─── Wall-slide / wall-jump (pure function aspects) ──────

describe("wall mechanics (pure function)", () => {
  it("allows jump when canJump is true (wall-sliding grants canJump)", () => {
    const result = airborne(
      { x: 0, y: 100 }, // falling
      [],
      { canJump: true, jumpPressedThisFrame: true },
    );

    expect(result.jumped).toBe(true);
    expect(result.newVelocity.y).toBeLessThan(0); // launched upward
  });

  it("reports jumped=true so entity can apply wall-jump override", () => {
    const result = airborne({ x: 0, y: 50 }, [], { canJump: true, jumpPressedThisFrame: true });

    expect(result.jumped).toBe(true);
  });

  it("does not jump when canJump=false even with fresh press", () => {
    const result = airborne({ x: 0, y: 50 }, [], { canJump: false, jumpPressedThisFrame: true });

    expect(result.jumped).toBe(false);
  });

  it("does not jump on held key even with canJump=true", () => {
    const result = airborne({ x: 0, y: 50 }, [], { canJump: true, jumpPressedThisFrame: false });

    expect(result.jumped).toBe(false);
  });
});

// ─── Movement state machine ─────────────────────────────

describe("deriveMovementState", () => {
  it("returns 'idle' when grounded and not moving", () => {
    expect(deriveMovementState(true, false, false, false, 0, 0)).toBe("idle");
  });

  it("returns 'idle' when grounded with negligible velocity", () => {
    expect(deriveMovementState(true, false, false, false, 0, 0.5)).toBe("idle");
  });

  it("returns 'walking' when grounded and moving", () => {
    expect(deriveMovementState(true, false, false, false, 0, 300)).toBe("walking");
    expect(deriveMovementState(true, false, false, false, 0, -300)).toBe("walking");
  });

  it("returns 'jumping' when airborne and rising", () => {
    expect(deriveMovementState(false, false, false, false, -200, 100)).toBe("jumping");
  });

  it("returns 'falling' when airborne and descending", () => {
    expect(deriveMovementState(false, false, false, false, 100, 50)).toBe("falling");
  });

  it("returns 'falling' when vy is exactly 0 (apex)", () => {
    expect(deriveMovementState(false, false, false, false, 0, 100)).toBe("falling");
  });

  it("returns 'wall_sliding' when wall-sliding regardless of other state", () => {
    expect(deriveMovementState(false, true, false, false, 100, 0)).toBe("wall_sliding");
    expect(deriveMovementState(false, true, false, false, -50, 300)).toBe("wall_sliding");
  });

  it("returns 'dashing' when dashing regardless of other state", () => {
    expect(deriveMovementState(true, false, true, false, 0, 600)).toBe("dashing");
    expect(deriveMovementState(false, false, true, false, -200, 600)).toBe("dashing");
    expect(deriveMovementState(false, true, true, false, 100, 600)).toBe("dashing");
  });

  it("returns 'grappling' when grappling (highest priority)", () => {
    expect(deriveMovementState(false, false, false, true, 0, 0)).toBe("grappling");
    expect(deriveMovementState(false, false, true, true, 0, 600)).toBe("grappling");
    expect(deriveMovementState(false, true, false, true, 100, 0)).toBe("grappling");
  });
});

// ─── Cheese weight ───────────────────────────────────────

describe("cheese weight multiplier", () => {
  const dt = 1 / 60;

  it("reduces jump velocity when carrying cheese", () => {
    const result = computeDesiredMovement({ x: 0, y: 0 }, [], true, true, dt, true, false, true);

    const expectedJumpVy = JUMP_VELOCITY * MOVEMENT_CONFIG.cheeseWeightMultiplier;
    // After gravity: expectedJumpVy + GRAVITY * dt
    expect(result.newVelocity.y).toBeCloseTo(expectedJumpVy + GRAVITY * dt, 1);
    expect(result.jumped).toBe(true);
  });

  it("has weaker jump than normal (less negative vy)", () => {
    const normal = computeDesiredMovement({ x: 0, y: 0 }, [], true, true, dt, true, false, false);
    const cheese = computeDesiredMovement({ x: 0, y: 0 }, [], true, true, dt, true, false, true);

    // Cheese jump should be less negative (weaker) than normal
    expect(cheese.newVelocity.y).toBeGreaterThan(normal.newVelocity.y);
  });
});

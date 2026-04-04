import { type Container, Graphics } from "pixi.js";
import {
  PLAYER_COLLISION_GROUP,
  registerPlayerCollider,
  unregisterPlayerCollider,
} from "../collisions";
import type { PhysicsWorld } from "../physics";
import { getRapier } from "../physics";
import { getSurfaceMaterial, type SurfaceMaterial } from "../surfaces";
import type { InputAction, Vec2 } from "../types";
import type { GrappleAnchorSystem } from "./grapple-anchor";
import {
  initSwingState,
  stepSwing,
  getSwingReleaseVelocity,
  type GrappleSwingState,
} from "./grapple-state";
import { getActiveWindZones, getBouncePad } from "./shaper-constructs";

// ─── Movement config ─────────────────────────────────────
// All tunable constants in one place. Importable for tests, debug overlays, etc.

export type MovementConfig = {
  moveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  groundDecel: number;
  jumpCutMultiplier: number;
  airControl: number;
  airReversalMultiplier: number;
  airAccel: number;
  maxFallSpeed: number;
  coyoteTimeMs: number;
  wallSlideSpeed: number;
  wallJumpForce: { x: number; y: number };
  wallJumpLockoutMs: number;
  wallSlideCoyoteMs: number;
  cheeseWeightMultiplier: number;
  dashSpeed: number;
  dashDurationMs: number;
  dashCooldownMs: number;
};

export const MOVEMENT_CONFIG: MovementConfig = {
  moveSpeed: 300, // game units/sec
  jumpVelocity: -500, // game units/sec (negative = up)
  gravity: 1200, // game units/sec²
  groundDecel: 2400, // game units/sec² — rapid decel when no input
  jumpCutMultiplier: 0.4, // multiply vy on jump release (variable height)
  airControl: 0.6, // horizontal influence multiplier while airborne (0–1)
  airReversalMultiplier: 8.0, // extra accel multiplier when input opposes velocity in air
  airAccel: 300 * 8, // game units/sec² — acceleration rate in air
  maxFallSpeed: 900, // game units/sec — terminal velocity cap
  coyoteTimeMs: 100, // ms — grace period to jump after leaving ground
  wallSlideSpeed: 120, // game units/sec — capped fall speed when wall-sliding
  wallJumpForce: { x: 350, y: -500 }, // launch velocity away from wall (1.5× normal jump)
  wallJumpLockoutMs: 180, // ms — input lockout toward wall after wall-jump
  wallSlideCoyoteMs: 300, // ms — wall-slide state maintained after releasing dir input
  cheeseWeightMultiplier: 0.85, // jump velocity multiplier when carrying cheese
  dashSpeed: 600, // game units/sec — 2× move speed
  dashDurationMs: 180, // ms — dash burst duration
  dashCooldownMs: 800, // ms — time before next dash
};

// Re-export individual constants for backward compat (tests, debug overlays)
export const MOVE_SPEED = MOVEMENT_CONFIG.moveSpeed;
export const JUMP_VELOCITY = MOVEMENT_CONFIG.jumpVelocity;
export const GRAVITY = MOVEMENT_CONFIG.gravity;
export const GROUND_DECEL = MOVEMENT_CONFIG.groundDecel;
export const JUMP_CUT_MULTIPLIER = MOVEMENT_CONFIG.jumpCutMultiplier;
export const AIR_CONTROL = MOVEMENT_CONFIG.airControl;
export const AIR_REVERSAL_MULTIPLIER = MOVEMENT_CONFIG.airReversalMultiplier;
export const AIR_ACCEL = MOVEMENT_CONFIG.airAccel;
export const MAX_FALL_SPEED = MOVEMENT_CONFIG.maxFallSpeed;
export const COYOTE_TIME_MS = MOVEMENT_CONFIG.coyoteTimeMs;
export const WALL_SLIDE_SPEED = MOVEMENT_CONFIG.wallSlideSpeed;
export const WALL_JUMP_FORCE = MOVEMENT_CONFIG.wallJumpForce;
export const WALL_JUMP_LOCKOUT_MS = MOVEMENT_CONFIG.wallJumpLockoutMs;
export const WALL_SLIDE_COYOTE_MS = MOVEMENT_CONFIG.wallSlideCoyoteMs;

const WALL_NORMAL_THRESHOLD = 0.7; // |normal.x| must exceed this to count as a wall
const PLAYER_WIDTH = 60;
const PLAYER_HEIGHT = 60;

// ─── Movement state machine ─────────────────────────────

export type MovementState =
  | "idle"
  | "walking"
  | "jumping"
  | "falling"
  | "wall_sliding"
  | "dashing"
  | "grappling";

/** Derive the movement state from physical state. Pure function for testability. */
export function deriveMovementState(
  grounded: boolean,
  wallSliding: boolean,
  isDashing: boolean,
  isGrappling: boolean,
  vy: number,
  vx: number,
): MovementState {
  if (isGrappling) return "grappling";
  if (isDashing) return "dashing";
  if (wallSliding) return "wall_sliding";
  if (grounded) {
    return Math.abs(vx) > 1 ? "walking" : "idle";
  }
  return vy < 0 ? "jumping" : "falling";
}

export type PlayerEntity = {
  /** @param groundDeltaY — optional Y delta of the platform we're standing on (positive = down). Used to adjust ground stick velocity for moving platforms. */
  update: (dt: number, actions: InputAction[], groundDeltaY?: number) => void;
  getPosition: () => Vec2;
  getVelocity: () => Vec2;
  isGrounded: () => boolean;
  isHoldingJump: () => boolean;
  isHoldingMove: () => boolean;
  isHoldingDown: () => boolean;
  /** Half the player collider height — used by cloud platform system */
  getHalfHeight: () => number;
  /** Collider handle of the ground we're standing on (from last frame's collisions), or null */
  getGroundColliderHandle: () => number | null;
  /** -1 = wall on left, 0 = no wall, 1 = wall on right */
  getWallDirection: () => -1 | 0 | 1;
  isWallSliding: () => boolean;
  isDashing: () => boolean;
  isGrappling: () => boolean;
  getMovementState: () => MovementState;
  /** Position/velocity/grounded BEFORE this tick's update (for debug arc origin) */
  getPreUpdateState: () => { position: Vec2; velocity: Vec2; grounded: boolean };
  destroy: () => void;
};

/**
 * Compute the desired movement vector from input + gravity.
 * Pure function — no Rapier dependency — for testability.
 * Returns the desired translation delta (not final position).
 */
export function computeDesiredMovement(
  velocity: Vec2,
  actions: InputAction[],
  grounded: boolean,
  canJump: boolean,
  dtSec: number,
  jumpPressedThisFrame: boolean,
  jumpReleasedThisFrame: boolean,
  carryingCheese = false,
): { desiredDelta: Vec2; newVelocity: Vec2; jumped: boolean } {
  let vx = velocity.x;
  let vy = velocity.y;
  let jumped = false;

  // Track which movement actions are currently active
  const activeActions = new Set<string>();
  for (const action of actions) {
    if (action.pressed) {
      activeActions.add(action.action);
    } else {
      activeActions.delete(action.action);
    }
  }

  // Horizontal movement
  const wantsLeft = activeActions.has("move_left");
  const wantsRight = activeActions.has("move_right");
  const inputDir = (wantsRight ? 1 : 0) - (wantsLeft ? 1 : 0);

  if (grounded) {
    // Grounded: instant snap to target speed
    if (inputDir !== 0) {
      vx = inputDir * MOVE_SPEED;
    } else {
      // No input — decelerate rapidly
      if (Math.abs(vx) < GROUND_DECEL * dtSec) {
        vx = 0;
      } else {
        vx -= Math.sign(vx) * GROUND_DECEL * dtSec;
      }
    }
  } else {
    // Airborne: accelerate toward target at reduced rate
    if (inputDir !== 0) {
      const targetVx = inputDir * MOVE_SPEED;
      const diff = targetVx - vx;
      // Reversing direction? (input opposes current velocity) — use higher multiplier
      const reversing = (vx > 0 && inputDir < 0) || (vx < 0 && inputDir > 0);
      const multiplier = reversing ? AIR_REVERSAL_MULTIPLIER : 1.0;
      if (Math.abs(diff) > 1) {
        const accel = AIR_ACCEL * AIR_CONTROL * multiplier * dtSec;
        if (Math.abs(diff) < accel) {
          vx = targetVx;
        } else {
          vx += Math.sign(diff) * accel;
        }
      }
    }
    // No deceleration in air when no input — preserve momentum
  }

  // Jump — only on fresh press, allowed if grounded / coyote / wall-sliding
  if (jumpPressedThisFrame && canJump) {
    const jumpVel = carryingCheese
      ? JUMP_VELOCITY * MOVEMENT_CONFIG.cheeseWeightMultiplier
      : JUMP_VELOCITY;
    vy = jumpVel;
    jumped = true;
  }

  // Variable jump height — cut upward velocity on jump release while rising
  if (jumpReleasedThisFrame && vy < 0) {
    vy *= JUMP_CUT_MULTIPLIER;
  }

  // Gravity
  vy += GRAVITY * dtSec;

  // Max fall speed cap
  if (vy > MAX_FALL_SPEED) {
    vy = MAX_FALL_SPEED;
  }

  // Desired translation delta for this frame
  const desiredDelta: Vec2 = {
    x: vx * dtSec,
    y: vy * dtSec,
  };

  return { desiredDelta, newVelocity: { x: vx, y: vy }, jumped };
}

export function createPlayerEntity(
  worldContainer: Container,
  physics: PhysicsWorld,
  grappleAnchors?: GrappleAnchorSystem,
): PlayerEntity {
  const RAPIER = getRapier();

  // ─── Visual ──────────────────────────────────────────
  const graphics = new Graphics();
  graphics.rect(0, 0, PLAYER_WIDTH, PLAYER_HEIGHT);
  graphics.fill({ color: 0xffa949 }); // Brackeys yellow
  graphics.pivot.set(PLAYER_WIDTH / 2, PLAYER_HEIGHT / 2);
  worldContainer.addChild(graphics);

  // ─── Physics body ────────────────────────────────────
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    960,
    1020 - PLAYER_HEIGHT,
  );
  const body = physics.addRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    PLAYER_WIDTH / 2,
    PLAYER_HEIGHT / 2,
  ).setCollisionGroups(PLAYER_COLLISION_GROUP);
  const collider = physics.addCollider(colliderDesc, body);
  registerPlayerCollider(collider.handle);

  const controller = physics.createCharacterController();

  // ─── State ───────────────────────────────────────────
  let velocity: Vec2 = { x: 0, y: 0 };
  let grounded = true;
  let holdingJump = false;
  let holdingMove = false;
  let movementState: MovementState = "idle";
  let lastGroundedTimeMs = 0; // timestamp (ms) of last frame we were grounded
  let elapsedMs = 0; // running game clock for coyote time tracking

  // Wall-slide / wall-jump state
  let wallDir: -1 | 0 | 1 = 0; // -1 = wall on left, 1 = wall on right, 0 = none
  let wallSliding = false;
  let lastWallSlideTimeMs = -Infinity; // timestamp of last frame we were actively wall-sliding
  let lastWallSlideDir: -1 | 0 | 1 = 0; // which wall we were sliding on (for coyote wall-jump)
  let wallJumpLockoutUntilMs = 0; // timestamp — ignore input toward wall until this time
  let wallJumpLockoutDir: -1 | 0 | 1 = 0; // which direction is locked out
  let currentSurface: SurfaceMaterial | null = null; // surface we're standing on this tick
  let groundColliderHandle: number | null = null; // collider handle of ground (for moving platform query)
  let lastJumpWasWallJump = false; // skip variable jump height for wall-jumps

  // Double-jump state (ability — may not be assigned)
  let hasDoubleJump = true; // TODO: set from ability distribution system
  let doubleJumpAvailable = false; // reset on ground/wall-slide, consumed on use

  // Dash state
  let hasDash = true; // TODO: set from ability distribution system
  let dashing = false;
  let dashTimeRemainingMs = 0;
  let dashCooldownUntilMs = 0;
  let dashDirection = 1; // +1 = right, -1 = left
  let dashHeldLastFrame = false; // for fresh-press detection
  let lastFacingDir = 1; // track facing for directionless dash

  // Grapple state
  let hasGrapple = true; // TODO: set from ability distribution
  let grappling = false;
  let swingState: GrappleSwingState | null = null;
  let grappleHeldLastFrame = false;

  // Snapshot of state BEFORE each tick's update — for debug arc origin
  let preUpdateState = {
    position: { x: 960, y: 1020 - PLAYER_HEIGHT },
    velocity: { x: 0, y: 0 },
    grounded: true,
  };

  const heldActions = new Set<string>();

  function update(dt: number, actions: InputAction[], groundDeltaY = 0): void {
    elapsedMs += dt;

    // Capture pre-update state BEFORE anything changes
    const pos = body.translation();
    preUpdateState = {
      position: { x: pos.x, y: pos.y },
      velocity: { ...velocity },
      grounded,
    };

    // Detect jump press/release transitions
    const wasHoldingJump = heldActions.has("jump");

    // Update held state from action events
    for (const action of actions) {
      if (action.pressed) {
        heldActions.add(action.action);
      } else {
        heldActions.delete(action.action);
      }
    }

    const jumpNowHeld = heldActions.has("jump");
    const jumpPressedThisFrame = !wasHoldingJump && jumpNowHeld;
    const jumpReleasedThisFrame = wasHoldingJump && !jumpNowHeld;
    holdingJump = jumpNowHeld;
    holdingMove = heldActions.has("move_left") || heldActions.has("move_right");

    const dtSec = dt / 1000;

    // Resolve input direction (factoring in wall-jump lockout)
    const wantsLeft = heldActions.has("move_left");
    const wantsRight = heldActions.has("move_right");
    let inputDir = (wantsRight ? 1 : 0) - (wantsLeft ? 1 : 0);

    // Wall-jump lockout: suppress input toward the wall we jumped off of
    if (elapsedMs < wallJumpLockoutUntilMs && inputDir === wallJumpLockoutDir) {
      inputDir = 0;
    }

    // Build active actions with lockout applied (jump handled separately via jumpPressedThisFrame)
    const activeActions: InputAction[] = [];
    if (inputDir < 0)
      activeActions.push({ action: "move_left", pressed: true, tick: 0, timestamp: 0 });
    if (inputDir > 0)
      activeActions.push({ action: "move_right", pressed: true, tick: 0, timestamp: 0 });

    // Coyote time: allow jump if grounded OR recently grounded OR recently wall-sliding
    const withinCoyoteWindow = elapsedMs - lastGroundedTimeMs < COYOTE_TIME_MS;
    const withinWallSlideCoyote = elapsedMs - lastWallSlideTimeMs < WALL_SLIDE_COYOTE_MS;
    const canJump = grounded || withinCoyoteWindow || wallSliding || withinWallSlideCoyote;

    // Track facing direction for dash
    if (inputDir !== 0) lastFacingDir = inputDir as 1 | -1;

    // Dash trigger: fresh press only (same pattern as jump)
    const wasHoldingDash = dashHeldLastFrame;
    const dashNowHeld = heldActions.has("dash");
    dashHeldLastFrame = dashNowHeld;
    const dashPressedThisFrame = !wasHoldingDash && dashNowHeld;
    if (dashPressedThisFrame && hasDash && elapsedMs >= dashCooldownUntilMs && !dashing) {
      dashing = true;
      dashTimeRemainingMs = MOVEMENT_CONFIG.dashDurationMs;
      dashDirection = inputDir !== 0 ? inputDir : lastFacingDir;
    }

    // Dash tick: count down duration
    if (dashing) {
      dashTimeRemainingMs -= dt;
      if (dashTimeRemainingMs <= 0) {
        dashing = false;
        dashCooldownUntilMs = elapsedMs + MOVEMENT_CONFIG.dashCooldownMs;
      }
    }

    // Wall-jumps have fixed height — suppress variable jump cut
    const effectiveJumpRelease = lastJumpWasWallJump ? false : jumpReleasedThisFrame;

    // 1. Compute desired movement from input + gravity
    const { desiredDelta, newVelocity, jumped } = computeDesiredMovement(
      velocity,
      activeActions,
      grounded,
      canJump,
      dtSec,
      jumpPressedThisFrame,
      effectiveJumpRelease,
    );

    // 1b. Double-jump: if computeDesiredMovement didn't jump (canJump was false)
    //     but player pressed jump and has double-jump available, apply it.
    let didDoubleJump = false;
    if (!jumped && jumpPressedThisFrame && !grounded && hasDoubleJump && doubleJumpAvailable) {
      newVelocity.y = JUMP_VELOCITY;
      desiredDelta.y = newVelocity.y * dtSec;
      doubleJumpAvailable = false;
      didDoubleJump = true;
    }

    // 1c. Dash override: replace horizontal velocity with dash speed,
    //     zero out gravity/vertical movement to make dash feel flat and punchy.
    if (dashing) {
      newVelocity.x = dashDirection * MOVEMENT_CONFIG.dashSpeed;
      newVelocity.y = 0; // flat dash — no gravity during dash
      desiredDelta.x = newVelocity.x * dtSec;
      desiredDelta.y = 0;
    }

    // 1d. Grapple: attach/release/swing
    const wasGrappleHeld = grappleHeldLastFrame;
    const grappleNowHeld = heldActions.has("grapple");
    grappleHeldLastFrame = grappleNowHeld;
    const grapplePressedThisFrame = !wasGrappleHeld && grappleNowHeld;
    const grappleReleasedThisFrame = wasGrappleHeld && !grappleNowHeld;

    if (
      grapplePressedThisFrame &&
      hasGrapple &&
      !grappling &&
      !dashing &&
      !grounded &&
      grappleAnchors
    ) {
      const playerPos = body.translation();
      const anchor = grappleAnchors.findClosest({ x: playerPos.x, y: playerPos.y });
      if (anchor) {
        grappling = true;
        swingState = initSwingState({ x: playerPos.x, y: playerPos.y }, anchor.position, velocity);
        // Reset double-jump on grapple attach — grapple gives you another chance
        if (hasDoubleJump) doubleJumpAvailable = true;
      }
    }

    if (grappleReleasedThisFrame && grappling && swingState) {
      const releaseVel = getSwingReleaseVelocity(swingState);
      velocity = releaseVel;
      grappling = false;
      grappleAnchors?.clearTether();
      swingState = null;
    }

    if (grappling && swingState) {
      // Step pendulum physics
      const result = stepSwing(swingState, dtSec);
      swingState = result.state;

      // Collision check: use character controller to resolve the pendulum movement
      // against static geometry. If blocked, detach from grapple.
      const curPos = body.translation();
      const pendulumDelta = {
        x: result.position.x - curPos.x,
        y: result.position.y - curPos.y,
      };
      controller.computeColliderMovement(
        collider,
        new RAPIER.Vector2(pendulumDelta.x, pendulumDelta.y),
      );
      const corrected = controller.computedMovement();

      // Check if movement was significantly blocked
      const desiredDist = Math.sqrt(pendulumDelta.x ** 2 + pendulumDelta.y ** 2);
      const actualDist = Math.sqrt(corrected.x ** 2 + corrected.y ** 2);
      const blocked = desiredDist > 1 && actualDist < desiredDist * 0.5;

      if (blocked) {
        // Hit something — detach, kill velocity
        velocity = { x: 0, y: 0 };
        grappling = false;
        grappleAnchors?.clearTether();
        swingState = null;
        // Apply the corrected (partial) movement
        body.setNextKinematicTranslation(
          new RAPIER.Vector2(curPos.x + corrected.x, curPos.y + corrected.y),
        );
      } else {
        // Movement is clear — apply corrected pendulum position
        body.setNextKinematicTranslation(
          new RAPIER.Vector2(curPos.x + corrected.x, curPos.y + corrected.y),
        );
        grappleAnchors?.drawTether(
          { x: curPos.x + corrected.x, y: curPos.y + corrected.y },
          swingState.anchorPos,
        );
        velocity = result.velocity;
      }

      // Update visual
      const newPos = body.translation();
      graphics.position.set(newPos.x, newPos.y);

      // Update state
      grounded = false;
      wallSliding = false;
      wallDir = 0;
      movementState = deriveMovementState(false, false, false, grappling, velocity.y, velocity.x);

      preUpdateState = {
        position: { x: newPos.x, y: newPos.y },
        velocity: { ...velocity },
        grounded: false,
      };
      return; // <── early return, skip everything below
    }

    // 2. Character controller resolves the player's own input.
    //    Moving platforms: the character controller naturally handles platform
    //    riding through collision resolution — gravity pulls the player down,
    //    the controller detects the platform at its new position, and
    //    snap-to-ground keeps the player on it. No explicit platform delta needed.
    controller.computeColliderMovement(
      collider,
      new RAPIER.Vector2(desiredDelta.x, desiredDelta.y),
    );

    // Get the corrected movement (after collision resolution)
    const corrected = controller.computedMovement();

    // Apply corrected movement to kinematic body
    const currentPos = body.translation();
    body.setNextKinematicTranslation(
      new RAPIER.Vector2(currentPos.x + corrected.x, currentPos.y + corrected.y),
    );

    // 5. Update grounded state
    const wasGrounded = grounded;
    grounded = controller.computedGrounded();

    // Track last-grounded time for coyote time
    if (grounded) {
      lastGroundedTimeMs = elapsedMs;
    }

    // If we coyote-jumped, consume the window so we can't double-jump
    if (jumped && !wasGrounded) {
      lastGroundedTimeMs = -Infinity;
    }

    // 6. Detect wall contact + ground/wall surface from character controller collisions
    wallDir = 0;
    groundColliderHandle = null;
    let groundSurface: SurfaceMaterial | null = null;
    let wallSurface: SurfaceMaterial | null = null;
    const numCollisions = controller.numComputedCollisions();
    for (let i = 0; i < numCollisions; i++) {
      const collision = controller.computedCollision(i);
      if (!collision) continue;
      const nx = collision.normal1.x;
      const ny = collision.normal1.y;
      // Wall: mostly-horizontal normal
      if (Math.abs(nx) > WALL_NORMAL_THRESHOLD && wallDir === 0) {
        wallDir = nx > 0 ? -1 : 1;
        if (collision.collider) {
          wallSurface = getSurfaceMaterial(collision.collider.handle);
        }
      }
      // Ground: mostly-upward normal (ny < -0.7 in our +Y-down coords)
      if (ny < -WALL_NORMAL_THRESHOLD && collision.collider) {
        groundSurface = getSurfaceMaterial(collision.collider.handle);
        groundColliderHandle = collision.collider.handle;
      }
    }
    currentSurface = groundSurface;

    // 7. Wall contact: zero out horizontal velocity so direction changes are instant
    if (!grounded && wallDir !== 0) {
      // Pressing into the wall — kill horizontal velocity entirely
      const movingIntoWall =
        (wallDir === 1 && newVelocity.x > 0) || (wallDir === -1 && newVelocity.x < 0);
      if (movingIntoWall) {
        newVelocity.x = 0;
      }
    }

    // 8. Ceiling bonk: if we wanted to move up but were blocked, kill upward velocity
    if (desiredDelta.y < 0 && corrected.y > desiredDelta.y * 0.5) {
      // We wanted to go up but barely moved — hit a ceiling
      newVelocity.y = 0;
    }

    // 9. Wall-slide: airborne + touching wall + pressing into wall + falling
    //    Ice walls: no grip — can't wall-slide at all
    //    Chocolate walls: very sticky — much slower slide speed
    const pressingIntoWall = (wallDir === -1 && inputDir < 0) || (wallDir === 1 && inputDir > 0);
    const wallIsIce = wallSurface !== null && wallSurface.decelMultiplier < 0.1;
    wallSliding = !grounded && wallDir !== 0 && pressingIntoWall && newVelocity.y > 0 && !wallIsIce;

    // Track wall-slide coyote time
    if (wallSliding) {
      lastWallSlideTimeMs = elapsedMs;
      lastWallSlideDir = wallDir;
    }

    // 10. Apply surface modifiers
    if (grounded && currentSurface) {
      // Speed modifier (chocolate = 0.5×)
      if (currentSurface.speedMultiplier !== 1.0) {
        const maxSpd = MOVE_SPEED * currentSurface.speedMultiplier;
        if (Math.abs(newVelocity.x) > maxSpd) {
          newVelocity.x = Math.sign(newVelocity.x) * maxSpd;
        }
      }

      // Decel modifier applied retroactively: if we decelerated this frame,
      // scale the decel amount. computeDesiredMovement used full GROUND_DECEL,
      // but on ice we want much less. Re-lerp toward the pre-decel velocity.
      if (currentSurface.decelMultiplier !== 1.0 && inputDir === 0) {
        const preVx = velocity.x; // velocity from previous frame
        const postVx = newVelocity.x; // after standard decel
        // Blend: less decel = closer to preVx
        newVelocity.x = preVx + (postVx - preVx) * currentSurface.decelMultiplier;
        // Snap to zero to prevent floating-point oscillation
        if (Math.abs(newVelocity.x) < 0.5) newVelocity.x = 0;
      }

      // Trampoline bounce
      if (currentSurface.bounceVelocity !== 0) {
        newVelocity.y = currentSurface.bounceVelocity;
      }
    }

    // 10b. Bounce pad detection — check ground collisions for bounce pads
    for (let i = 0; i < numCollisions; i++) {
      const collision = controller.computedCollision(i);
      if (!collision || !collision.collider) continue;
      const pad = getBouncePad(collision.collider.handle);
      if (pad) {
        newVelocity.y = pad.bounceVelocity;
        break;
      }
    }

    // 10c. Wind zone — apply force if player is inside any wind zone
    const playerCenter = body.translation();
    for (const wz of getActiveWindZones()) {
      // Simple AABB check (ignoring rotation for now — TODO: rotated rect check)
      const dx = playerCenter.x - wz.position.x;
      const dy = playerCenter.y - wz.position.y;
      if (Math.abs(dx) < wz.hw && Math.abs(dy) < wz.hh) {
        newVelocity.x += wz.force.x * dtSec;
        newVelocity.y += wz.force.y * dtSec;
      }
    }

    // 11. Update velocity
    //     When grounded, apply a downward "stick" velocity to keep the character
    //     controller's desired delta large enough to maintain ground contact.
    //     For moving platforms: scale relative to the platform's Y delta so
    //     downward platforms are tracked. Skip entirely when the platform moves
    //     up — collision resolution handles upward push naturally.
    const BASE_STICK_VELOCITY = 100; // game units/sec — baseline for static ground
    let finalVx = newVelocity.x;
    let finalVy: number;
    if (grounded && newVelocity.y > 0 && (!currentSurface || currentSurface.bounceVelocity === 0)) {
      if (groundDeltaY < -0.01) {
        // Platform moving UP — don't apply stick velocity, collision handles it
        finalVy = 0;
      } else if (groundDeltaY > 0.01) {
        // Platform moving DOWN — stick velocity must exceed platform speed
        // Convert delta (units/frame) to velocity (units/sec) and add margin
        const platformVyPerSec = groundDeltaY * 60; // approximate at 60fps
        finalVy = platformVyPerSec + BASE_STICK_VELOCITY;
      } else {
        // Static ground — small constant keeps us grounded
        finalVy = BASE_STICK_VELOCITY;
      }
    } else {
      finalVy = newVelocity.y;
    }

    // 11. Wall-slide: cap fall speed (chocolate walls = extra sticky)
    if (wallSliding) {
      const wallIsChocolate = wallSurface !== null && wallSurface.speedMultiplier < 1.0;
      const slideSpeed = wallIsChocolate ? WALL_SLIDE_SPEED * 0.3 : WALL_SLIDE_SPEED;
      if (finalVy > slideSpeed) {
        finalVy = slideSpeed;
      }
    }

    // 12. Wall-jump: triggered while wall-sliding OR within wall-slide coyote window
    // Use wallDir if currently touching, otherwise use lastWallSlideDir from coyote
    const effectiveWallDir = wallDir !== 0 ? wallDir : withinWallSlideCoyote ? lastWallSlideDir : 0;
    if (jumped && effectiveWallDir !== 0 && !wasGrounded) {
      // Launch away from wall (use effectiveWallDir, not wallDir — may be coyote)
      finalVx = -effectiveWallDir * WALL_JUMP_FORCE.x;
      finalVy = WALL_JUMP_FORCE.y;
      // Lock out movement toward the wall for a short period
      wallJumpLockoutUntilMs = elapsedMs + WALL_JUMP_LOCKOUT_MS;
      wallJumpLockoutDir = effectiveWallDir as -1 | 1;
      wallSliding = false;
      lastJumpWasWallJump = true;
      // Consume wall-slide coyote so we can't double wall-jump
      lastWallSlideTimeMs = -Infinity;
    } else if (jumped || didDoubleJump) {
      // Normal, coyote, or double jump — allow variable height
      lastJumpWasWallJump = false;
    }

    velocity = { x: finalVx, y: finalVy };

    // 13. Reset wall state when grounded
    if (grounded) {
      wallSliding = false;
      wallDir = 0;
      lastJumpWasWallJump = false;
      if (hasDoubleJump) doubleJumpAvailable = true;
    }

    // Reset double-jump on wall-slide (wall gives you another chance)
    if (wallSliding && hasDoubleJump) {
      doubleJumpAvailable = true;
    }

    // 13. Derive movement state
    movementState = deriveMovementState(
      grounded,
      wallSliding,
      dashing,
      grappling,
      velocity.y,
      velocity.x,
    );

    // 14. Sync visual to physics body position
    const newPos = body.translation();
    graphics.position.set(newPos.x, newPos.y);
  }

  function getPosition(): Vec2 {
    const pos = body.translation();
    return { x: pos.x, y: pos.y };
  }

  function getVelocity(): Vec2 {
    return { ...velocity };
  }

  function isGrounded(): boolean {
    return grounded;
  }

  function isHoldingJump(): boolean {
    return holdingJump;
  }

  function isHoldingMove(): boolean {
    return holdingMove;
  }

  function isHoldingDown(): boolean {
    return heldActions.has("move_down");
  }

  function getHalfHeight(): number {
    return PLAYER_HEIGHT / 2;
  }

  function getGroundColliderHandle(): number | null {
    return groundColliderHandle;
  }

  function getWallDirection(): -1 | 0 | 1 {
    return wallDir;
  }

  function isWallSliding(): boolean {
    return wallSliding;
  }

  function getIsDashing(): boolean {
    return dashing;
  }

  function getIsGrappling(): boolean {
    return grappling;
  }

  function getMovementState(): MovementState {
    return movementState;
  }

  function getPreUpdateState() {
    return {
      position: { ...preUpdateState.position },
      velocity: { ...preUpdateState.velocity },
      grounded: preUpdateState.grounded,
    };
  }

  function destroy(): void {
    unregisterPlayerCollider(collider.handle);
    worldContainer.removeChild(graphics);
    graphics.destroy();
    try {
      physics.world.removeCharacterController(controller);
    } catch {
      // WASM pointer cleanup — safe to ignore
    }
    physics.removeRigidBody(body);
  }

  return {
    update,
    getPosition,
    getVelocity,
    isGrounded,
    isHoldingJump,
    isHoldingMove,
    isHoldingDown,
    getHalfHeight,
    getGroundColliderHandle,
    getWallDirection,
    isWallSliding,
    isDashing: getIsDashing,
    isGrappling: getIsGrappling,
    getMovementState,
    getPreUpdateState,
    destroy,
  };
}

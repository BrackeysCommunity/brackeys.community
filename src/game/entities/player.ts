import { type Container, Graphics } from "pixi.js"
import { PLAYER_COLLISION_GROUP, registerPlayerCollider, unregisterPlayerCollider } from "../collisions"
import type { PhysicsWorld } from "../physics"
import { getRapier } from "../physics"
import type { InputAction, Vec2 } from "../types"
import { getSurfaceMaterial, type SurfaceMaterial } from "../surfaces"

// ─── Movement config ─────────────────────────────────────
// All tunable constants in one place. Importable for tests, debug overlays, etc.

export type MovementConfig = {
	moveSpeed: number
	jumpVelocity: number
	gravity: number
	groundDecel: number
	jumpCutMultiplier: number
	airControl: number
	airReversalMultiplier: number
	airAccel: number
	maxFallSpeed: number
	coyoteTimeMs: number
	wallSlideSpeed: number
	wallJumpForce: { x: number; y: number }
	wallJumpLockoutMs: number
	wallSlideCoyoteMs: number
	cheeseWeightMultiplier: number
}

export const MOVEMENT_CONFIG: MovementConfig = {
	moveSpeed: 300,                // game units/sec
	jumpVelocity: -500,            // game units/sec (negative = up)
	gravity: 1200,                 // game units/sec²
	groundDecel: 2400,             // game units/sec² — rapid decel when no input
	jumpCutMultiplier: 0.4,        // multiply vy on jump release (variable height)
	airControl: 0.6,               // horizontal influence multiplier while airborne (0–1)
	airReversalMultiplier: 8.0,    // extra accel multiplier when input opposes velocity in air
	airAccel: 300 * 8,             // game units/sec² — acceleration rate in air
	maxFallSpeed: 900,             // game units/sec — terminal velocity cap
	coyoteTimeMs: 100,             // ms — grace period to jump after leaving ground
	wallSlideSpeed: 120,           // game units/sec — capped fall speed when wall-sliding
	wallJumpForce: { x: 350, y: -500 }, // launch velocity away from wall (1.5× normal jump)
	wallJumpLockoutMs: 180,        // ms — input lockout toward wall after wall-jump
	wallSlideCoyoteMs: 300,        // ms — wall-slide state maintained after releasing dir input
	cheeseWeightMultiplier: 0.85,  // jump velocity multiplier when carrying cheese
}

// Re-export individual constants for backward compat (tests, debug overlays)
export const MOVE_SPEED = MOVEMENT_CONFIG.moveSpeed
export const JUMP_VELOCITY = MOVEMENT_CONFIG.jumpVelocity
export const GRAVITY = MOVEMENT_CONFIG.gravity
export const GROUND_DECEL = MOVEMENT_CONFIG.groundDecel
export const JUMP_CUT_MULTIPLIER = MOVEMENT_CONFIG.jumpCutMultiplier
export const AIR_CONTROL = MOVEMENT_CONFIG.airControl
export const AIR_REVERSAL_MULTIPLIER = MOVEMENT_CONFIG.airReversalMultiplier
export const AIR_ACCEL = MOVEMENT_CONFIG.airAccel
export const MAX_FALL_SPEED = MOVEMENT_CONFIG.maxFallSpeed
export const COYOTE_TIME_MS = MOVEMENT_CONFIG.coyoteTimeMs
export const WALL_SLIDE_SPEED = MOVEMENT_CONFIG.wallSlideSpeed
export const WALL_JUMP_FORCE = MOVEMENT_CONFIG.wallJumpForce
export const WALL_JUMP_LOCKOUT_MS = MOVEMENT_CONFIG.wallJumpLockoutMs
export const WALL_SLIDE_COYOTE_MS = MOVEMENT_CONFIG.wallSlideCoyoteMs

const WALL_NORMAL_THRESHOLD = 0.7 // |normal.x| must exceed this to count as a wall
const PLAYER_WIDTH = 60
const PLAYER_HEIGHT = 60

// ─── Movement state machine ─────────────────────────────

export type MovementState = "idle" | "walking" | "jumping" | "falling" | "wall_sliding"

/** Derive the movement state from physical state. Pure function for testability. */
export function deriveMovementState(
	grounded: boolean,
	wallSliding: boolean,
	vy: number,
	vx: number,
): MovementState {
	if (wallSliding) return "wall_sliding"
	if (grounded) {
		return Math.abs(vx) > 1 ? "walking" : "idle"
	}
	return vy < 0 ? "jumping" : "falling"
}

export type PlayerEntity = {
	update: (dt: number, actions: InputAction[]) => void
	getPosition: () => Vec2
	getVelocity: () => Vec2
	isGrounded: () => boolean
	isHoldingJump: () => boolean
	isHoldingMove: () => boolean
	isHoldingDown: () => boolean
	/** Half the player collider height — used by cloud platform system */
	getHalfHeight: () => number
	/** -1 = wall on left, 0 = no wall, 1 = wall on right */
	getWallDirection: () => -1 | 0 | 1
	isWallSliding: () => boolean
	getMovementState: () => MovementState
	/** Position/velocity/grounded BEFORE this tick's update (for debug arc origin) */
	getPreUpdateState: () => { position: Vec2; velocity: Vec2; grounded: boolean }
	destroy: () => void
}

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
	let vx = velocity.x
	let vy = velocity.y
	let jumped = false

	// Track which movement actions are currently active
	const activeActions = new Set<string>()
	for (const action of actions) {
		if (action.pressed) {
			activeActions.add(action.action)
		} else {
			activeActions.delete(action.action)
		}
	}

	// Horizontal movement
	const wantsLeft = activeActions.has("move_left")
	const wantsRight = activeActions.has("move_right")
	const inputDir = (wantsRight ? 1 : 0) - (wantsLeft ? 1 : 0)

	if (grounded) {
		// Grounded: instant snap to target speed
		if (inputDir !== 0) {
			vx = inputDir * MOVE_SPEED
		} else {
			// No input — decelerate rapidly
			if (Math.abs(vx) < GROUND_DECEL * dtSec) {
				vx = 0
			} else {
				vx -= Math.sign(vx) * GROUND_DECEL * dtSec
			}
		}
	} else {
		// Airborne: accelerate toward target at reduced rate
		if (inputDir !== 0) {
			const targetVx = inputDir * MOVE_SPEED
			const diff = targetVx - vx
			// Reversing direction? (input opposes current velocity) — use higher multiplier
			const reversing = (vx > 0 && inputDir < 0) || (vx < 0 && inputDir > 0)
			const multiplier = reversing ? AIR_REVERSAL_MULTIPLIER : 1.0
			if (Math.abs(diff) > 1) {
				const accel = AIR_ACCEL * AIR_CONTROL * multiplier * dtSec
				if (Math.abs(diff) < accel) {
					vx = targetVx
				} else {
					vx += Math.sign(diff) * accel
				}
			}
		}
		// No deceleration in air when no input — preserve momentum
	}

	// Jump — only on fresh press, allowed if grounded / coyote / wall-sliding
	if (jumpPressedThisFrame && canJump) {
		const jumpVel = carryingCheese
			? JUMP_VELOCITY * MOVEMENT_CONFIG.cheeseWeightMultiplier
			: JUMP_VELOCITY
		vy = jumpVel
		jumped = true
	}

	// Variable jump height — cut upward velocity on jump release while rising
	if (jumpReleasedThisFrame && vy < 0) {
		vy *= JUMP_CUT_MULTIPLIER
	}

	// Gravity
	vy += GRAVITY * dtSec

	// Max fall speed cap
	if (vy > MAX_FALL_SPEED) {
		vy = MAX_FALL_SPEED
	}

	// Desired translation delta for this frame
	const desiredDelta: Vec2 = {
		x: vx * dtSec,
		y: vy * dtSec,
	}

	return { desiredDelta, newVelocity: { x: vx, y: vy }, jumped }
}

export function createPlayerEntity(
	worldContainer: Container,
	physics: PhysicsWorld,
): PlayerEntity {
	const RAPIER = getRapier()

	// ─── Visual ──────────────────────────────────────────
	const graphics = new Graphics()
	graphics.rect(0, 0, PLAYER_WIDTH, PLAYER_HEIGHT)
	graphics.fill({ color: 0xffa949 }) // Brackeys yellow
	graphics.pivot.set(PLAYER_WIDTH / 2, PLAYER_HEIGHT / 2)
	worldContainer.addChild(graphics)

	// ─── Physics body ────────────────────────────────────
	const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
		960,
		1020 - PLAYER_HEIGHT,
	)
	const body = physics.addRigidBody(bodyDesc)

	const colliderDesc = RAPIER.ColliderDesc.cuboid(
		PLAYER_WIDTH / 2,
		PLAYER_HEIGHT / 2,
	).setCollisionGroups(PLAYER_COLLISION_GROUP)
	const collider = physics.addCollider(colliderDesc, body)
	registerPlayerCollider(collider.handle)

	const controller = physics.createCharacterController()

	// ─── State ───────────────────────────────────────────
	let velocity: Vec2 = { x: 0, y: 0 }
	let grounded = true
	let holdingJump = false
	let holdingMove = false
	let movementState: MovementState = "idle"
	let lastGroundedTimeMs = 0 // timestamp (ms) of last frame we were grounded
	let elapsedMs = 0 // running game clock for coyote time tracking

	// Wall-slide / wall-jump state
	let wallDir: -1 | 0 | 1 = 0 // -1 = wall on left, 1 = wall on right, 0 = none
	let wallSliding = false
	let lastWallSlideTimeMs = -Infinity // timestamp of last frame we were actively wall-sliding
	let lastWallSlideDir: -1 | 0 | 1 = 0 // which wall we were sliding on (for coyote wall-jump)
	let wallJumpLockoutUntilMs = 0 // timestamp — ignore input toward wall until this time
	let wallJumpLockoutDir: -1 | 0 | 1 = 0 // which direction is locked out
	let currentSurface: SurfaceMaterial | null = null // surface we're standing on this tick
	let lastJumpWasWallJump = false // skip variable jump height for wall-jumps

	// Snapshot of state BEFORE each tick's update — for debug arc origin
	let preUpdateState = {
		position: { x: 960, y: 1020 - PLAYER_HEIGHT },
		velocity: { x: 0, y: 0 },
		grounded: true,
	}

	const heldActions = new Set<string>()

	function update(dt: number, actions: InputAction[]): void {
		elapsedMs += dt

		// Capture pre-update state BEFORE anything changes
		const pos = body.translation()
		preUpdateState = {
			position: { x: pos.x, y: pos.y },
			velocity: { ...velocity },
			grounded,
		}

		// Detect jump press/release transitions
		const wasHoldingJump = heldActions.has("jump")

		// Update held state from action events
		for (const action of actions) {
			if (action.pressed) {
				heldActions.add(action.action)
			} else {
				heldActions.delete(action.action)
			}
		}

		const jumpNowHeld = heldActions.has("jump")
		const jumpPressedThisFrame = !wasHoldingJump && jumpNowHeld
		const jumpReleasedThisFrame = wasHoldingJump && !jumpNowHeld
		holdingJump = jumpNowHeld
		holdingMove = heldActions.has("move_left") || heldActions.has("move_right")

		const dtSec = dt / 1000

		// Resolve input direction (factoring in wall-jump lockout)
		const wantsLeft = heldActions.has("move_left")
		const wantsRight = heldActions.has("move_right")
		let inputDir = (wantsRight ? 1 : 0) - (wantsLeft ? 1 : 0)

		// Wall-jump lockout: suppress input toward the wall we jumped off of
		if (elapsedMs < wallJumpLockoutUntilMs && inputDir === wallJumpLockoutDir) {
			inputDir = 0
		}

		// Build active actions with lockout applied (jump handled separately via jumpPressedThisFrame)
		const activeActions: InputAction[] = []
		if (inputDir < 0) activeActions.push({ action: "move_left", pressed: true, tick: 0, timestamp: 0 })
		if (inputDir > 0) activeActions.push({ action: "move_right", pressed: true, tick: 0, timestamp: 0 })

		// Coyote time: allow jump if grounded OR recently grounded OR recently wall-sliding
		const withinCoyoteWindow = (elapsedMs - lastGroundedTimeMs) < COYOTE_TIME_MS
		const withinWallSlideCoyote = (elapsedMs - lastWallSlideTimeMs) < WALL_SLIDE_COYOTE_MS
		const canJump = grounded || withinCoyoteWindow || wallSliding || withinWallSlideCoyote

		// Wall-jumps have fixed height — suppress variable jump cut
		const effectiveJumpRelease = lastJumpWasWallJump ? false : jumpReleasedThisFrame

		// 1. Compute desired movement from input + gravity
		const { desiredDelta, newVelocity, jumped } = computeDesiredMovement(
			velocity,
			activeActions,
			grounded,
			canJump,
			dtSec,
			jumpPressedThisFrame,
			effectiveJumpRelease,
		)

		// 2. Let Rapier's character controller resolve collisions.
		//    Cloud platform pass-through is handled by the CloudPlatformSystem
		//    entity, which runs before player.update() and sets each cloud's
		//    collision groups independently.
		controller.computeColliderMovement(
			collider,
			new RAPIER.Vector2(desiredDelta.x, desiredDelta.y),
		)

		// 5. Get the corrected movement (after collision resolution)
		const corrected = controller.computedMovement()

		// 4. Apply corrected movement to kinematic body
		const currentPos = body.translation()
		body.setNextKinematicTranslation(
			new RAPIER.Vector2(
				currentPos.x + corrected.x,
				currentPos.y + corrected.y,
			),
		)

		// 5. Update grounded state
		const wasGrounded = grounded
		grounded = controller.computedGrounded()

		// Track last-grounded time for coyote time
		if (grounded) {
			lastGroundedTimeMs = elapsedMs
		}

		// If we coyote-jumped, consume the window so we can't double-jump
		if (jumped && !wasGrounded) {
			lastGroundedTimeMs = -Infinity
		}

		// 6. Detect wall contact + ground/wall surface from character controller collisions
		wallDir = 0
		let groundSurface: SurfaceMaterial | null = null
		let wallSurface: SurfaceMaterial | null = null
		const numCollisions = controller.numComputedCollisions()
		for (let i = 0; i < numCollisions; i++) {
			const collision = controller.computedCollision(i)
			if (!collision) continue
			const nx = collision.normal1.x
			const ny = collision.normal1.y
			// Wall: mostly-horizontal normal
			if (Math.abs(nx) > WALL_NORMAL_THRESHOLD && wallDir === 0) {
				wallDir = nx > 0 ? -1 : 1
				if (collision.collider) {
					wallSurface = getSurfaceMaterial(collision.collider.handle)
				}
			}
			// Ground: mostly-upward normal (ny < -0.7 in our +Y-down coords)
			if (ny < -WALL_NORMAL_THRESHOLD && collision.collider) {
				groundSurface = getSurfaceMaterial(collision.collider.handle)
			}
		}
		currentSurface = groundSurface

		// 7. Wall contact: zero out horizontal velocity so direction changes are instant
		if (!grounded && wallDir !== 0) {
			// Pressing into the wall — kill horizontal velocity entirely
			const movingIntoWall = (wallDir === 1 && newVelocity.x > 0) || (wallDir === -1 && newVelocity.x < 0)
			if (movingIntoWall) {
				newVelocity.x = 0
			}
		}

		// 8. Ceiling bonk: if we wanted to move up but were blocked, kill upward velocity
		if (desiredDelta.y < 0 && corrected.y > desiredDelta.y * 0.5) {
			// We wanted to go up but barely moved — hit a ceiling
			newVelocity.y = 0
		}

		// 9. Wall-slide: airborne + touching wall + pressing into wall + falling
		//    Ice walls: no grip — can't wall-slide at all
		//    Chocolate walls: very sticky — much slower slide speed
		const pressingIntoWall = (wallDir === -1 && inputDir < 0) || (wallDir === 1 && inputDir > 0)
		const wallIsIce = wallSurface !== null && wallSurface.decelMultiplier < 0.1
		wallSliding = !grounded && wallDir !== 0 && pressingIntoWall && newVelocity.y > 0 && !wallIsIce

		// Track wall-slide coyote time
		if (wallSliding) {
			lastWallSlideTimeMs = elapsedMs
			lastWallSlideDir = wallDir
		}

		// 10. Apply surface modifiers
		if (grounded && currentSurface) {
			// Speed modifier (chocolate = 0.5×)
			if (currentSurface.speedMultiplier !== 1.0) {
				const maxSpd = MOVE_SPEED * currentSurface.speedMultiplier
				if (Math.abs(newVelocity.x) > maxSpd) {
					newVelocity.x = Math.sign(newVelocity.x) * maxSpd
				}
			}

			// Decel modifier applied retroactively: if we decelerated this frame,
			// scale the decel amount. computeDesiredMovement used full GROUND_DECEL,
			// but on ice we want much less. Re-lerp toward the pre-decel velocity.
			if (currentSurface.decelMultiplier !== 1.0 && inputDir === 0) {
				const preVx = velocity.x // velocity from previous frame
				const postVx = newVelocity.x // after standard decel
				// Blend: less decel = closer to preVx
				newVelocity.x = preVx + (postVx - preVx) * currentSurface.decelMultiplier
				// Snap to zero to prevent floating-point oscillation
				if (Math.abs(newVelocity.x) < 0.5) newVelocity.x = 0
			}

			// Trampoline bounce
			if (currentSurface.bounceVelocity !== 0) {
				newVelocity.y = currentSurface.bounceVelocity
			}
		}

		// 11. Update velocity
		let finalVx = newVelocity.x
		let finalVy = grounded && newVelocity.y > 0 && (!currentSurface || currentSurface.bounceVelocity === 0) ? 0 : newVelocity.y

		// 11. Wall-slide: cap fall speed (chocolate walls = extra sticky)
		if (wallSliding) {
			const wallIsChocolate = wallSurface !== null && wallSurface.speedMultiplier < 1.0
			const slideSpeed = wallIsChocolate ? WALL_SLIDE_SPEED * 0.3 : WALL_SLIDE_SPEED
			if (finalVy > slideSpeed) {
				finalVy = slideSpeed
			}
		}

		// 12. Wall-jump: triggered while wall-sliding OR within wall-slide coyote window
		// Use wallDir if currently touching, otherwise use lastWallSlideDir from coyote
		const effectiveWallDir = wallDir !== 0 ? wallDir : (withinWallSlideCoyote ? lastWallSlideDir : 0)
		if (jumped && effectiveWallDir !== 0 && !wasGrounded) {
			// Launch away from wall (use effectiveWallDir, not wallDir — may be coyote)
			finalVx = -effectiveWallDir * WALL_JUMP_FORCE.x
			finalVy = WALL_JUMP_FORCE.y
			// Lock out movement toward the wall for a short period
			wallJumpLockoutUntilMs = elapsedMs + WALL_JUMP_LOCKOUT_MS
			wallJumpLockoutDir = effectiveWallDir as -1 | 1
			wallSliding = false
			lastJumpWasWallJump = true
			// Consume wall-slide coyote so we can't double wall-jump
			lastWallSlideTimeMs = -Infinity
		} else if (jumped) {
			// Normal or coyote jump — allow variable height
			lastJumpWasWallJump = false
		}

		velocity = { x: finalVx, y: finalVy }

		// 13. Reset wall state when grounded
		if (grounded) {
			wallSliding = false
			wallDir = 0
			lastJumpWasWallJump = false
		}

		// 13. Derive movement state
		movementState = deriveMovementState(grounded, wallSliding, velocity.y, velocity.x)

		// 14. Sync visual to physics body position
		const newPos = body.translation()
		graphics.position.set(newPos.x, newPos.y)
	}

	function getPosition(): Vec2 {
		const pos = body.translation()
		return { x: pos.x, y: pos.y }
	}

	function getVelocity(): Vec2 {
		return { ...velocity }
	}

	function isGrounded(): boolean {
		return grounded
	}

	function isHoldingJump(): boolean {
		return holdingJump
	}

	function isHoldingMove(): boolean {
		return holdingMove
	}

	function isHoldingDown(): boolean {
		return heldActions.has("move_down")
	}

	function getHalfHeight(): number {
		return PLAYER_HEIGHT / 2
	}

	function getWallDirection(): -1 | 0 | 1 {
		return wallDir
	}

	function isWallSliding(): boolean {
		return wallSliding
	}

	function getMovementState(): MovementState {
		return movementState
	}

	function getPreUpdateState() {
		return {
			position: { ...preUpdateState.position },
			velocity: { ...preUpdateState.velocity },
			grounded: preUpdateState.grounded,
		}
	}

	function destroy(): void {
		unregisterPlayerCollider(collider.handle)
		worldContainer.removeChild(graphics)
		graphics.destroy()
		try {
			physics.world.removeCharacterController(controller)
		} catch {
			// WASM pointer cleanup — safe to ignore
		}
		physics.removeRigidBody(body)
	}

	return {
		update, getPosition, getVelocity, isGrounded,
		isHoldingJump, isHoldingMove, isHoldingDown, getHalfHeight,
		getWallDirection, isWallSliding,
		getMovementState, getPreUpdateState, destroy,
	}
}

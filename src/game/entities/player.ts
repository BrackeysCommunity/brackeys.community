import { type Container, Graphics } from "pixi.js"
import type { PhysicsWorld } from "../physics"
import { getRapier } from "../physics"
import type { InputAction, Vec2 } from "../types"

// ─── Player constants ────────────────────────────────────

export const MOVE_SPEED = 300 // game units/sec
export const JUMP_VELOCITY = -500 // game units/sec (negative = up)
export const GRAVITY = 1200 // game units/sec²
export const GROUND_DECEL = 2400 // game units/sec² — rapid deceleration when no input
export const JUMP_CUT_MULTIPLIER = 0.4 // multiply vy by this on jump release (variable height)
export const AIR_CONTROL = 0.6 // horizontal influence multiplier while airborne (0–1)
export const AIR_REVERSAL_MULTIPLIER = 8.0 // extra accel multiplier when input opposes current velocity in air
export const AIR_ACCEL = MOVE_SPEED * 8 // game units/sec² — acceleration rate in air
export const MAX_FALL_SPEED = 900 // game units/sec — terminal velocity cap
export const COYOTE_TIME_MS = 100 // ms — grace period to jump after leaving ground
export const WALL_SLIDE_SPEED = 120 // game units/sec — capped fall speed when wall-sliding
export const WALL_JUMP_FORCE = { x: 350, y: -500 } // launch velocity away from wall (1.5× normal jump height)
export const WALL_JUMP_LOCKOUT_MS = 180 // ms — time before player can move toward the wall again after wall-jump
const WALL_NORMAL_THRESHOLD = 0.7 // |normal.x| must exceed this to count as a wall
const PLAYER_WIDTH = 60
const PLAYER_HEIGHT = 60

export type PlayerEntity = {
	update: (dt: number, actions: InputAction[]) => void
	getPosition: () => Vec2
	getVelocity: () => Vec2
	isGrounded: () => boolean
	isHoldingJump: () => boolean
	isHoldingMove: () => boolean
	/** -1 = wall on left, 0 = no wall, 1 = wall on right */
	getWallDirection: () => -1 | 0 | 1
	isWallSliding: () => boolean
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
		vy = JUMP_VELOCITY
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
	)
	const collider = physics.addCollider(colliderDesc, body)

	const controller = physics.createCharacterController()

	// ─── State ───────────────────────────────────────────
	let velocity: Vec2 = { x: 0, y: 0 }
	let grounded = true
	let holdingJump = false
	let holdingMove = false
	let lastGroundedTimeMs = 0 // timestamp (ms) of last frame we were grounded
	let elapsedMs = 0 // running game clock for coyote time tracking

	// Wall-slide / wall-jump state
	let wallDir: -1 | 0 | 1 = 0 // -1 = wall on left, 1 = wall on right, 0 = none
	let wallSliding = false
	let wallJumpLockoutUntilMs = 0 // timestamp — ignore input toward wall until this time
	let wallJumpLockoutDir: -1 | 0 | 1 = 0 // which direction is locked out
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

		// Coyote time: allow jump if grounded OR recently grounded
		const withinCoyoteWindow = (elapsedMs - lastGroundedTimeMs) < COYOTE_TIME_MS
		const canJump = grounded || withinCoyoteWindow || wallSliding

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

		// 2. Let Rapier's character controller resolve collisions
		controller.computeColliderMovement(collider, new RAPIER.Vector2(desiredDelta.x, desiredDelta.y))

		// 3. Get the corrected movement (after collision resolution)
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

		// 6. Detect wall contact from character controller collisions
		wallDir = 0
		const numCollisions = controller.numComputedCollisions()
		for (let i = 0; i < numCollisions; i++) {
			const collision = controller.computedCollision(i)
			if (!collision) continue
			const nx = collision.normal1.x
			// A wall normal points away from the wall surface.
			// If normal points right (nx > threshold), the wall is on the LEFT.
			// If normal points left (nx < -threshold), the wall is on the RIGHT.
			if (Math.abs(nx) > WALL_NORMAL_THRESHOLD) {
				wallDir = nx > 0 ? -1 : 1
				break
			}
		}

		// 7. Wall contact: zero out horizontal velocity so direction changes are instant
		if (!grounded && wallDir !== 0) {
			// Pressing into the wall — kill horizontal velocity entirely
			const movingIntoWall = (wallDir === 1 && newVelocity.x > 0) || (wallDir === -1 && newVelocity.x < 0)
			if (movingIntoWall) {
				newVelocity.x = 0
			}
		}

		// 8. Wall-slide: airborne + touching wall + pressing into wall + falling
		const pressingIntoWall = (wallDir === -1 && inputDir < 0) || (wallDir === 1 && inputDir > 0)
		wallSliding = !grounded && wallDir !== 0 && pressingIntoWall && newVelocity.y > 0

		// 9. Update velocity
		let finalVx = newVelocity.x
		let finalVy = grounded && newVelocity.y > 0 ? 0 : newVelocity.y

		// 10. Wall-slide: cap fall speed
		if (wallSliding && finalVy > WALL_SLIDE_SPEED) {
			finalVy = WALL_SLIDE_SPEED
		}

		// 11. Wall-jump: if jump was triggered while wall-sliding, apply wall-jump force
		if (jumped && wallDir !== 0 && !wasGrounded) {
			// Launch away from wall
			finalVx = -wallDir * WALL_JUMP_FORCE.x
			finalVy = WALL_JUMP_FORCE.y
			// Lock out movement toward the wall for a short period
			wallJumpLockoutUntilMs = elapsedMs + WALL_JUMP_LOCKOUT_MS
			wallJumpLockoutDir = wallDir as -1 | 1
			wallSliding = false
			lastJumpWasWallJump = true
		} else if (jumped) {
			// Normal or coyote jump — allow variable height
			lastJumpWasWallJump = false
		}

		velocity = { x: finalVx, y: finalVy }

		// 12. Reset wall state when grounded
		if (grounded) {
			wallSliding = false
			wallDir = 0
			lastJumpWasWallJump = false
		}

		// 13. Sync visual to physics body position
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

	function getWallDirection(): -1 | 0 | 1 {
		return wallDir
	}

	function isWallSliding(): boolean {
		return wallSliding
	}

	function getPreUpdateState() {
		return {
			position: { ...preUpdateState.position },
			velocity: { ...preUpdateState.velocity },
			grounded: preUpdateState.grounded,
		}
	}

	function destroy(): void {
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
		isHoldingJump, isHoldingMove, getWallDirection, isWallSliding,
		getPreUpdateState, destroy,
	}
}

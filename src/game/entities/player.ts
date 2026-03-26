import { Graphics, type Container } from "pixi.js"
import type { InputAction, Vec2 } from "../types"
import { getRapier } from "../physics"
import type { PhysicsWorld } from "../physics"
import type RAPIER from "@dimforge/rapier2d"

// ─── Player constants ────────────────────────────────────

export const MOVE_SPEED = 300 // game units/sec
export const JUMP_VELOCITY = -500 // game units/sec (negative = up)
export const GRAVITY = 1200 // game units/sec²
export const GROUND_DECEL = 2400 // game units/sec² — rapid deceleration when no input
export const JUMP_CUT_MULTIPLIER = 0.4 // multiply vy by this on jump release (variable height)
const PLAYER_WIDTH = 60
const PLAYER_HEIGHT = 60

export type PlayerEntity = {
	update: (dt: number, actions: InputAction[]) => void
	getPosition: () => Vec2
	getVelocity: () => Vec2
	isGrounded: () => boolean
	isHoldingJump: () => boolean
	isHoldingMove: () => boolean
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
	dtSec: number,
	jumpHeld: boolean,
	jumpReleasedThisFrame: boolean,
): { desiredDelta: Vec2; newVelocity: Vec2 } {
	let vx = velocity.x
	let vy = velocity.y

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

	if (wantsLeft && !wantsRight) {
		vx = -MOVE_SPEED
	} else if (wantsRight && !wantsLeft) {
		vx = MOVE_SPEED
	} else if (!wantsLeft && !wantsRight) {
		// No input — decelerate rapidly
		if (Math.abs(vx) < GROUND_DECEL * dtSec) {
			vx = 0
		} else {
			vx -= Math.sign(vx) * GROUND_DECEL * dtSec
		}
	} else {
		// Both pressed — cancel out, decelerate
		if (Math.abs(vx) < GROUND_DECEL * dtSec) {
			vx = 0
		} else {
			vx -= Math.sign(vx) * GROUND_DECEL * dtSec
		}
	}

	// Jump — only if on the ground
	if (activeActions.has("jump") && grounded) {
		vy = JUMP_VELOCITY
	}

	// Variable jump height — cut upward velocity on jump release while rising
	if (jumpReleasedThisFrame && vy < 0) {
		vy *= JUMP_CUT_MULTIPLIER
	}

	// Gravity
	vy += GRAVITY * dtSec

	// Desired translation delta for this frame
	const desiredDelta: Vec2 = {
		x: vx * dtSec,
		y: vy * dtSec,
	}

	return { desiredDelta, newVelocity: { x: vx, y: vy } }
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

	// Snapshot of state BEFORE each tick's update — for debug arc origin
	let preUpdateState = {
		position: { x: 960, y: 1020 - PLAYER_HEIGHT },
		velocity: { x: 0, y: 0 },
		grounded: true,
	}

	const heldActions = new Set<string>()

	function update(dt: number, actions: InputAction[]): void {
		// Capture pre-update state BEFORE anything changes
		const pos = body.translation()
		preUpdateState = {
			position: { x: pos.x, y: pos.y },
			velocity: { ...velocity },
			grounded,
		}

		// Detect jump release this frame (was held, now released)
		const wasHoldingJump = heldActions.has("jump")

		// Update held state from action events
		for (const action of actions) {
			if (action.pressed) {
				heldActions.add(action.action)
			} else {
				heldActions.delete(action.action)
			}
		}

		const jumpReleasedThisFrame = wasHoldingJump && !heldActions.has("jump")
		holdingJump = heldActions.has("jump")
		holdingMove = heldActions.has("move_left") || heldActions.has("move_right")

		const activeActions: InputAction[] = Array.from(heldActions).map(
			(action) => ({
				action,
				pressed: true,
				tick: 0,
				timestamp: 0,
			}),
		)

		const dtSec = dt / 1000

		// 1. Compute desired movement from input + gravity
		const { desiredDelta, newVelocity } = computeDesiredMovement(
			velocity,
			activeActions,
			grounded,
			dtSec,
			holdingJump,
			jumpReleasedThisFrame,
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
		grounded = controller.computedGrounded()

		// 6. Update velocity — zero out Y if grounded (landed)
		velocity = {
			x: newVelocity.x,
			y: grounded && newVelocity.y > 0 ? 0 : newVelocity.y,
		}

		// 7. Sync visual to physics body position
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
		isHoldingJump, isHoldingMove, getPreUpdateState, destroy,
	}
}

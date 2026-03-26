import { Graphics, type Container } from "pixi.js"
import type { InputAction, Vec2 } from "../types"
import { getRapier } from "../physics"
import type { PhysicsWorld } from "../physics"
import type RAPIER from "@dimforge/rapier2d"

// ─── Player constants ────────────────────────────────────

const MOVE_SPEED = 300 // game units/sec
const JUMP_VELOCITY = -500 // game units/sec (negative = up)
const GRAVITY = 1200 // game units/sec²
const PLAYER_WIDTH = 60
const PLAYER_HEIGHT = 60

export type PlayerEntity = {
	update: (dt: number, actions: InputAction[]) => void
	getPosition: () => Vec2
	getVelocity: () => Vec2
	isGrounded: () => boolean
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
): { desiredDelta: Vec2; newVelocity: Vec2 } {
	let vx = 0
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
	if (activeActions.has("move_left")) vx -= MOVE_SPEED
	if (activeActions.has("move_right")) vx += MOVE_SPEED

	// Jump — only if on the ground
	if (activeActions.has("jump") && grounded) {
		vy = JUMP_VELOCITY
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
	// KinematicPositionBased — we control position via the character controller
	const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
		960,
		1020 - PLAYER_HEIGHT, // Start at floor level
	)
	const body = physics.addRigidBody(bodyDesc)

	// Cuboid collider (half-extents)
	const colliderDesc = RAPIER.ColliderDesc.cuboid(
		PLAYER_WIDTH / 2,
		PLAYER_HEIGHT / 2,
	)
	const collider = physics.addCollider(colliderDesc, body)

	// Character controller for collision resolution
	const controller = physics.createCharacterController()

	// ─── State ───────────────────────────────────────────
	let velocity: Vec2 = { x: 0, y: 0 }
	let grounded = true

	// Track held keys across ticks (since actions are press/release events)
	const heldActions = new Set<string>()

	function update(dt: number, actions: InputAction[]): void {
		// Update held state from action events
		for (const action of actions) {
			if (action.pressed) {
				heldActions.add(action.action)
			} else {
				heldActions.delete(action.action)
			}
		}

		// Build synthetic "active" actions from held state
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
		const pos = body.translation()
		graphics.position.set(pos.x, pos.y)
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

	return { update, getPosition, getVelocity, isGrounded, destroy }
}

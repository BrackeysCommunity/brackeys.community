import { Graphics, type Container } from "pixi.js"
import type { InputAction, Vec2 } from "../types"

// ─── Physics constants (placeholder — will be replaced by Rapier) ────

const MOVE_SPEED = 300 // game units/sec
const JUMP_VELOCITY = -500 // game units/sec (negative = up)
const GRAVITY = 1200 // game units/sec²
const FLOOR_Y = 1020 // near bottom of 1080-unit virtual height (1080 - 60)
const PLAYER_WIDTH = 60
const PLAYER_HEIGHT = 60

export type PlayerEntity = {
	update: (dt: number, actions: InputAction[]) => void
	getPosition: () => Vec2
	getVelocity: () => Vec2
	destroy: () => void
}

/**
 * Extract pure movement logic for testability.
 * Takes dt in SECONDS (caller converts from ms).
 */
export function applyPlayerPhysics(
	position: Vec2,
	velocity: Vec2,
	actions: InputAction[],
	dtSec: number,
): { position: Vec2; velocity: Vec2 } {
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
	const onGround = position.y >= FLOOR_Y - PLAYER_HEIGHT
	if (activeActions.has("jump") && onGround) {
		vy = JUMP_VELOCITY
	}

	// Gravity
	vy += GRAVITY * dtSec

	// Integrate
	const newX = position.x + vx * dtSec
	let newY = position.y + vy * dtSec

	// Floor collision
	if (newY >= FLOOR_Y - PLAYER_HEIGHT) {
		newY = FLOOR_Y - PLAYER_HEIGHT
		vy = 0
	}

	return {
		position: { x: newX, y: newY },
		velocity: { x: vx, y: vy },
	}
}

export function createPlayerEntity(worldContainer: Container): PlayerEntity {
	const graphics = new Graphics()

	// Draw a placeholder rectangle
	graphics.rect(0, 0, PLAYER_WIDTH, PLAYER_HEIGHT)
	graphics.fill({ color: 0xffa949 }) // Brackeys yellow

	// Set pivot to center
	graphics.pivot.set(PLAYER_WIDTH / 2, PLAYER_HEIGHT / 2)

	worldContainer.addChild(graphics)

	let position: Vec2 = { x: 960, y: FLOOR_Y - PLAYER_HEIGHT }
	let velocity: Vec2 = { x: 0, y: 0 }

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

		// Build synthetic "active" actions from held state for physics
		const activeActions: InputAction[] = Array.from(heldActions).map(
			(action) => ({
				action,
				pressed: true,
				tick: 0,
				timestamp: 0,
			}),
		)

		const dtSec = dt / 1000
		const result = applyPlayerPhysics(position, velocity, activeActions, dtSec)
		position = result.position
		velocity = result.velocity

		// Update visual
		graphics.position.set(position.x, position.y)
	}

	function getPosition(): Vec2 {
		return { ...position }
	}

	function getVelocity(): Vec2 {
		return { ...velocity }
	}

	function destroy(): void {
		worldContainer.removeChild(graphics)
		graphics.destroy()
	}

	return { update, getPosition, getVelocity, destroy }
}

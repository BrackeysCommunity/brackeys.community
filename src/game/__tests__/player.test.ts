import { describe, expect, it } from "vitest"
import { applyPlayerPhysics } from "../entities/player"
import type { InputAction } from "../types"

function makeAction(
	action: string,
	pressed = true,
): InputAction {
	return { action, pressed, tick: 0, timestamp: 0 }
}

describe("applyPlayerPhysics", () => {
	const dt = 1 / 60 // 1 frame at 60fps

	it("applies gravity when in the air", () => {
		const result = applyPlayerPhysics(
			{ x: 400, y: 100 },
			{ x: 0, y: 0 },
			[],
			dt,
		)

		// y velocity should increase (gravity pulls down)
		expect(result.velocity.y).toBeGreaterThan(0)
		// position should move down
		expect(result.position.y).toBeGreaterThan(100)
	})

	it("stops at the floor", () => {
		const result = applyPlayerPhysics(
			{ x: 400, y: 459 }, // just above floor (floor=500, height=40, so 500-40=460)
			{ x: 0, y: 100 },
			[],
			dt,
		)

		// Should clamp to floor
		expect(result.position.y).toBe(460)
		expect(result.velocity.y).toBe(0)
	})

	it("moves left when move_left action is active", () => {
		const result = applyPlayerPhysics(
			{ x: 400, y: 460 },
			{ x: 0, y: 0 },
			[makeAction("move_left")],
			dt,
		)

		expect(result.position.x).toBeLessThan(400)
	})

	it("moves right when move_right action is active", () => {
		const result = applyPlayerPhysics(
			{ x: 400, y: 460 },
			{ x: 0, y: 0 },
			[makeAction("move_right")],
			dt,
		)

		expect(result.position.x).toBeGreaterThan(400)
	})

	it("jumps when on the ground and jump action is active", () => {
		const result = applyPlayerPhysics(
			{ x: 400, y: 460 }, // on the floor (floor=500, height=40)
			{ x: 0, y: 0 },
			[makeAction("jump")],
			dt,
		)

		// Should have upward velocity
		expect(result.velocity.y).toBeLessThan(0)
		// Should move up
		expect(result.position.y).toBeLessThan(460)
	})

	it("does not jump when in the air", () => {
		const result = applyPlayerPhysics(
			{ x: 400, y: 200 }, // well above floor
			{ x: 0, y: -100 },
			[makeAction("jump")],
			dt,
		)

		// Velocity should continue as before (gravity applied, but no jump boost)
		// The jump should NOT have set velocity to JUMP_VELOCITY
		expect(result.velocity.y).toBeGreaterThan(-200) // gravity pulls it back
	})

	it("cancels movement on release", () => {
		// Release move_right
		const result = applyPlayerPhysics(
			{ x: 400, y: 460 },
			{ x: 300, y: 0 },
			[makeAction("move_right", false)],
			dt,
		)

		// Horizontal velocity should be 0 (no active movement)
		expect(result.velocity.x).toBe(0)
	})

	it("allows simultaneous left and right (cancel out)", () => {
		const result = applyPlayerPhysics(
			{ x: 400, y: 460 },
			{ x: 0, y: 0 },
			[makeAction("move_left"), makeAction("move_right")],
			dt,
		)

		// Left and right cancel out
		expect(result.position.x).toBe(400)
	})
})

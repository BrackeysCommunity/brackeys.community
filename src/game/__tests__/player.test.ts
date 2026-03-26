import { describe, expect, it } from "vitest"
import { computeDesiredMovement } from "../entities/player"
import type { InputAction } from "../types"

function makeAction(
	action: string,
	pressed = true,
): InputAction {
	return { action, pressed, tick: 0, timestamp: 0 }
}

describe("computeDesiredMovement", () => {
	const dt = 1 / 60 // 1 frame at 60fps

	it("applies gravity when in the air", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 },
			[],
			false, // not grounded
			dt,
		)

		// y velocity should increase (gravity pulls down)
		expect(result.newVelocity.y).toBeGreaterThan(0)
		// desired delta should move down
		expect(result.desiredDelta.y).toBeGreaterThan(0)
	})

	it("produces leftward delta when move_left is active", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 },
			[makeAction("move_left")],
			true, // grounded
			dt,
		)

		expect(result.desiredDelta.x).toBeLessThan(0)
	})

	it("produces rightward delta when move_right is active", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 },
			[makeAction("move_right")],
			true,
			dt,
		)

		expect(result.desiredDelta.x).toBeGreaterThan(0)
	})

	it("jumps when grounded and jump action is active", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 },
			[makeAction("jump")],
			true, // grounded
			dt,
		)

		// Should have upward velocity
		expect(result.newVelocity.y).toBeLessThan(0)
		// Desired delta should be upward
		expect(result.desiredDelta.y).toBeLessThan(0)
	})

	it("does not jump when in the air", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: -100 },
			[makeAction("jump")],
			false, // not grounded
			dt,
		)

		// Velocity should continue with gravity, but no jump boost applied
		// Starting at -100, gravity adds ~20/frame, so should be around -80
		expect(result.newVelocity.y).toBeGreaterThan(-200)
	})

	it("cancels movement on release", () => {
		const result = computeDesiredMovement(
			{ x: 300, y: 0 },
			[makeAction("move_right", false)],
			true,
			dt,
		)

		// No horizontal movement
		expect(result.desiredDelta.x).toBe(0)
	})

	it("left and right cancel out", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 },
			[makeAction("move_left"), makeAction("move_right")],
			true,
			dt,
		)

		// Left and right cancel out
		expect(result.desiredDelta.x).toBe(0)
	})

	it("gravity still applies when grounded (controller handles floor)", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 },
			[],
			true,
			dt,
		)

		// Gravity is always applied — the character controller
		// prevents actual downward movement when on the ground
		expect(result.newVelocity.y).toBeGreaterThan(0)
	})
})

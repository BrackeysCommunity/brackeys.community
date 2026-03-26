import { describe, expect, it } from "vitest"
import { computeDesiredMovement, JUMP_VELOCITY, JUMP_CUT_MULTIPLIER } from "../entities/player"
import type { InputAction } from "../types"

function makeAction(
	action: string,
	pressed = true,
): InputAction {
	return { action, pressed, tick: 0, timestamp: 0 }
}

// Default: jump held, not released this frame
const JUMP_HELD = true
const NO_JUMP_RELEASE = false
const JUMP_NOT_HELD = false
const JUMP_RELEASED = true

describe("computeDesiredMovement", () => {
	const dt = 1 / 60

	it("applies gravity when in the air", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 }, [], false, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.y).toBeGreaterThan(0)
		expect(result.desiredDelta.y).toBeGreaterThan(0)
	})

	it("produces leftward delta when move_left is active", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 }, [makeAction("move_left")], true, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.desiredDelta.x).toBeLessThan(0)
	})

	it("produces rightward delta when move_right is active", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 }, [makeAction("move_right")], true, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.desiredDelta.x).toBeGreaterThan(0)
	})

	it("jumps when grounded and jump action is active", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 }, [makeAction("jump")], true, dt, JUMP_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.y).toBeLessThan(0)
		expect(result.desiredDelta.y).toBeLessThan(0)
	})

	it("does not jump when in the air", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: -100 }, [makeAction("jump")], false, dt, JUMP_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.y).toBeGreaterThan(-200)
	})

	it("decelerates when no horizontal input", () => {
		const result = computeDesiredMovement(
			{ x: 300, y: 0 }, [], true, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.x).toBeLessThan(300)
		expect(result.newVelocity.x).toBeGreaterThanOrEqual(0)
	})

	it("snaps to zero when velocity is small and no input", () => {
		const result = computeDesiredMovement(
			{ x: 5, y: 0 }, [], true, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.x).toBe(0)
		expect(result.desiredDelta.x).toBe(0)
	})

	it("left and right cancel out and decelerate", () => {
		const result = computeDesiredMovement(
			{ x: 200, y: 0 },
			[makeAction("move_left"), makeAction("move_right")],
			true, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.x).toBeLessThan(200)
	})

	it("gravity still applies when grounded", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 }, [], true, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.y).toBeGreaterThan(0)
	})

	it("overrides velocity to full speed on fresh input", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 0 }, [makeAction("move_right")], true, dt, JUMP_NOT_HELD, NO_JUMP_RELEASE,
		)
		expect(result.newVelocity.x).toBe(300)
	})
})

// ─── Variable jump height ────────────────────────────────

describe("variable jump height", () => {
	const dt = 1 / 60

	it("cuts upward velocity on jump release while rising", () => {
		// Simulate: player jumped, now rising at JUMP_VELOCITY, releases jump mid-rise
		const result = computeDesiredMovement(
			{ x: 0, y: JUMP_VELOCITY }, // rising at full jump speed
			[], // no actions
			false, // airborne
			dt,
			JUMP_NOT_HELD,
			JUMP_RELEASED, // released this frame
		)

		// vy should be cut: JUMP_VELOCITY * CUT_MULTIPLIER + gravity*dt
		const expectedCutVy = JUMP_VELOCITY * JUMP_CUT_MULTIPLIER
		const expectedFinal = expectedCutVy + 1200 * dt

		expect(result.newVelocity.y).toBeCloseTo(expectedFinal, 1)
		// Cut velocity should be much less negative than full jump
		expect(result.newVelocity.y).toBeGreaterThan(JUMP_VELOCITY)
	})

	it("does not cut velocity when jump is still held", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: JUMP_VELOCITY }, // rising at full jump speed
			[makeAction("jump")],
			false,
			dt,
			JUMP_HELD,
			NO_JUMP_RELEASE, // NOT released
		)

		// No cut applied, just gravity: JUMP_VELOCITY + GRAVITY * dt
		const expected = JUMP_VELOCITY + 1200 * dt
		expect(result.newVelocity.y).toBeCloseTo(expected, 1)
		expect(result.newVelocity.y).toBeLessThan(0) // still rising
	})

	it("does not cut velocity when falling (vy > 0)", () => {
		const result = computeDesiredMovement(
			{ x: 0, y: 100 }, // falling
			[],
			false,
			dt,
			JUMP_NOT_HELD,
			JUMP_RELEASED, // released, but already falling
		)

		// vy was positive (falling), cut should not apply (only cuts when vy < 0)
		// Result should just be: 100 + gravity*dt
		expect(result.newVelocity.y).toBeCloseTo(100 + 1200 * dt, 1)
	})
})

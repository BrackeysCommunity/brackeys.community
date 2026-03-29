import type { Vec2 } from "../types"
import { GRAVITY } from "./player"

/** Minimum angular velocity when attaching to a grapple (rad/sec).
 *  Ensures every grapple gives meaningful swing even from a near-standstill. */
const MIN_ANGULAR_VELOCITY = 2.5

/**
 * Manual pendulum physics for the grapple system.
 * The player is kinematic, so we can't use Rapier joints.
 * Instead: track angle + angular velocity around the anchor,
 * apply tangential gravity, and constrain to the rope length.
 */

export type GrappleSwingState = {
	anchorPos: Vec2
	ropeLength: number
	/** Angle in radians from anchor. 0 = directly below, +/- = left/right */
	angle: number
	/** Angular velocity in radians/sec */
	angularVel: number
}

/**
 * Initialize swing state from player and anchor positions.
 * Captures the initial rope length and angle.
 */
export function initSwingState(
	playerPos: Vec2,
	anchorPos: Vec2,
	playerVelocity: Vec2,
): GrappleSwingState {
	const dx = playerPos.x - anchorPos.x
	const dy = playerPos.y - anchorPos.y
	const ropeLength = Math.sqrt(dx * dx + dy * dy)
	// Angle: atan2 measured from directly below the anchor
	// Below anchor = angle 0, left = negative, right = positive
	const angle = Math.atan2(dx, dy) // note: (dx, dy) not (dy, dx) — 0 is straight down

	// Convert linear velocity to angular velocity
	// angular_vel = (v × r) / |r|² — 2D cross product
	let angularVel = ropeLength > 1
		? (playerVelocity.x * dy - playerVelocity.y * dx) / (ropeLength * ropeLength)
		: 0

	// Enforce minimum angular velocity so every grapple gives a meaningful swing.
	// Direction: prefer the direction of existing velocity; if near-zero, swing
	// toward the side the player is offset from (natural pendulum direction).
	if (Math.abs(angularVel) < MIN_ANGULAR_VELOCITY) {
		const sign = angularVel !== 0
			? Math.sign(angularVel)
			: (angle !== 0 ? -Math.sign(angle) : 1) // swing toward center if offset
		angularVel = sign * MIN_ANGULAR_VELOCITY
	}

	return { anchorPos: { ...anchorPos }, ropeLength, angle, angularVel }
}

/**
 * Step the pendulum physics by dt seconds.
 * Returns the new swing state and the player's world position.
 */
export function stepSwing(
	state: GrappleSwingState,
	dtSec: number,
): { state: GrappleSwingState; position: Vec2; velocity: Vec2 } {
	// Tangential acceleration from gravity:
	// a_tangential = -g * sin(angle) / ropeLength
	// But since we're tracking angular acceleration: α = -g * sin(θ) / L
	const gravityAccel = -(GRAVITY * Math.sin(state.angle)) / state.ropeLength

	// Simple damping to prevent infinite energy (very subtle)
	const DAMPING = 0.998

	// Semi-implicit Euler integration
	let angularVel = (state.angularVel + gravityAccel * dtSec) * DAMPING
	let angle = state.angle + angularVel * dtSec

	// Compute world position from angle
	const position: Vec2 = {
		x: state.anchorPos.x + Math.sin(angle) * state.ropeLength,
		y: state.anchorPos.y + Math.cos(angle) * state.ropeLength,
	}

	// Compute linear velocity (tangent to swing arc)
	// Tangent direction: (cos(angle), -sin(angle)) scaled by rope * angularVel
	const velocity: Vec2 = {
		x: Math.cos(angle) * state.ropeLength * angularVel,
		y: -Math.sin(angle) * state.ropeLength * angularVel,
	}

	return {
		state: {
			anchorPos: state.anchorPos,
			ropeLength: state.ropeLength,
			angle,
			angularVel,
		},
		position,
		velocity,
	}
}

/**
 * Get the launch velocity when releasing the grapple.
 * This is simply the current tangential velocity — momentum is preserved.
 */
export function getSwingReleaseVelocity(state: GrappleSwingState): Vec2 {
	return {
		x: Math.cos(state.angle) * state.ropeLength * state.angularVel,
		y: -Math.sin(state.angle) * state.ropeLength * state.angularVel,
	}
}

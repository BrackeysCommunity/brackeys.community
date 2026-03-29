/**
 * Collision groups, filters, and contact event system for Rapier physics.
 *
 * Rapier InteractionGroups are 32-bit values:
 *   - Upper 16 bits: membership (which groups this collider belongs to)
 *   - Lower 16 bits: filter (which groups this collider interacts with)
 *
 * Two colliders A and B interact iff:
 *   (A.membership & B.filter) !== 0 AND (B.membership & A.filter) !== 0
 */

import type RAPIER from "@dimforge/rapier2d"
import { getRapier } from "./physics"

// ─── Group bits (membership) ─────────────────────────────
// Each group occupies one bit in the 16-bit membership/filter space.

export const GROUP_PLAYER     = 0x0001 // Players (mice)
export const GROUP_GROUND     = 0x0002 // Static ground, walls, map geometry
export const GROUP_SHAMAN_OBJ = 0x0004 // Shaman-placed objects (planks, balls, etc.)
export const GROUP_SENSOR     = 0x0008 // Sensors (cheese, hole, lava) — no physics response
export const GROUP_CLOUD      = 0x0010 // Cloud platforms — one-way pass-through

// ─── Interaction rules ───────────────────────────────────
// Defines what each group's filter mask allows.

/** Player collides with: ground + shaman objects + sensors + cloud (NOT other players).
 *  Sensor collisions generate events but no physics response (sensors use setSensor(true)).
 *  Cloud platforms are toggled via filterGroups on computeColliderMovement. */
const PLAYER_FILTER = GROUP_GROUND | GROUP_SHAMAN_OBJ | GROUP_SENSOR | GROUP_CLOUD

/** Ground collides with: players + shaman objects */
const GROUND_FILTER = GROUP_PLAYER | GROUP_SHAMAN_OBJ

/** Shaman objects collide with: players + ground + other shaman objects */
const SHAMAN_OBJ_FILTER = GROUP_PLAYER | GROUP_GROUND | GROUP_SHAMAN_OBJ

/** Sensors intersect with: players only (no physics response) */
const SENSOR_FILTER = GROUP_PLAYER

// ─── Packed InteractionGroups ────────────────────────────
// Format: (membership << 16) | filter

/** Pack membership and filter into a Rapier InteractionGroups value */
export function packGroups(membership: number, filter: number): number {
	return ((membership & 0xFFFF) << 16) | (filter & 0xFFFF)
}

/** Player collision group — collides with ground and shaman objects */
export const PLAYER_COLLISION_GROUP = packGroups(GROUP_PLAYER, PLAYER_FILTER)

/** Ground collision group — collides with players and shaman objects */
export const GROUND_COLLISION_GROUP = packGroups(GROUP_GROUND, GROUND_FILTER)

/** Shaman object collision group — collides with everything except sensors */
export const SHAMAN_OBJ_COLLISION_GROUP = packGroups(GROUP_SHAMAN_OBJ, SHAMAN_OBJ_FILTER)

/** Sensor collision group — intersects with players only */
export const SENSOR_COLLISION_GROUP = packGroups(GROUP_SENSOR, SENSOR_FILTER)

/** Cloud platform collision group (solid state) — collides with players and shaman objects.
 *  Each cloud toggles its own groups per-frame based on player position. */
export const CLOUD_COLLISION_GROUP = packGroups(GROUP_CLOUD, GROUP_PLAYER | GROUP_SHAMAN_OBJ)

/** Cloud platform collision group (pass-through state) — no player interaction.
 *  Filter is 0 so nothing interacts while in pass-through state. */
export const CLOUD_PASSTHROUGH_GROUP = packGroups(GROUP_CLOUD, 0)

// ─── Sensor types ────────────────────────────────────────

export type SensorType = "cheese" | "hole" | "lava" | "wind_zone"

// ─── Collision event types ───────────────────────────────

export type CollisionEvent =
	| { type: "cheese:collected"; playerCollider: number }
	| { type: "hole:entered"; playerCollider: number }
	| { type: "player:died"; playerCollider: number; cause: "lava" }

// ─── Sensor registry ────────────────────────────────────
// Maps collider handles to their sensor type so we can resolve
// collision events into game events.

const sensorRegistry = new Map<number, SensorType>()

/** Register a collider handle as a sensor of the given type */
export function registerSensor(handle: number, sensorType: SensorType): void {
	sensorRegistry.set(handle, sensorType)
}

/** Unregister a sensor (e.g. when cheese is collected and removed) */
export function unregisterSensor(handle: number): void {
	sensorRegistry.delete(handle)
}

/** Look up what type of sensor a collider handle is (if any) */
export function getSensorType(handle: number): SensorType | undefined {
	return sensorRegistry.get(handle)
}

/** Clear all registered sensors (e.g. on round reset) */
export function clearSensors(): void {
	sensorRegistry.clear()
}

// ─── Player collider registry ───────────────────────────
// Maps collider handles to player IDs so we know which player
// triggered a sensor event.

const playerColliderRegistry = new Set<number>()

export function registerPlayerCollider(handle: number): void {
	playerColliderRegistry.add(handle)
}

export function unregisterPlayerCollider(handle: number): void {
	playerColliderRegistry.delete(handle)
}

export function isPlayerCollider(handle: number): boolean {
	return playerColliderRegistry.has(handle)
}

// ─── Event queue drain ──────────────────────────────────

/**
 * Create a Rapier EventQueue for collision event collection.
 * Pass `true` for autoDrain so the queue is cleared before each world.step().
 */
export function createEventQueue(): RAPIER.EventQueue {
	const R = getRapier()
	return new R.EventQueue(true)
}

/**
 * Drain collision events from the queue and resolve them into game events.
 * Call this AFTER world.step(eventQueue) each tick.
 *
 * Returns an array of game-level collision events for the current tick.
 */
export function drainCollisionEvents(
	eventQueue: RAPIER.EventQueue,
): CollisionEvent[] {
	const events: CollisionEvent[] = []

	eventQueue.drainCollisionEvents((handle1, handle2, started) => {
		// We only care about collision start events
		if (!started) return

		// Figure out which is the player and which is the sensor
		let playerHandle: number | null = null
		let sensorHandle: number | null = null

		if (isPlayerCollider(handle1)) playerHandle = handle1
		if (isPlayerCollider(handle2)) playerHandle = handle2
		if (getSensorType(handle1) !== undefined) sensorHandle = handle1
		if (getSensorType(handle2) !== undefined) sensorHandle = handle2

		// Only process player ↔ sensor collisions
		if (playerHandle === null || sensorHandle === null) return

		const sensorType = getSensorType(sensorHandle)

		switch (sensorType) {
			case "cheese":
				events.push({ type: "cheese:collected", playerCollider: playerHandle })
				break
			case "hole":
				events.push({ type: "hole:entered", playerCollider: playerHandle })
				break
			case "lava":
				events.push({ type: "player:died", playerCollider: playerHandle, cause: "lava" })
				break
		}
	})

	return events
}

// ─── Collider creation helpers ──────────────────────────

/**
 * Create a sensor collider (no physics response, triggers events).
 * Returns the collider so you can register it and position its body.
 */
/**
 * Configure a collider descriptor as a sensor and create it.
 * Accepts either a PhysicsWorld or a raw Rapier World for flexibility.
 */
export function createSensorCollider(
	world: RAPIER.World,
	body: RAPIER.RigidBody,
	shape: RAPIER.ColliderDesc,
	sensorType: SensorType,
): RAPIER.Collider {
	const R = getRapier()
	shape
		.setSensor(true)
		.setCollisionGroups(SENSOR_COLLISION_GROUP)
		.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
		// Sensors need to detect kinematic ↔ fixed collisions
		.setActiveCollisionTypes(
			R.ActiveCollisionTypes.DEFAULT |
			R.ActiveCollisionTypes.KINEMATIC_FIXED |
			R.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
		)

	const collider = world.createCollider(shape, body)
	registerSensor(collider.handle, sensorType)
	return collider
}

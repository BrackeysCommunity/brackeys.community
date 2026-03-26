import type RAPIER from "@dimforge/rapier2d"

// ─── Rapier WASM singleton ──────────────────────────────

let rapier: typeof RAPIER | null = null

/**
 * Load and initialize the Rapier WASM module.
 * Call once before createPhysicsWorld(). Safe to call multiple times
 * (returns cached module after first init).
 */
export async function initRapier(): Promise<typeof RAPIER> {
	if (rapier) return rapier
	rapier = await import("@dimforge/rapier2d")
	return rapier
}

/** Get the cached Rapier module (throws if initRapier() hasn't been called) */
export function getRapier(): typeof RAPIER {
	if (!rapier) throw new Error("Rapier not initialized — call initRapier() first")
	return rapier
}

// ─── Physics World ──────────────────────────────────────

export type PhysicsWorld = {
	/** The raw Rapier world — escape hatch for advanced usage */
	world: RAPIER.World
	/** Advance simulation by one fixed timestep */
	step: () => void
	/** Create a rigid body from a descriptor */
	addRigidBody: (desc: RAPIER.RigidBodyDesc) => RAPIER.RigidBody
	/** Create a collider, optionally attached to a rigid body */
	addCollider: (
		desc: RAPIER.ColliderDesc,
		body?: RAPIER.RigidBody,
	) => RAPIER.Collider
	/** Create a KinematicCharacterController for player movement */
	createCharacterController: (offset?: number) => RAPIER.KinematicCharacterController
	/** Remove a rigid body (and its attached colliders) */
	removeRigidBody: (body: RAPIER.RigidBody) => void
	/** Remove a standalone collider */
	removeCollider: (collider: RAPIER.Collider) => void
	/** Get debug render data (line segments + colors) for wireframe overlay */
	debugRender: () => { vertices: Float32Array; colors: Float32Array }
	/** Tear down the world and free all resources */
	destroy: () => void
}

export type PhysicsConfig = {
	gravity: { x: number; y: number }
	timestep: number
}

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
	gravity: { x: 0, y: 1200 }, // matches player.ts GRAVITY constant (game units/sec²)
	timestep: 1 / 60, // matches game loop tick rate
}

/**
 * Create a Rapier physics world with a ground collider.
 * initRapier() MUST be called before this.
 */
export function createPhysicsWorld(
	config: Partial<PhysicsConfig> = {},
): PhysicsWorld {
	const RAPIER = getRapier()
	const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config }

	const gravity = new RAPIER.Vector2(cfg.gravity.x, cfg.gravity.y)
	const world = new RAPIER.World(gravity)
	world.timestep = cfg.timestep

	// ─── Ground collider (static floor) ──────────────────
	// Wide cuboid at FLOOR_Y (1020) — matches player.ts hardcoded floor.
	// Half-extents: 3000 wide (covers default camera bounds), 20 tall.
	const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(1000, 1040)
	const groundBody = world.createRigidBody(groundBodyDesc)
	const groundColliderDesc = RAPIER.ColliderDesc.cuboid(3000, 20)
	world.createCollider(groundColliderDesc, groundBody)

	// ─── Test wall (static) ──────────────────────────────
	// Tall vertical wall for wall-slide / wall-jump testing.
	// Positioned to the right of the player spawn (960).
	// Half-extents: 10 wide, 200 tall → 20×400 wall at x=1200
	const wallBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(1200, 820)
	const wallBody = world.createRigidBody(wallBodyDesc)
	const wallColliderDesc = RAPIER.ColliderDesc.cuboid(10, 200)
	world.createCollider(wallColliderDesc, wallBody)

	// ─── API ─────────────────────────────────────────────

	function step(): void {
		world.step()
	}

	function addRigidBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
		return world.createRigidBody(desc)
	}

	function addCollider(
		desc: RAPIER.ColliderDesc,
		body?: RAPIER.RigidBody,
	): RAPIER.Collider {
		return world.createCollider(desc, body)
	}

	function createCharacterController(offset = 0.01): RAPIER.KinematicCharacterController {
		const controller = world.createCharacterController(offset)
		// Our coordinate system: +Y is down (screen space), so "up" is -Y
		controller.setUp(new RAPIER.Vector2(0, -1))
		// Slopes: climb up to 50°, slide on slopes > 30°
		controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
		controller.setMinSlopeSlideAngle((30 * Math.PI) / 180)
		// Auto-step: max 4 game units high, min 2 wide, include dynamic bodies
		controller.enableAutostep(4, 2, true)
		// Snap to ground when walking down slopes (up to 4 units)
		controller.enableSnapToGround(4)
		// Push dynamic bodies when walking into them
		controller.setApplyImpulsesToDynamicBodies(true)
		return controller
	}

	function removeRigidBody(body: RAPIER.RigidBody): void {
		world.removeRigidBody(body)
	}

	function removeCollider(collider: RAPIER.Collider): void {
		world.removeCollider(collider, true)
	}

	function debugRender(): { vertices: Float32Array; colors: Float32Array } {
		const buffers = world.debugRender()
		return { vertices: buffers.vertices, colors: buffers.colors }
	}

	function destroy(): void {
		try {
			world.free()
		} catch {
			// WASM pointer may already be freed — safe to ignore
		}
	}

	return {
		world,
		step,
		addRigidBody,
		addCollider,
		createCharacterController,
		removeRigidBody,
		removeCollider,
		debugRender,
		destroy,
	}
}

import type { GameConfig, GameEventMap, GameInstance, GameStoreState } from "./types"
import { DEFAULT_GAME_CONFIG } from "./types"
import { GameEventEmitter } from "./events"
import {
	createGameStore,
	incrementTick,
	resetGameStore,
	setFPS,
	setPhase,
	updateCamera,
	updatePlayer,
} from "./store"
import { createRenderer } from "./renderer"
import { createGameLoop } from "./loop"
import { createInputSystem } from "./input"
import { createCamera } from "./camera"
import { createPlayerEntity } from "./entities/player"
import { initAssets } from "./assets"
import { initRapier, createPhysicsWorld } from "./physics"
import { createDebugOverlay, type DebugOverlay } from "./debug"
import type { Store } from "@tanstack/store"

export async function createGame(
	canvas: HTMLCanvasElement,
	config?: Partial<GameConfig>,
): Promise<GameInstance> {
	const cfg: GameConfig = { ...DEFAULT_GAME_CONFIG, ...config }

	// ─── Initialize subsystems ────────────────────────────────

	const store = createGameStore()
	const events = new GameEventEmitter()

	setPhase(store, "loading")

	// Renderer (must be created first — Application.init() initializes Assets internally)
	const renderer = await createRenderer(canvas, cfg)

	// Register asset bundles (after renderer so Assets is already initialized)
	await initAssets()

	// Camera (display dimensions drive the expand-viewport scaling)
	const camera = createCamera(
		renderer.worldContainer,
		cfg.displayWidth,
		cfg.displayHeight,
		cfg.camera,
	)

	// Physics (Rapier WASM)
	await initRapier()
	const physics = createPhysicsWorld()

	// Input
	const input = createInputSystem(cfg.bindings)

	// Player entity
	const player = createPlayerEntity(renderer.worldContainer)

	// Initialize player in store
	updatePlayer(store, "local", {
		id: "local",
		position: player.getPosition(),
		velocity: { x: 0, y: 0 },
	})

	// Debug overlay (dev-only, tree-shaken in production)
	let debugOverlay: DebugOverlay | null = null
	if (import.meta.env.DEV) {
		debugOverlay = createDebugOverlay({
			worldContainer: renderer.worldContainer,
			uiContainer: renderer.uiContainer,
			camera,
			store,
			physics,
			inputTarget: window,
		})
	}

	// ─── Game loop ────────────────────────────────────────────

	const loop = createGameLoop({
		tickRate: cfg.targetFPS,

		onTick(dt: number) {
			const tick = store.state.tick

			// 1. Poll input
			const actions = input.poll(tick)

			// 2. Update player
			player.update(dt, actions)

			// 3. Step physics world
			physics.step()

			// 4. Update camera to follow player
			camera.update(dt, player.getPosition())

			// 5. Sync state to store
			incrementTick(store)
			updatePlayer(store, "local", {
				position: player.getPosition(),
				velocity: player.getVelocity(),
			})
			updateCamera(store, {
				position: camera.getPosition(),
			})

			// 6. Update debug overlay
			if (debugOverlay) {
				const mousePos = input.getMousePosition()
				// Convert screen mouse to world coordinates (screen px → game units)
				const scale = camera.getDisplayScale()
				const vp = camera.getViewport()
				const mouseWorld = {
					x: vp.x + mousePos.x / scale,
					y: vp.y + mousePos.y / scale,
				}
				debugOverlay.update(dt, player.getPosition(), mouseWorld)
			}

			// 7. Emit tick event
			events.emit("game:tick", { tick: store.state.tick })
		},

		onRender(_alpha: number) {
			// Future: interpolate visual positions between physics ticks
			// For now, PixiJS renders automatically via its ticker (driven by rAF)

			// Update FPS in store periodically
			setFPS(store, loop.getFPS())
		},
	})

	// ─── Public API ───────────────────────────────────────────

	let destroyed = false

	function start(): void {
		if (destroyed) return
		setPhase(store, "running")
		input.attach(window)
		loop.start()
		events.emit("game:start")
	}

	function resize(width: number, height: number): void {
		if (destroyed) return
		renderer.resize(width, height)
		camera.resize(width, height)
	}

	function destroy(): void {
		if (destroyed) return
		destroyed = true

		loop.stop()
		debugOverlay?.destroy()
		input.destroy()
		camera.destroy()
		player.destroy()
		physics.destroy()
		renderer.destroy()

		events.emit("game:destroy")
		events.destroy()

		resetGameStore(store)
		setPhase(store, "destroyed")
	}

	function on<K extends keyof GameEventMap>(
		event: K,
		handler: (payload: GameEventMap[K]) => void,
	): void {
		events.on(event, handler)
	}

	function off<K extends keyof GameEventMap>(
		event: K,
		handler: (payload: GameEventMap[K]) => void,
	): void {
		events.off(event, handler)
	}

	function getStore(): Store<GameStoreState> {
		return store
	}

	setPhase(store, "idle")

	return { start, destroy, resize, on, off, getStore }
}

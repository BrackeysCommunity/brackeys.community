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

	// Init asset system (manifest registration, no actual loading yet)
	await initAssets()

	// Renderer
	const renderer = await createRenderer(canvas, cfg)

	// Camera
	const camera = createCamera(
		renderer.worldContainer,
		cfg.width,
		cfg.height,
		cfg.camera,
	)

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

	// ─── Game loop ────────────────────────────────────────────

	const loop = createGameLoop({
		tickRate: cfg.targetFPS,

		onTick(dt: number) {
			const tick = store.state.tick

			// 1. Poll input
			const actions = input.poll(tick)

			// 2. Update player
			player.update(dt, actions)

			// 3. Update camera to follow player
			camera.update(dt, player.getPosition())

			// 4. Sync state to store
			incrementTick(store)
			updatePlayer(store, "local", {
				position: player.getPosition(),
				velocity: player.getVelocity(),
			})
			updateCamera(store, {
				position: camera.getPosition(),
			})

			// 5. Emit tick event
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

	function destroy(): void {
		if (destroyed) return
		destroyed = true

		loop.stop()
		input.destroy()
		camera.destroy()
		player.destroy()
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

	return { start, destroy, on, off, getStore }
}

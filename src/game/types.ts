// ─── Primitives ──────────────────────────────────────────

export type Vec2 = { x: number; y: number }

// ─── Config ──────────────────────────────────────────────

export type GameConfig = {
	width: number
	height: number
	backgroundColor: number
	targetFPS: number
	maxDeltaTime: number
	camera: CameraConfig
	bindings?: InputBinding[]
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
	width: 800,
	height: 600,
	backgroundColor: 0x1a1a2e,
	targetFPS: 60,
	maxDeltaTime: 250,
	camera: {
		lerpSpeed: 0.1,
		bounds: {
			min: { x: 0, y: 0 },
			max: { x: 1600, y: 800 },
		},
	},
}

// ─── Camera ──────────────────────────────────────────────

export type CameraConfig = {
	lerpSpeed: number
	bounds: { min: Vec2; max: Vec2 }
}

export type CameraState = {
	position: Vec2
	zoom: number
	bounds: { min: Vec2; max: Vec2 }
}

// ─── Input ───────────────────────────────────────────────

export type InputBinding = {
	action: string
	keys: string[]
}

export type InputAction = {
	action: string
	pressed: boolean
	tick: number
	timestamp: number
}

export const DEFAULT_BINDINGS: InputBinding[] = [
	{ action: "move_left", keys: ["ArrowLeft", "a"] },
	{ action: "move_right", keys: ["ArrowRight", "d"] },
	{ action: "jump", keys: ["ArrowUp", "w", " "] },
	{ action: "move_down", keys: ["ArrowDown", "s"] },
]

// ─── Events ──────────────────────────────────────────────

export type GameEventMap = {
	"game:start": undefined
	"game:pause": undefined
	"game:destroy": undefined
	"game:tick": { tick: number }
	"player:spawn": { id: string; position: Vec2 }
	"player:move": { id: string; position: Vec2 }
}

// ─── Store ───────────────────────────────────────────────

export type GamePhase = "idle" | "loading" | "running" | "paused" | "destroyed"

export type PlayerInfo = {
	id: string
	position: Vec2
	velocity: Vec2
}

export type GameStoreState = {
	phase: GamePhase
	players: Record<string, PlayerInfo>
	camera: CameraState
	tick: number
	fps: number
}

// ─── Game Instance ───────────────────────────────────────

export type GameInstance = {
	start: () => void
	destroy: () => void
	on: <K extends keyof GameEventMap>(
		event: K,
		handler: (payload: GameEventMap[K]) => void,
	) => void
	off: <K extends keyof GameEventMap>(
		event: K,
		handler: (payload: GameEventMap[K]) => void,
	) => void
	getStore: () => import("@tanstack/store").Store<GameStoreState>
}

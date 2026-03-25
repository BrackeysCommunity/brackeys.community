// ─── Primitives ──────────────────────────────────────────

export type Vec2 = { x: number; y: number }

// ─── Virtual Resolution ──────────────────────────────────
// The game world is designed around a fixed virtual height.
// Width is derived from the display aspect ratio (expand-viewport).
// Players with wider screens see more horizontally — no letterboxing.

export const VIRTUAL_HEIGHT = 1080

export type DisplayResolution = {
	width: number
	height: number
	label: string
}

export const DISPLAY_RESOLUTIONS: DisplayResolution[] = [
	{ width: 1280, height: 720, label: "720p" },
	{ width: 1920, height: 1080, label: "1080p" },
	{ width: 2560, height: 1440, label: "1440p" },
	{ width: 0, height: 0, label: "Native" }, // 0x0 = use window size
]

// ─── Config ──────────────────────────────────────────────

export type GameConfig = {
	displayWidth: number
	displayHeight: number
	backgroundColor: number
	targetFPS: number
	maxDeltaTime: number
	camera: CameraConfig
	bindings?: InputBinding[]
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
	displayWidth: 1920,
	displayHeight: 1080,
	backgroundColor: 0x1a1a2e,
	targetFPS: 60,
	maxDeltaTime: 250,
	camera: {
		lerpSpeed: 0.1,
		bounds: {
			min: { x: -2000, y: -2000 },
			max: { x: 4000, y: 2000 },
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

// ─── Debug ───────────────────────────────────────────────

export type DebugMode =
	| "off"
	| "grid"
	| "grid+physics"
	| "grid+physics+arcs"
	| "all"

export const DEBUG_MODES: DebugMode[] = [
	"off",
	"grid",
	"grid+physics",
	"grid+physics+arcs",
	"all",
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
	debugMode: DebugMode
}

// ─── Game Instance ───────────────────────────────────────

export type GameInstance = {
	start: () => void
	destroy: () => void
	resize: (width: number, height: number) => void
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

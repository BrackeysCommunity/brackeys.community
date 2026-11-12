import { Store } from "@tanstack/store";

import type {
  CameraState,
  GameMode,
  GamePhase,
  GameStoreState,
  PlaySession,
  SimState,
} from "./types";

// ─── Factory ─────────────────────────────────────────────

const INITIAL_CAMERA: CameraState = {
  position: { x: 0, y: 0 },
  zoom: 1,
  scale: 1,
  bounds: {
    min: { x: 0, y: 0 },
    max: { x: 1600, y: 800 },
  },
  mode: "follow",
};

const INITIAL_SIM: SimState = { paused: false, timeScale: 1 };

function createInitialState(): GameStoreState {
  return {
    phase: "idle",
    game: null,
    camera: { ...INITIAL_CAMERA },
    sim: { ...INITIAL_SIM },
    tick: 0,
    fps: 0,
    debugMode: "off",
    mode: "play",
    session: null,
  };
}

export function createGameStore(): Store<GameStoreState> {
  return new Store<GameStoreState>(createInitialState());
}

// ─── Mutations ───────────────────────────────────────────

export function setPhase(store: Store<GameStoreState>, phase: GamePhase): void {
  store.setState((s) => ({ ...s, phase }));
}

/** Stores the game's slice; an unchanged reference leaves the store alone. */
export function setGameSlice(store: Store<GameStoreState>, game: unknown): void {
  if (store.state.game === game) return;
  store.setState((s) => ({ ...s, game }));
}

export function updateCamera(store: Store<GameStoreState>, camera: Partial<CameraState>): void {
  store.setState((s) => ({
    ...s,
    camera: { ...s.camera, ...camera },
  }));
}

export function setSimPaused(store: Store<GameStoreState>, paused: boolean): void {
  if (store.state.sim.paused === paused) return;
  store.setState((s) => ({ ...s, sim: { ...s.sim, paused } }));
}

export function setSimTimeScale(store: Store<GameStoreState>, timeScale: number): void {
  if (store.state.sim.timeScale === timeScale) return;
  store.setState((s) => ({ ...s, sim: { ...s.sim, timeScale } }));
}

export function incrementTick(store: Store<GameStoreState>): void {
  store.setState((s) => ({ ...s, tick: s.tick + 1 }));
}

export function setFPS(store: Store<GameStoreState>, fps: number): void {
  store.setState((s) => ({ ...s, fps }));
}

export function setDebugMode(store: Store<GameStoreState>, debugMode: string): void {
  store.setState((s) => ({ ...s, debugMode }));
}

export function setMode(store: Store<GameStoreState>, mode: GameMode): void {
  store.setState((s) => ({ ...s, mode }));
}

export function setSession(store: Store<GameStoreState>, session: PlaySession | null): void {
  store.setState((s) => ({ ...s, session }));
}

export function resetGameStore(store: Store<GameStoreState>): void {
  store.setState(() => createInitialState());
}

// ─── Selectors ───────────────────────────────────────────

export function selectPhase(state: GameStoreState): GamePhase {
  return state.phase;
}

/** The game's store slice, typed by the caller who knows the game. */
export function selectGame<G = unknown>(state: GameStoreState): G {
  return state.game as G;
}

export function selectCamera(state: GameStoreState): CameraState {
  return state.camera;
}

export function selectSim(state: GameStoreState): SimState {
  return state.sim;
}

export function selectTick(state: GameStoreState): number {
  return state.tick;
}

export function selectFPS(state: GameStoreState): number {
  return state.fps;
}

export function selectDebugMode(state: GameStoreState): string {
  return state.debugMode;
}

export function selectMode(state: GameStoreState): GameMode {
  return state.mode;
}

export function selectSession(state: GameStoreState): PlaySession | null {
  return state.session;
}

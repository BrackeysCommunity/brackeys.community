import { Store } from "@tanstack/store";

import type { CameraState, DebugMode, GamePhase, GameStoreState, PlayerInfo, Vec2 } from "./types";

// ─── Factory ─────────────────────────────────────────────

const INITIAL_CAMERA: CameraState = {
  position: { x: 0, y: 0 },
  zoom: 1,
  bounds: {
    min: { x: 0, y: 0 },
    max: { x: 1600, y: 800 },
  },
};

function createInitialState(): GameStoreState {
  return {
    phase: "idle",
    players: {},
    camera: { ...INITIAL_CAMERA },
    tick: 0,
    fps: 0,
    debugMode: "off",
  };
}

export function createGameStore(): Store<GameStoreState> {
  return new Store<GameStoreState>(createInitialState());
}

// ─── Mutations ───────────────────────────────────────────

export function setPhase(store: Store<GameStoreState>, phase: GamePhase): void {
  store.setState((s) => ({ ...s, phase }));
}

export function updatePlayer(
  store: Store<GameStoreState>,
  id: string,
  partial: Partial<PlayerInfo>,
): void {
  store.setState((s) => ({
    ...s,
    players: {
      ...s.players,
      [id]: { ...s.players[id], ...partial } as PlayerInfo,
    },
  }));
}

export function removePlayer(store: Store<GameStoreState>, id: string): void {
  store.setState((s) => {
    const { [id]: _, ...rest } = s.players;
    return { ...s, players: rest };
  });
}

export function updateCamera(store: Store<GameStoreState>, camera: Partial<CameraState>): void {
  store.setState((s) => ({
    ...s,
    camera: { ...s.camera, ...camera },
  }));
}

export function incrementTick(store: Store<GameStoreState>): void {
  store.setState((s) => ({ ...s, tick: s.tick + 1 }));
}

export function setFPS(store: Store<GameStoreState>, fps: number): void {
  store.setState((s) => ({ ...s, fps }));
}

export function setDebugMode(store: Store<GameStoreState>, debugMode: DebugMode): void {
  store.setState((s) => ({ ...s, debugMode }));
}

export function resetGameStore(store: Store<GameStoreState>): void {
  store.setState(() => createInitialState());
}

// ─── Selectors ───────────────────────────────────────────

export function selectPhase(state: GameStoreState): GamePhase {
  return state.phase;
}

export function selectPlayers(state: GameStoreState): Record<string, PlayerInfo> {
  return state.players;
}

export function selectCamera(state: GameStoreState): CameraState {
  return state.camera;
}

export function selectTick(state: GameStoreState): number {
  return state.tick;
}

export function selectFPS(state: GameStoreState): number {
  return state.fps;
}

export function selectPlayer(state: GameStoreState, id: string): PlayerInfo | undefined {
  return state.players[id];
}

export function selectPlayerPosition(state: GameStoreState, id: string): Vec2 | undefined {
  return state.players[id]?.position;
}

export function selectDebugMode(state: GameStoreState): DebugMode {
  return state.debugMode;
}

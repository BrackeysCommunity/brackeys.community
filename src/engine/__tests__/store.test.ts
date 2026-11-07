import { describe, expect, it } from "vite-plus/test";

import {
  createGameStore,
  incrementTick,
  resetGameStore,
  selectCamera,
  selectFPS,
  selectGame,
  selectPhase,
  selectSim,
  selectTick,
  setFPS,
  setGameSlice,
  setPhase,
  setSimPaused,
  setSimTimeScale,
  updateCamera,
} from "../store";

describe("createGameStore", () => {
  it("creates a store with initial state", () => {
    const store = createGameStore();
    const state = store.state;

    expect(state.phase).toBe("idle");
    expect(state.tick).toBe(0);
    expect(state.fps).toBe(0);
    expect(state.game).toBeNull();
    expect(state.camera.position).toEqual({ x: 0, y: 0 });
    expect(state.camera.zoom).toBe(1);
    expect(state.camera.mode).toBe("follow");
    expect(state.sim).toEqual({ paused: false, timeScale: 1 });
  });

  it("creates independent stores (not singletons)", () => {
    const store1 = createGameStore();
    const store2 = createGameStore();

    setPhase(store1, "running");

    expect(store1.state.phase).toBe("running");
    expect(store2.state.phase).toBe("idle");
  });
});

describe("mutations", () => {
  it("setPhase updates the phase", () => {
    const store = createGameStore();
    setPhase(store, "running");
    expect(store.state.phase).toBe("running");
  });

  it("setGameSlice stores the game's slice", () => {
    const store = createGameStore();
    const slice = { coins: 3 };

    setGameSlice(store, slice);

    expect(store.state.game).toBe(slice);
  });

  it("setGameSlice leaves the store alone for the same reference", () => {
    const store = createGameStore();
    const slice = { coins: 3 };
    setGameSlice(store, slice);
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);

    setGameSlice(store, slice);
    expect(notified).toBe(0);
    setGameSlice(store, { coins: 4 });
    expect(notified).toBe(1);

    unsubscribe();
  });

  it("updateCamera merges camera state", () => {
    const store = createGameStore();
    updateCamera(store, { position: { x: 100, y: 200 } });

    expect(store.state.camera.position).toEqual({ x: 100, y: 200 });
    expect(store.state.camera.zoom).toBe(1); // unchanged
  });

  it("setSimPaused and setSimTimeScale update sim and skip unchanged values", () => {
    const store = createGameStore();
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);

    setSimPaused(store, true);
    setSimTimeScale(store, 0.5);
    expect(store.state.sim).toEqual({ paused: true, timeScale: 0.5 });
    expect(notified).toBe(2);

    setSimPaused(store, true);
    setSimTimeScale(store, 0.5);
    expect(notified).toBe(2);

    unsubscribe();
  });

  it("incrementTick advances the tick counter", () => {
    const store = createGameStore();
    incrementTick(store);
    incrementTick(store);
    incrementTick(store);
    expect(store.state.tick).toBe(3);
  });

  it("setFPS updates the FPS value", () => {
    const store = createGameStore();
    setFPS(store, 59.8);
    expect(store.state.fps).toBe(59.8);
  });

  it("resetGameStore restores initial state", () => {
    const store = createGameStore();

    setPhase(store, "running");
    incrementTick(store);
    setGameSlice(store, { coins: 3 });
    setSimPaused(store, true);

    resetGameStore(store);

    expect(store.state.phase).toBe("idle");
    expect(store.state.tick).toBe(0);
    expect(store.state.game).toBeNull();
    expect(store.state.sim.paused).toBe(false);
  });
});

describe("selectors", () => {
  it("selectPhase returns the phase", () => {
    const store = createGameStore();
    setPhase(store, "paused");
    expect(selectPhase(store.state)).toBe("paused");
  });

  it("selectGame returns the game's slice", () => {
    const store = createGameStore();
    setGameSlice(store, { coins: 3 });
    expect(selectGame<{ coins: number }>(store.state).coins).toBe(3);
  });

  it("selectCamera returns camera state", () => {
    const store = createGameStore();
    const cam = selectCamera(store.state);
    expect(cam.zoom).toBe(1);
  });

  it("selectSim returns the sim state", () => {
    const store = createGameStore();
    setSimPaused(store, true);
    expect(selectSim(store.state)).toEqual({ paused: true, timeScale: 1 });
  });

  it("selectTick returns the tick count", () => {
    const store = createGameStore();
    incrementTick(store);
    expect(selectTick(store.state)).toBe(1);
  });

  it("selectFPS returns FPS", () => {
    const store = createGameStore();
    setFPS(store, 60);
    expect(selectFPS(store.state)).toBe(60);
  });
});

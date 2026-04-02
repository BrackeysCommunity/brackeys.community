import { describe, expect, it } from "vite-plus/test";
import {
  createGameStore,
  incrementTick,
  removePlayer,
  resetGameStore,
  selectCamera,
  selectFPS,
  selectPhase,
  selectPlayer,
  selectPlayers,
  selectTick,
  setFPS,
  setPhase,
  updateCamera,
  updatePlayer,
} from "../store";

describe("createGameStore", () => {
  it("creates a store with initial state", () => {
    const store = createGameStore();
    const state = store.state;

    expect(state.phase).toBe("idle");
    expect(state.tick).toBe(0);
    expect(state.fps).toBe(0);
    expect(state.players).toEqual({});
    expect(state.camera.position).toEqual({ x: 0, y: 0 });
    expect(state.camera.zoom).toBe(1);
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

  it("updatePlayer adds and updates a player", () => {
    const store = createGameStore();

    updatePlayer(store, "p1", {
      id: "p1",
      position: { x: 10, y: 20 },
      velocity: { x: 0, y: 0 },
    });

    expect(store.state.players.p1).toEqual({
      id: "p1",
      position: { x: 10, y: 20 },
      velocity: { x: 0, y: 0 },
    });

    updatePlayer(store, "p1", { position: { x: 50, y: 60 } });

    expect(store.state.players.p1.position).toEqual({ x: 50, y: 60 });
    expect(store.state.players.p1.id).toBe("p1");
  });

  it("removePlayer removes a player", () => {
    const store = createGameStore();

    updatePlayer(store, "p1", {
      id: "p1",
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
    });
    removePlayer(store, "p1");

    expect(store.state.players.p1).toBeUndefined();
  });

  it("updateCamera merges camera state", () => {
    const store = createGameStore();
    updateCamera(store, { position: { x: 100, y: 200 } });

    expect(store.state.camera.position).toEqual({ x: 100, y: 200 });
    expect(store.state.camera.zoom).toBe(1); // unchanged
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
    updatePlayer(store, "p1", {
      id: "p1",
      position: { x: 99, y: 99 },
      velocity: { x: 1, y: 1 },
    });

    resetGameStore(store);

    expect(store.state.phase).toBe("idle");
    expect(store.state.tick).toBe(0);
    expect(store.state.players).toEqual({});
  });
});

describe("selectors", () => {
  it("selectPhase returns the phase", () => {
    const store = createGameStore();
    setPhase(store, "paused");
    expect(selectPhase(store.state)).toBe("paused");
  });

  it("selectPlayers returns the players map", () => {
    const store = createGameStore();
    updatePlayer(store, "p1", {
      id: "p1",
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
    });
    const players = selectPlayers(store.state);
    expect(Object.keys(players)).toEqual(["p1"]);
  });

  it("selectCamera returns camera state", () => {
    const store = createGameStore();
    const cam = selectCamera(store.state);
    expect(cam.zoom).toBe(1);
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

  it("selectPlayer returns a single player or undefined", () => {
    const store = createGameStore();
    expect(selectPlayer(store.state, "nope")).toBeUndefined();

    updatePlayer(store, "p1", {
      id: "p1",
      position: { x: 5, y: 10 },
      velocity: { x: 0, y: 0 },
    });
    expect(selectPlayer(store.state, "p1")?.position).toEqual({
      x: 5,
      y: 10,
    });
  });
});

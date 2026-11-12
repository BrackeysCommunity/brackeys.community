// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../../game/index";
import type { GameInstance } from "../../index";
import type { EditorHost, ProjectConnectionState } from "../host";
import { SceneEditor } from "../index";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return { ...pixi, Application };
});

const games = vi.hoisted(() => ({
  made: [] as { canvas: HTMLCanvasElement; destroyed: boolean }[],
}));

// Records the canvas each game is built on, and whether that game was destroyed.
vi.mock("../../index", async (importOriginal) => {
  const engine = await importOriginal<typeof import("../../index")>();
  return {
    ...engine,
    createGame: async (...args: Parameters<typeof engine.createGame>) => {
      const game: GameInstance = await engine.createGame(...args);
      const made = { canvas: args[0], destroyed: false };
      games.made.push(made);
      const destroy = game.destroy;
      game.destroy = () => {
        made.destroyed = true;
        destroy();
      };
      return game;
    },
  };
});

const definition = (id: string) =>
  defineGame({ id, types: [], actions: [], createRuntime: () => ({ snapshot: () => null }) });

/** A host whose project never connects: the game is built without one. */
const host: EditorHost = {
  assetUrl: () => "",
  storage: null,
  connect: () => {
    const state: ProjectConnectionState = {
      status: "connecting",
      session: null,
      access: "write",
      stopped: {},
      error: null,
      unsynced: 0,
    };
    return {
      getState: () => state,
      subscribe: () => () => {},
      onAssetChanged: () => () => {},
      destroy: () => {},
    };
  },
};

const rapier = () => import("@dimforge/rapier2d");

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  games.made.length = 0;
  vi.unstubAllGlobals();
});

describe("SceneEditor's canvas", () => {
  it("builds each game on a canvas no destroyed game drew on", async () => {
    const { container, rerender } = render(
      <SceneEditor host={host} game={definition("first")} project="p" rapier={rapier} />,
    );
    await waitFor(() => expect(games.made).toHaveLength(1), { timeout: 10_000 });

    rerender(<SceneEditor host={host} game={definition("second")} project="p" rapier={rapier} />);
    await waitFor(() => expect(games.made).toHaveLength(2), { timeout: 10_000 });

    const [first, second] = games.made;
    expect(first!.destroyed).toBe(true);
    expect(second!.destroyed).toBe(false);
    expect(second!.canvas).not.toBe(first!.canvas);
    expect(first!.canvas.isConnected).toBe(false);
    const shown = container.querySelectorAll("canvas.je-scene-canvas");
    expect([...shown]).toEqual([second!.canvas]);
  }, 20_000);
});

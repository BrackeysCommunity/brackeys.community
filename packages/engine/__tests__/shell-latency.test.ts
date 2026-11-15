// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createGame } from "../engine";
import { LATENCY_COMMAND } from "../game/commands";
import { defineGame } from "../game/define";
import type { LibraryScene } from "../game/flow";
import type { GameDefinition } from "../game/types";
import { memoryPrefsStore, PREF_KEYS } from "../prefs";
import { createKindRegistry } from "../project/kinds";
import { projectView } from "../project/view";
import type { AssetLoader } from "../render/asset-loader";
import type { SceneRuntimeHandle } from "../runtime/types";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import type { GameInstance, SceneSource } from "../types";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

/** A game whose `go` command changes scene and which records the latency each tick judges with. */
function tapper(judged: number[]): GameDefinition {
  return defineGame({
    id: "tapper",
    types: [],
    actions: [],
    world: { physics: "none" },
    commands: {
      go: {
        description: "Changes scene.",
        args: z.strictObject({ to: z.string().describe("The scene.") }),
      },
    },
    createRuntime(ctx) {
      return {
        beforeStep(_dt, _actions, commands) {
          judged.push(ctx.input.latencyMs());
          for (const c of commands)
            if (c.name === "go") ctx.flow.request({ to: (c.args as { to: string }).to });
        },
        snapshot: () => null,
      };
    },
  }) as GameDefinition;
}

const scene = (name: string): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: "tapper",
  bounds: [0, 0, 10, 10],
  entities: [],
});

function source(): SceneSource {
  const scenes = new Map<string, LibraryScene>(
    ["menu", "song"].map((id) => [id, { def: scene(id), prefabs: new Map() }]),
  );
  return {
    list: () => [{ scene: "menu" }, { scene: "song" }],
    start: () => "menu",
    scene: (id) => scenes.get(id) ?? null,
  };
}

const loader = {
  async load() {
    return { failed: [] };
  },
  retain() {},
  release() {},
  texture: () => null,
  destroy() {},
} as unknown as AssetLoader;

const games: GameInstance[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.appendChild(document.createElement("canvas"));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function makeGame(judged: number[], saved?: number): Promise<GameInstance> {
  const game = tapper(judged);
  const kinds = createKindRegistry(game);
  const view = projectView(
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {},
      history: {},
      code: {},
      build: {},
    },
    kinds,
  );
  const prefs = memoryPrefsStore();
  if (saved !== undefined) prefs.save("tapper", { [PREF_KEYS.latencyMs]: saved });
  const instance = await createGame(document.querySelector("canvas")!, {
    game,
    dev: true,
    assets: { loader, view, kinds },
    flow: { source: source() },
    audio: { backend: false, prefs },
  });
  games.push(instance);
  instance.start();
  const done = instance.flow.restart();
  await vi.runAllTimersAsync();
  expect(await done).toMatchObject({ ok: true, scene: "menu" });
  return instance;
}

const latencyOf = (g: GameInstance) => (g.runtime() as SceneRuntimeHandle).ctx.input.latencyMs();

async function goToSong(game: GameInstance): Promise<void> {
  expect(game.send({ name: "go", args: { to: "song" } })).toBe(true);
  game.step();
  await vi.runAllTimersAsync();
  expect(game.flow.current()).toBe("song");
}

describe("the calibrated latency across a scene change", () => {
  it("reaches the next scene's world on its first tick", async () => {
    const judged: number[] = [];
    const game = await makeGame(judged);
    expect(game.send({ name: LATENCY_COMMAND, args: { ms: 30 } })).toBe(true);
    game.step();
    expect(latencyOf(game)).toBe(30);
    await goToSong(game);
    judged.length = 0;
    game.step();
    expect(judged).toEqual([30]);
    expect(latencyOf(game)).toBe(30);
  });

  it("gives way to a newer @latency sent before the next tick", async () => {
    const judged: number[] = [];
    const game = await makeGame(judged, 20);
    game.step();
    expect(latencyOf(game)).toBe(20);
    await goToSong(game);
    expect(game.send({ name: LATENCY_COMMAND, args: { ms: 45 } })).toBe(true);
    judged.length = 0;
    game.step(2);
    expect(judged).toEqual([45, 45]);
  });
});

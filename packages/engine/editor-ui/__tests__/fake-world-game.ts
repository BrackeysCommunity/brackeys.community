import { Store } from "@tanstack/store";
import { vi } from "vite-plus/test";

import type { Registry } from "../../game/index";
import type { GameMode, GameStoreState } from "../../index";
import {
  expandScene,
  type ExpandedScene,
  type RuntimeEntity,
  type SceneDefinition,
} from "../../scene/index";
import type { EditorGame } from "../session/live-scene-editor";
import type { EditorChromeGame } from "../session/use-scene-editor";

/**
 * A game that records its world as an `ExpandedScene` instead of building
 * physics: loads replace it, the runtime's reconciles patch it, Play builds
 * from the document, and Stop rebuilds the world from before Play, as the
 * engine does.
 */
export function fakeWorldGame(registry: Registry) {
  let mode: GameMode = "play";
  let world: ExpandedScene | null = null;
  let editWorld: ExpandedScene | null = null;
  const store = new Store({
    camera: {
      position: { x: 0, y: 0 },
      zoom: 1,
      scale: 1,
      bounds: { min: {}, max: {} },
      mode: "free",
    },
    sim: { paused: false, timeScale: 1 },
  } as unknown as GameStoreState);
  const byId = (entities: RuntimeEntity[]) => new Map(entities.map((e) => [e.id, e]));
  const runtime = {
    add: vi.fn((entities: RuntimeEntity[]) => {
      world!.entities.push(...structuredClone(entities));
      return { ok: true as const };
    }),
    update: vi.fn((entities: RuntimeEntity[]) => {
      const next = byId(structuredClone(entities));
      world!.entities = world!.entities.map((e) => next.get(e.id) ?? e);
      return { ok: true as const };
    }),
    remove: vi.fn((ids: string[]) => {
      world!.entities = world!.entities.filter((e) => !ids.includes(e.id));
    }),
  };
  const game = {
    registry,
    loadScene: vi.fn((source: SceneDefinition | ExpandedScene) => {
      world = structuredClone("v" in source ? expandScene(source, registry) : source);
      return { ok: true as const, counts: {}, ms: 0 };
    }),
    runtime: () => (world ? runtime : null),
    play: vi.fn((doc: SceneDefinition) => {
      if (mode === "edit") editWorld = world;
      game.loadScene(doc);
      mode = "play";
      return { ok: true as const, issues: [] };
    }),
    stop: vi.fn(() => {
      if (mode !== "play") return;
      mode = "edit";
      if (editWorld ?? world) game.loadScene(editWorld ?? world!);
      editWorld = null;
    }),
    setMode: vi.fn((next: GameMode) => (next === "play" ? undefined : game.stop())),
    setPrefabs: vi.fn(),
    getMode: () => mode,
    getStore: () => store,
    router: { register: () => () => {} },
    pause: vi.fn(),
    resume: vi.fn(),
    step: vi.fn(),
    setTimeScale: vi.fn(),
    command: vi.fn(() => false),
    send: vi.fn(() => false),
    elapse: vi.fn(),
    cancel: vi.fn(() => false),
    pointerWorld: () => null,
    frame: vi.fn(),
    panBy: vi.fn(),
    // No device presses here: a binding capture times out at once.
    input: { capture: vi.fn(async () => null) },
  };
  const calls = () =>
    game.loadScene.mock.calls.length +
    runtime.add.mock.calls.length +
    runtime.update.mock.calls.length +
    runtime.remove.mock.calls.length;
  return {
    game: game as unknown as EditorGame & EditorChromeGame & { getMode: () => GameMode },
    world: () => world,
    runtime,
    loadScene: game.loadScene,
    calls,
  };
}

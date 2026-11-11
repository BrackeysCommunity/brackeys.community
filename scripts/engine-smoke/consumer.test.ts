// @vitest-environment jsdom
/**
 * An outside host on the packed `@jams/engine`: `smoke.ts` copies this file
 * next to the extracted tarball, so every `@jams/engine` import below is
 * `dist`, not source. It isn't part of the root `vp test` run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createGame, ENGINE_VERSION } from "@jams/engine";
import { applyOpsToDoc, docToScene, sceneToDoc } from "@jams/engine/collab";
import { createDebugOverlay } from "@jams/engine/debug";
import { createEditorSession } from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import { createHeadlessRuntime, type RapierModule } from "@jams/engine/headless";
import {
  expandScene,
  formatScene,
  parseSceneOrThrow,
  sceneJsonSchema,
  parsePrefab,
  prefabLibrary,
  SCENE_FORMAT_VERSION,
} from "@jams/engine/scene";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { smokeGame } from "./game";

// jsdom has no WebGL, so the Pixi application is a stand-in; everything the
// engine draws into (containers, graphics) is the real Pixi.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

// vitest runs from the consumer directory, which holds the scene and the installed package.
const text = readFileSync(join(process.cwd(), "engine-yard.json"), "utf8");
const registry = createRegistry(smokeGame);
const def = parseSceneOrThrow(text, registry);
const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "node_modules/@jams/engine/package.json"), "utf8"),
) as { version: string };

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

describe("the packed @jams/engine", () => {
  it("is the version its package.json says", () => {
    expect(ENGINE_VERSION).toBe(pkg.version);
    expect(SCENE_FORMAT_VERSION).toBe(4);
    expect(sceneJsonSchema(registry)).toHaveProperty("$id");
  });

  it("expands prefab instances and group offsets from dist", () => {
    const parsed = parsePrefab(
      { kind: "prefab", v: 4, id: "pad", entities: [{ id: "top", type: "marker", at: [0, -0.5] }] },
      registry,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const scene = expandScene(
      {
        v: 4,
        game: registry.id,
        name: "pads",
        bounds: [0, 0, 4, 4],
        groups: { row: { at: [0.5, 0] } },
        instances: [{ id: "pad-1", prefab: "pad", at: [1, 2], group: "row" }],
      },
      registry,
      { prefabs: prefabLibrary([parsed.prefab]) },
    );
    expect(scene.entities).toEqual([{ id: "pad-1/top", type: "marker", at: [1.5, 1.5] }]);
  });

  it("loads, steps and unloads a scene in a DOM host with standard Rapier injected", async () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const game = await createGame(canvas, {
      game: smokeGame,
      registry,
      rapier: async () => rapier,
      dev: true,
      debug: createDebugOverlay,
    });
    cleanup.push(() => game.destroy());

    const report = game.loadScene(def);
    expect(report.ok).toBe(true);
    const runtime = game.runtime();
    expect(runtime).not.toBeNull();
    const start = runtime!.snapshot() as { x: number };
    for (let i = 0; i < 60; i++) {
      const press = { action: "right", pressed: true, tick: i, timestamp: 0 };
      runtime!.step(1000 / 60, i === 0 ? [press] : []);
    }
    expect((runtime!.snapshot() as { x: number }).x).toBeGreaterThan(start.x);

    game.unloadScene();
    expect(game.runtime()).toBeNull();
  });

  it("steps the headless runtime with standard Rapier", () => {
    const runtime = createHeadlessRuntime({
      rapier,
      game: smokeGame,
      registry,
      scene: expandScene(def, registry),
    });
    cleanup.push(() => runtime.destroy());
    const result = runtime.step(1000 / 60, []);
    expect(result).toBeDefined();
    expect(runtime.stats().bodies).toBeGreaterThan(0);
  });

  it("round-trips a scene between two docs through ./collab", () => {
    const a = sceneToDoc(def);
    const b = new Y.Doc();
    b.on("update", (u: Uint8Array) => Y.applyUpdate(a, u));
    a.on("update", (u: Uint8Array) => Y.applyUpdate(b, u));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(formatScene(docToScene(b)).text).toBe(formatScene(def).text);

    const result = applyOpsToDoc(
      b,
      { ops: [{ op: "move", refs: ["crate"], by: [0.1, 0] }] },
      { kind: "agent", agentId: "smoke" },
      registry,
    );
    expect(result.ok).toBe(true);
    expect(formatScene(docToScene(a)).text).toBe(formatScene(docToScene(b)).text);
    expect(formatScene(docToScene(a)).text).not.toBe(formatScene(def).text);
  });

  it("opens an editor session on a doc", () => {
    const doc = sceneToDoc(def);
    const session = createEditorSession({
      doc,
      origin: { kind: "user", userId: "smoke" },
      registry,
      name: def.name,
    });
    cleanup.push(() => session.destroy());
    expect(session.getDoc().name).toBe("engine-yard");
    session.dispatch({ ops: [{ op: "remove", refs: ["readme"] }] });
    expect(session.undo()).toBe(true);
    expect(formatScene(session.getDoc()).text).toBe(formatScene(def).text);
  });
});

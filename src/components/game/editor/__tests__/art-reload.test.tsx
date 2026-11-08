// @vitest-environment jsdom
import { createGame, type AssetLoader, type GameInstance, type RapierModule } from "@jams/engine";
import {
  ASSET_CHANGED,
  createProjectSession,
  memoryDocHost,
  seedProjectDoc,
  writeEntry,
  type AssetChangedMessage,
  type ProjectSession,
} from "@jams/engine/collab";
import { defineGame, type SceneRuntimeHandle } from "@jams/engine/game";
import { createKindRegistry, type AssetEntry, type AssetBundle } from "@jams/engine/project";
import { createRegistry, SCENE_FORMAT_VERSION, type SceneDefinition } from "@jams/engine/scene";
import { Texture } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  editorIdentity,
  projectRegistry,
  type AssetChangeSource,
  type ProjectRegistry,
} from "@/components/game/live-scene-editor";

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

vi.mock("@/lib/toast", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
}));

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

const artGame = defineGame({
  id: "art-reload",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const code = createRegistry(artGame);
const kinds = createKindRegistry(artGame);

const crate: AssetEntry = {
  key: "crate",
  id: "crate",
  kind: "texture",
  path: "art/crate.png",
  created: { at: 0, by: "seed" },
  sha256: OLD,
  bytes: 10,
  meta: { format: "png", width: 40, height: 20 },
};

const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "yard",
  bounds: [0, 0, 1000, 1000],
  entities: [
    { id: "pic", type: "marker", at: [100, 100], behaviors: { sprite: { asset: "crate" } } },
    { id: "pin", type: "marker", at: [200, 100] },
  ],
} as SceneDefinition;

/** Textures resident by hash once loaded; every load's hashes and every lookup recorded. */
function fakeLoader() {
  const resident = new Set<string>();
  const listeners = new Set<(hash: string) => void>();
  const loads: string[][] = [];
  const asked: string[] = [];
  const loader: AssetLoader = {
    get(hash) {
      asked.push(hash);
      return resident.has(hash) ? Texture.WHITE : null;
    },
    onLoad(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    async load(bundle: AssetBundle) {
      loads.push(bundle.entries.map((e) => e.sha256));
      for (const e of bundle.entries) {
        resident.add(e.sha256);
        for (const l of listeners) l(e.sha256);
      }
      return { failed: [] };
    },
    retain: vi.fn(),
    release: vi.fn(),
    trim() {},
    stats: () => ({ textures: resident.size, bytes: 0, resident: [] }),
    destroy() {},
  };
  return { loader, loads, asked };
}

/** What the project link hands the editor: a way to deliver the dev server's message. */
function changeSource() {
  const listeners = new Set<(m: AssetChangedMessage) => void>();
  const source: AssetChangeSource = {
    onAssetChanged(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
  const send = (m: AssetChangedMessage) => {
    for (const l of listeners) l(m);
  };
  return { source, send, listeners };
}

const message = (sha256: string): AssetChangedMessage => ({
  type: ASSET_CHANGED,
  project: "p",
  key: "crate",
  id: "crate",
  kind: "texture",
  path: "art/crate.png",
  sha256,
  bytes: 12,
  previous: OLD,
});

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
  vi.unstubAllGlobals();
});

async function setup() {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { crate },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  const session: ProjectSession = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: editorIdentity("Ada").origin,
    registry: code,
    kinds,
  });
  cleanups.push(() => session.destroy());
  const watch: ProjectRegistry = projectRegistry(session);
  cleanups.push(() => watch.destroy());
  await watch.ready();
  const fake = fakeLoader();
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const game: GameInstance = await createGame(canvas, {
    game: artGame,
    registry: watch.current(),
    project: watch.project(),
    rapier: async () => rapier,
    dev: true,
    assets: {
      loader: fake.loader,
      kinds,
      get view() {
        return session.view();
      },
    },
  });
  cleanups.push(() => game.destroy());
  await game.preload(scene);
  expect(game.loadScene(scene).ok).toBe(true);
  expect(fake.loads.flat()).toContain(OLD);
  fake.loads.length = 0;
  const changes = changeSource();
  cleanups.push(watch.followAssets(changes.source, game));
  /** What the dev server does on a re-import: the entry's new hash and meta, then the message. */
  const reimport = () =>
    writeEntry(host.doc("project:p"), {
      ...crate,
      sha256: NEW,
      bytes: 12,
      meta: { format: "png", width: 50, height: 20 },
    });
  return { session, watch, game, changes, reimport, ...fake };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("hot reload of art", () => {
  it("a re-imported PNG swaps the sprite's texture hash without a loadScene", async () => {
    const { watch, game, changes, reimport, loads, asked } = await setup();
    const runtime = game.runtime() as SceneRuntimeHandle;
    expect(runtime.ctx.project?.asset("crate")?.sha256).toBe(OLD);
    runtime.step(1000 / 60, []);
    const tick = runtime.ctx.tick;
    const loadScene = vi.spyOn(game, "loadScene");
    const before = watch.project();
    const published = vi.fn();
    watch.subscribe(published);
    asked.length = 0;

    reimport();
    changes.send(message(NEW));
    await settle();

    expect(loads).toEqual([[NEW]]);
    expect(game.runtime()).toBe(runtime);
    expect(runtime.ctx.tick).toBe(tick);
    expect(loadScene).not.toHaveBeenCalled();
    expect(runtime.ctx.project?.asset("crate")).toMatchObject({ sha256: NEW, size: [50, 20] });
    expect(asked).toContain(NEW);
    expect(asked).not.toContain(OLD);
    // The host's game keeps its identity: no listener rebuilds it, yet a later build reads the new art.
    expect(published).not.toHaveBeenCalled();
    expect(watch.project()).not.toBe(before);
    expect(watch.project().asset("crate")?.sha256).toBe(NEW);
  });

  it("waits for the project doc to carry the hash a message names", async () => {
    const { game, changes, reimport, loads } = await setup();
    const runtime = game.runtime() as SceneRuntimeHandle;
    changes.send(message(NEW));
    await settle();
    expect(loads).toEqual([]);
    expect(runtime.ctx.project?.asset("crate")?.sha256).toBe(OLD);

    reimport();
    await settle();
    expect(loads.at(-1)).toEqual([NEW]);
    expect(runtime.ctx.project?.asset("crate")?.sha256).toBe(NEW);
    expect(game.runtime()).toBe(runtime);
  });

  it("later preloads bundle the new hash, and the unsubscribe stops following", async () => {
    const { game, changes, reimport, loads, watch } = await setup();
    reimport();
    changes.send(message(NEW));
    await settle();
    loads.length = 0;
    await game.preload(scene);
    expect(loads).toEqual([[NEW]]);

    const fresh = changeSource();
    const off = watch.followAssets(fresh.source, game);
    off();
    expect(fresh.listeners.size).toBe(0);
  });
});

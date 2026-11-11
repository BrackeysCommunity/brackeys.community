// @vitest-environment jsdom
import { Assets, Container, type Texture } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { assetField } from "../game/fields";
import type { FieldEnv, GameDefinition } from "../game/types";
import { createKindRegistry } from "../project/kinds";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry, Sha256 } from "../project/types";
import { projectView } from "../project/view";
import { createAssetLoader } from "../render/asset-loader";
import type { SceneDefinition } from "../scene/types";
import type { GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame } from "./fixtures/test-game";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const fieldEnv: FieldEnv = { materials: [], materialDefs: new Map(), types: [], assets: () => [] };

/** The test game with a project setting that names a texture, so the project bundle has an entry. */
const game: GameDefinition = {
  ...testGame,
  projectSettings: {
    ...testGame.projectSettings,
    splash: assetField(fieldEnv, "texture", "The splash.").default("splash"),
  },
};
const kinds = createKindRegistry(game);

const sha = (n: number) => n.toString(16).padStart(64, "0") as Sha256;
const texture = (id: string, n: number): AssetEntry => ({
  key: id,
  id,
  kind: "texture",
  path: `art/${id}.png`,
  sha256: sha(n),
  bytes: 10 * n,
  meta: { format: "png", width: 2, height: 2 },
  created: { at: 0, by: "test" },
});
const view = projectView(
  {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(
      [texture("sky", 1), texture("splash", 2), texture("banner", 3)].map((e) => [e.key, e]),
    ),
    history: {},
    code: {},
    build: {},
  },
  kinds,
);
const project: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
};
const sky: SceneDefinition = {
  v: 1,
  name: "sky",
  bounds: [0, 0, 500, 500],
  solid: [["box", 250, 490, 250, 10]],
  assets: ["sky"],
};
const SPLASH_URL = `/blob/${sha(2)}`;
const BANNER_URL = `/blob/${sha(3)}`;

let rapier: RapierModule;
let canvas: HTMLCanvasElement;
const games: GameInstance[] = [];

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(() => {
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A loader whose fetches of `failing` URLs reject while `failing` holds them. */
function setup() {
  const fetched: string[] = [];
  const failing = new Set<string>();
  vi.spyOn(Assets, "load").mockImplementation((async (asset: { src: string }) => {
    fetched.push(asset.src);
    if (failing.has(asset.src)) throw new Error("offline");
    return { width: 2, height: 2, source: { pixelWidth: 2, pixelHeight: 2 } } as Texture;
  }) as typeof Assets.load);
  vi.spyOn(Assets, "unload").mockImplementation(async () => {});
  const loader = createAssetLoader({ project: "p", url: (_p, e) => `/blob/${e.sha256}` });
  return { loader, fetched, failing, assets: { loader, view, kinds } };
}

async function makeGame(assets: ReturnType<typeof setup>["assets"]): Promise<GameInstance> {
  const instance = await createGame(canvas, { game, rapier: async () => rapier, project, assets });
  games.push(instance);
  return instance;
}

describe("reloadAssets", () => {
  it("re-resolves the project bundle when a new project moves a settings asset field", async () => {
    const { loader, fetched, assets } = setup();
    const instance = await makeGame(assets);
    await instance.preload(sky);
    expect(fetched.sort()).toEqual([`/blob/${sha(1)}`, SPLASH_URL]);

    const moved: ProjectRuntimeView = { ...project, settings: { splash: "banner" } };
    expect(await instance.reloadAssets({ project: moved, view, changed: [] })).toEqual({
      failed: [],
      errors: [],
    });
    expect(fetched).toContain(BANNER_URL);
    expect(loader.get(sha(3))).not.toBeNull();
    expect(loader.stats().resident).toEqual(["project"]);

    fetched.length = 0;
    await instance.reloadAssets({ project: moved, view, changed: [] });
    await instance.preload(sky);
    expect(fetched).toEqual([]);
  });

  it("asks for a gained project texture again on the next preload when the reload's fetch failed", async () => {
    const { loader, fetched, failing, assets } = setup();
    const instance = await makeGame(assets);
    await instance.preload(sky);
    failing.add(BANNER_URL);

    const moved: ProjectRuntimeView = { ...project, settings: { splash: "banner" } };
    const result = await instance.reloadAssets({ project: moved, view, changed: [] });
    expect(result.failed.map((e) => e.id)).toEqual(["banner"]);

    failing.clear();
    expect(await instance.preload(sky)).toEqual({ failed: [] });
    expect(loader.get(sha(3))).not.toBeNull();
    expect(fetched.filter((u) => u === BANNER_URL)).toHaveLength(2);
  });
});

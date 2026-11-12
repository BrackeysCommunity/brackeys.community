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
    assets: Object.fromEntries([texture("sky", 1), texture("splash", 2)].map((e) => [e.key, e])),
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

describe("the project bundle's load", () => {
  it("is asked for again by the next preload after a project texture failed", async () => {
    const { loader, fetched, failing, assets } = setup();
    const instance = await makeGame(assets);
    failing.add(SPLASH_URL);

    const first = await instance.preload(sky);
    expect(first.failed.map((e) => e.id)).toEqual(["splash"]);
    expect(loader.get(sha(2))).toBeNull();

    failing.clear();
    expect(await instance.preload(sky)).toEqual({ failed: [] });
    expect(loader.get(sha(2))).not.toBeNull();
    expect(fetched.filter((u) => u === SPLASH_URL)).toHaveLength(2);
  });

  it("is asked for again by a later loadScene after a failed preload", async () => {
    const { loader, failing, assets } = setup();
    const instance = await makeGame(assets);
    failing.add(SPLASH_URL);
    await instance.preload(sky);

    failing.clear();
    const arrived: Sha256[] = [];
    loader.onLoad((h) => arrived.push(h));
    expect(instance.loadScene(sky).ok).toBe(true);
    await vi.waitFor(() => expect(arrived).toEqual([sha(2)]));
    expect(loader.stats().resident).toEqual(["project", "sky"]);
  });

  it("joins only the first load once the project's textures are in", async () => {
    const { fetched, assets } = setup();
    const instance = await makeGame(assets);
    const totals: number[] = [];

    await instance.preload(sky, (p) => totals.push(p.total));
    await instance.preload(sky, (p) => totals.push(p.total));
    expect(totals.at(0)).toBe(2);
    expect(totals.at(-1)).toBe(1);
    expect(fetched.sort()).toEqual([`/blob/${sha(1)}`, SPLASH_URL]);
  });
});

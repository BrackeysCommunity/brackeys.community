// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { createKindRegistry } from "../project/kinds";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry } from "../project/types";
import { projectView } from "../project/view";
import type { AssetLoader } from "../render/asset-loader";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import type { GameInstance } from "../types";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const game = defineGame({
  id: "signs",
  types: [],
  actions: [],
  world: { physics: "none" },
  createRuntime: () => ({ snapshot: () => null }),
}) as GameDefinition;
const kinds = createKindRegistry(game);

const created = { at: 0, by: "test" };
const sha = (n: number) => n.toString(16).padStart(64, "0");
const entries: AssetEntry[] = [
  {
    key: "glyphs",
    id: "glyphs",
    kind: "font",
    path: "fonts/glyphs.fnt",
    sha256: sha(1),
    bytes: 5,
    import: { pages: ["glyph-page"] },
    meta: { format: "bmfont", size: 10, lineHeight: 12 },
    created,
  },
  {
    key: "glyph-page",
    id: "glyph-page",
    kind: "texture",
    path: "fonts/glyphs.png",
    sha256: sha(2),
    bytes: 7,
    meta: { format: "png", width: 8, height: 8 },
    created,
  },
];
const view = projectView(
  {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  },
  kinds,
);

const project: ProjectRuntimeView = {
  settings: {},
  engine: { locales: { default: "en", available: ["en"], fonts: { default: "glyphs" } } },
  table: () => [],
  asset: () => undefined,
  inputMap: null,
};

const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "porch",
  game: "signs",
  bounds: [0, 0, 10, 10],
  entities: [{ id: "start", type: "marker", at: [1, 1] }],
};

const games: GameInstance[] = [];

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("loads the locales' fonts and their pages with the project's assets", async () => {
  const loaded: string[] = [];
  const loader = {
    async load(bundle: { entries: { id: string }[] }) {
      loaded.push(...bundle.entries.map((e) => e.id));
      return { failed: [] };
    },
    retain() {},
    release() {},
    get: () => null,
    destroy() {},
  } as unknown as AssetLoader;
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const instance = await createGame(canvas, {
    game,
    project,
    assets: { loader, view, kinds },
    scene,
  });
  games.push(instance);
  await Promise.resolve();
  expect(loaded).toEqual(expect.arrayContaining(["glyphs", "glyph-page"]));
});

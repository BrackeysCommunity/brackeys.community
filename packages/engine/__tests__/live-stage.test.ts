// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { LibraryScene } from "../game/flow";
import { LIVE_DEFAULTS } from "../game/live";
import type { GameDefinition } from "../game/types";
import type { AssetBundle } from "../project/bundle";
import { sha256 } from "../project/hash";
import { createKindRegistry } from "../project/kinds";
import { ENGINE_FORMATS, type ReleaseAsset } from "../project/release";
import { sceneVersionId, type SceneVersion } from "../project/scene-version";
import { projectView } from "../project/view";
import type { AssetLoader } from "../render/asset-loader";
import type { SceneRuntimeHandle } from "../runtime/types";
import { formatScene } from "../scene/format";
import { hashText } from "../scene/hash";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import type { GameInstance, SceneSource, StagedVersion } from "../types";
import { ENGINE_VERSION } from "../version";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const game: GameDefinition = defineGame({
  id: "stagey",
  types: [],
  actions: [],
  world: { physics: "none" },
  live: { timings: ["boundary", "now"] },
  createRuntime: () => ({ snapshot: () => null }),
});

const plain = (name: string): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  bounds: [0, 0, 10, 10],
  entities: [{ id: "start", type: "marker", at: [1, 1] }],
});

/** `name` with one sprite per texture, each texture an asset only the version carries. */
const drawn = (name: string, textures: readonly string[]): SceneDefinition => ({
  ...plain(name),
  entities: [
    { id: "start", type: "marker", at: [1, 1] },
    ...textures.map((asset, i) => ({
      id: `art-${i}`,
      type: "marker",
      at: [2 + i, 1] as [number, number],
      behaviors: { sprite: { asset, size: [1, 1] } },
    })),
  ],
});

function source(): SceneSource {
  const scenes = new Map<string, LibraryScene>(
    ["hall", "yard"].map((id) => [id, { def: plain(id), prefabs: new Map() }]),
  );
  return {
    list: () => [{ scene: "hall" }, { scene: "yard" }],
    start: () => "hall",
    scene: (id) => scenes.get(id) ?? null,
  };
}

/** A texture's content hash: what the loader keys it by, whichever version carries it. */
const pixels = (texture: string) => sha256(`${texture} pixels`);

async function textureAsset(texture: string): Promise<ReleaseAsset> {
  const sha = await pixels(texture);
  return {
    key: `k-${texture}`,
    kind: "texture",
    path: `art/${texture}.png`,
    sha256: sha,
    bytes: 100,
    storage: "blob",
    file: `live/${sha}.png`,
    meta: { format: "png", width: 16, height: 16 },
  };
}

async function versionOf(def: SceneDefinition, id: string): Promise<StagedVersion> {
  const text = formatScene(def).text;
  const sha = await sha256(text);
  const textures = (def.entities ?? []).flatMap((e) => {
    const sprite = (e.behaviors as { sprite?: { asset?: string } } | undefined)?.sprite;
    return sprite?.asset ? [sprite.asset] : [];
  });
  const assets: Record<string, ReleaseAsset> = {
    [id]: {
      key: `k-${id}`,
      kind: "scene",
      path: `scenes/${id}.json`,
      sha256: sha,
      bytes: text.length,
      storage: "doc",
      file: `live/${sha}.json`,
    },
  };
  for (const t of textures) assets[t] = await textureAsset(t);
  const entries = [...textures].sort();
  const version: SceneVersion = {
    kind: "scene-version",
    v: 1,
    project: "p",
    scene: id,
    compat: {
      formats: { scene: ENGINE_FORMATS.scene, prefab: ENGINE_FORMATS.prefab },
      build: {},
      game: { id: game.id, configHash: game.configHash ?? null },
    },
    engine: ENGINE_VERSION,
    base: null,
    entry: {
      id,
      physics: "none",
      prefabs: [],
      bundle: { entries, bytes: entries.length * 100 },
    },
    sceneHash: hashText(text),
    assets,
  };
  return { id: await sceneVersionId(version), version, texts: new Map([[sha, text]]) };
}

/**
 * Counts retains per texture hash, as a loader keyed by hash does; a load
 * that names a hash in `hang` never finishes.
 */
function countingLoader() {
  const held = new Map<string, number>();
  const hang = new Set<string>();
  const loaded: string[] = [];
  const bump = (bundle: AssetBundle, by: number) => {
    for (const e of bundle.entries) {
      const n = (held.get(e.sha256) ?? 0) + by;
      if (n === 0) held.delete(e.sha256);
      else held.set(e.sha256, n);
    }
  };
  const loader = {
    async load(bundle: AssetBundle) {
      loaded.push(...bundle.entries.map((e) => e.sha256));
      if (bundle.entries.some((e) => hang.has(e.sha256))) await new Promise(() => {});
      return { failed: [] };
    },
    retain: (bundle: AssetBundle) => bump(bundle, 1),
    release: (bundle: AssetBundle) => bump(bundle, -1),
    trim() {},
    stats: () => ({ textures: 0, bytes: 0, resident: [] }),
    texture: () => null,
    destroy() {},
  };
  return { loader: loader as unknown as AssetLoader, held, hang, loaded };
}

const games: GameInstance[] = [];
let canvas: HTMLCanvasElement;

beforeEach(() => {
  vi.useFakeTimers();
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function started() {
  const counting = countingLoader();
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
  const instance = await createGame(canvas, {
    game,
    dev: true,
    assets: { loader: counting.loader, view, kinds },
    flow: { source: source(), loading: false },
  });
  games.push(instance);
  instance.start();
  const done = instance.flow.restart();
  await vi.runAllTimersAsync();
  expect(await done).toMatchObject({ ok: true, scene: "hall" });
  return { game: instance, ...counting };
}

const world = (g: GameInstance) => g.runtime() as SceneRuntimeHandle | null;

describe("staging a version", () => {
  it("refuses a preload past the timeout, and the scene keeps what it runs", async () => {
    const t = await started();
    const v = await versionOf(drawn("hall", ["slow"]), "hall");
    t.hang.add(await pixels("slow"));

    let settled = false;
    const staging = t.game.live.stage(v).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(LIVE_DEFAULTS.preloadTimeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await staging;
    expect(result).toMatchObject({
      ok: false,
      issue: { code: "live-swap-failed", detail: { phase: "stage" } },
    });
    // Refused: not activatable, nothing held, and the running scene is untouched.
    expect(t.game.live.activate("hall", v.id, "now")).toMatchObject({
      issue: { code: "live-swap-failed" },
    });
    expect(t.game.live.current("hall")).toBeNull();
    expect(t.held.size).toBe(0);
    t.game.step();
    expect(world(t.game)?.get("art-0")).toBeUndefined();
  });

  it("stops at the caller's signal before the deadline", async () => {
    const t = await started();
    const v = await versionOf(drawn("hall", ["slow"]), "hall");
    t.hang.add(await pixels("slow"));
    const abort = new AbortController();
    const staging = t.game.live.stage(v, { signal: abort.signal });
    await vi.advanceTimersByTimeAsync(10);
    abort.abort();
    expect(await staging).toMatchObject({
      ok: false,
      issue: { code: "live-swap-failed", detail: { phase: "stage" } },
    });
    expect(t.held.size).toBe(0);
  });

  it("refuses a version that doesn't read with the cause's own code", async () => {
    const t = await started();
    const v = await versionOf(drawn("hall", ["tiles"]), "hall");
    const broken: StagedVersion = { ...v, texts: new Map() };
    expect(await t.game.live.stage(broken)).toMatchObject({
      ok: false,
      issue: { code: "asset-missing" },
    });
    expect(t.loaded).toEqual([]);
  });

  it("keeps two staged versions resident at once", async () => {
    const t = await started();
    const hall = await versionOf(drawn("hall", ["tiles"]), "hall");
    const yard = await versionOf(drawn("yard", ["moss"]), "yard");
    expect(await t.game.live.stage(hall)).toEqual({ ok: true });
    expect(await t.game.live.stage(yard)).toEqual({ ok: true });
    expect(t.held.get(await pixels("tiles"))).toBe(1);
    expect(t.held.get(await pixels("moss"))).toBe(1);
    expect(t.loaded).toEqual(expect.arrayContaining([await pixels("tiles"), await pixels("moss")]));
  });

  it("keys textures by hash: both versions stay resident through a swap, then the old one goes", async () => {
    const t = await started();
    const tiles = await pixels("tiles");
    const moss = await pixels("moss");
    const glow = await pixels("glow");

    const first = await versionOf(drawn("hall", ["tiles", "moss"]), "hall");
    expect(await t.game.live.stage(first)).toEqual({ ok: true });
    t.game.live.activate("hall", first.id, "now");
    t.game.step();
    expect(world(t.game)?.get("art-0")).toBeDefined();
    // The running scene's bundle, found through the version's assets, and the version's own hold.
    expect(t.held.get(tiles)).toBe(2);
    expect(t.held.get(moss)).toBe(2);

    const second = await versionOf(drawn("hall", ["tiles", "glow"]), "hall");
    expect(await t.game.live.stage(second)).toEqual({ ok: true });
    // Both versions resident: the hash they share is held by each.
    expect(t.held.get(tiles)).toBe(3);
    expect(t.held.get(moss)).toBe(2);
    expect(t.held.get(glow)).toBe(1);

    t.game.live.activate("hall", second.id, "now");
    t.game.step();
    expect(world(t.game)?.ctx.live.version).toBe(second.id);
    // The first version is let go; the shared hash stays with the second.
    expect(t.held.get(tiles)).toBe(2);
    expect(t.held.has(moss)).toBe(false);
    expect(t.held.get(glow)).toBe(2);
  });
});

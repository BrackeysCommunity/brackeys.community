// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AssetBundle, BundleEntry } from "../../project/bundle";
import type { Sha256 } from "../../project/types";
import {
  createAssetLoader as createLoader,
  type AssetLoader,
  type LoadProgress,
} from "../asset-loader";

/** URL uses are shared by every loader on Pixi's cache, so every test lets go of what its loaders hold. */
const live: AssetLoader[] = [];
function createAssetLoader(opts: Parameters<typeof createLoader>[0]): AssetLoader {
  const loader = createLoader(opts);
  live.push(loader);
  return loader;
}

/** The blobs the fake server holds, by URL: a decoded size, or a status to refuse with. */
const server = new Map<string, { w: number; h: number } | number>();
const fetcher = vi.fn(async (url: string) => {
  const blob = server.get(url);
  if (blob === undefined) return new Response(null, { status: 404 });
  if (typeof blob === "number") return new Response(null, { status: blob });
  return new Response(JSON.stringify(blob), { status: 200 });
});

type FakeTexture = {
  width: number;
  height: number;
  source: { pixelWidth: number; pixelHeight: number };
};

const pixi = vi.hoisted(() => ({
  load: vi.fn(),
  unload: vi.fn(async (_src: string) => {}),
}));

vi.mock("pixi.js", () => ({ Assets: pixi }));

beforeEach(() => {
  server.clear();
  fetcher.mockClear();
  pixi.unload.mockReset();
  pixi.unload.mockImplementation(async () => {});
  pixi.load.mockReset();
  pixi.load.mockImplementation(async (asset: { src: string; parser?: string }) => {
    if (asset.parser !== "texture") throw new Error(`no parser for ${asset.src}`);
    const response = await fetcher(asset.src);
    if (!response.ok) throw new Error(`${asset.src}: ${response.status}`);
    const { w, h } = (await response.json()) as { w: number; h: number };
    const texture: FakeTexture = {
      width: w,
      height: h,
      source: { pixelWidth: w, pixelHeight: h },
    };
    return texture;
  });
});

afterEach(() => {
  for (const loader of live.splice(0)) loader.destroy();
  vi.useRealTimers();
});

const hash = (n: number) => n.toString(16).padStart(64, "0") as Sha256;
const url = (_project: string, entry: BundleEntry) => `/blobs/${entry.sha256}`;

function entry(id: string, n: number, bytes = 10): BundleEntry {
  return { id, kind: "texture", sha256: hash(n), bytes };
}

function bundle(name: string, entries: BundleEntry[]): AssetBundle {
  return { name, entries, bytes: entries.reduce((s, e) => s + e.bytes, 0) };
}

/** Serves `n` as a `side`×`side` texture: `side * side * 4` decoded bytes. */
function serve(n: number, side = 4): void {
  server.set(`/blobs/${hash(n)}`, { w: side, h: side });
}

describe("createAssetLoader", () => {
  it("loads a bundle's textures with the texture parser forced, keyed by hash", async () => {
    serve(1);
    serve(2, 2);
    const loader = createAssetLoader({ project: "p", url });
    const seen: Sha256[] = [];
    loader.onLoad((h) => seen.push(h));

    const result = await loader.load(bundle("level", [entry("a", 1), entry("b", 2)]));

    expect(result).toEqual({ failed: [] });
    expect(pixi.load.mock.calls.map(([a]) => a)).toEqual([
      { src: `/blobs/${hash(1)}`, parser: "texture" },
      { src: `/blobs/${hash(2)}`, parser: "texture" },
    ]);
    expect(seen.sort()).toEqual([hash(1), hash(2)]);
    expect(loader.get(hash(1))).toMatchObject({ width: 4 });
    expect(loader.get(hash(3))).toBeNull();
    expect(loader.stats()).toEqual({ textures: 2, bytes: 4 * 4 * 4 + 2 * 2 * 4, resident: [] });
  });

  it("loads a hash two bundles share once, even while both are in flight", async () => {
    serve(1);
    serve(2);
    const loader = createAssetLoader({ project: "p", url });
    const a = bundle("a", [entry("x", 1), entry("y", 2)]);
    const b = bundle("b", [entry("z", 1)]);

    await Promise.all([loader.load(a), loader.load(b)]);
    await loader.load(b);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(loader.stats().textures).toBe(2);
  });

  it("counts two ids with the same content as one blob", async () => {
    serve(1);
    const loader = createAssetLoader({ project: "p", url });
    const progress: LoadProgress[] = [];

    await loader.load(bundle("a", [entry("x", 1, 7), entry("y", 1, 7)]), (p) => progress.push(p));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toEqual({ loaded: 1, total: 1, bytes: 7, totalBytes: 7 });
  });

  it("reports failures instead of throwing, and retries them on the next load", async () => {
    serve(1);
    server.set(`/blobs/${hash(2)}`, 500);
    const loader = createAssetLoader({ project: "p", url });
    const missing = entry("gone", 3);
    const broken = entry("broken", 2);

    const result = await loader.load(bundle("a", [entry("ok", 1), broken, missing]));

    expect(result.failed).toEqual([broken, missing]);
    expect(loader.get(hash(2))).toBeNull();
    serve(2);
    expect(await loader.load(bundle("a", [broken]))).toEqual({ failed: [] });
    expect(loader.get(hash(2))).not.toBeNull();
  });

  it("reports progress that only grows, in count and bytes, and ends at the totals", async () => {
    serve(1);
    serve(2);
    serve(3);
    const loader = createAssetLoader({ project: "p", url });
    await loader.load(bundle("warm", [entry("a", 1, 5)]));
    server.set(`/blobs/${hash(3)}`, 404);
    const progress: LoadProgress[] = [];

    await loader.load(
      bundle("level", [entry("a", 1, 5), entry("b", 2, 20), entry("c", 3, 40)]),
      (p) => progress.push(p),
    );

    expect(progress[0]).toEqual({ loaded: 1, total: 3, bytes: 5, totalBytes: 65 });
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]!.loaded).toBeGreaterThanOrEqual(progress[i - 1]!.loaded);
      expect(progress[i]!.bytes).toBeGreaterThanOrEqual(progress[i - 1]!.bytes);
    }
    expect(progress.at(-1)).toEqual({ loaded: 3, total: 3, bytes: 65, totalBytes: 65 });
  });

  it("counts retains per bundle and evicts nothing while within the budget", async () => {
    for (const n of [1, 2]) serve(n);
    // 4×4 textures are 64 bytes each: two fit.
    const loader = createAssetLoader({ project: "p", url, budgetBytes: 128 });
    const a = bundle("a", [entry("x", 1), entry("y", 2)]);
    await loader.load(a);
    loader.retain(a);
    loader.retain(a);
    expect(loader.stats().resident).toEqual(["a"]);

    loader.release(a);
    expect(loader.stats().resident).toEqual(["a"]);
    loader.release(a);
    loader.release(a);

    expect(loader.stats()).toEqual({ textures: 2, bytes: 128, resident: [] });
    expect(pixi.unload).not.toHaveBeenCalled();
  });

  it("evicts released textures least-recently-used past the budget, never a held one", async () => {
    for (const n of [1, 2, 3, 4]) serve(n);
    const loader = createAssetLoader({ project: "p", url, budgetBytes: 128 });
    const old = bundle("old", [entry("a", 1), entry("b", 2)]);
    const next = bundle("next", [entry("b", 2), entry("c", 3), entry("d", 4)]);
    await loader.load(old);
    loader.retain(old);
    loader.get(hash(1));

    await loader.load(next);
    loader.retain(next);
    loader.release(old);

    // Only `a` is free; it goes even though the held ones still overflow the budget.
    expect(loader.get(hash(1))).toBeNull();
    expect(pixi.unload).toHaveBeenCalledWith(`/blobs/${hash(1)}`);
    expect(loader.stats()).toMatchObject({ textures: 3, bytes: 192, resident: ["next"] });

    // Least recently used goes first: b was drawn last, so c is the oldest free one.
    loader.get(hash(2));
    loader.release(next);
    expect(loader.stats()).toMatchObject({ textures: 2, bytes: 128 });
    expect(loader.get(hash(3))).toBeNull();
    expect(loader.get(hash(2))).not.toBeNull();
    expect(loader.get(hash(4))).not.toBeNull();
  });

  it("keeps a texture both scenes use when the new one retains before the old releases", async () => {
    for (const n of [1, 2]) serve(n);
    const loader = createAssetLoader({ project: "p", url, budgetBytes: 0 });
    const first = bundle("first", [entry("a", 1), entry("b", 2)]);
    const second = bundle("second", [entry("b", 2)]);
    await loader.load(first);
    loader.retain(first);

    loader.retain(second);
    loader.release(first);

    expect(loader.get(hash(1))).toBeNull();
    expect(loader.get(hash(2))).not.toBeNull();
  });

  it("releases everything on destroy and loads nothing after", async () => {
    serve(1);
    serve(2);
    const loader = createAssetLoader({ project: "p", url });
    const a = bundle("a", [entry("x", 1)]);
    await loader.load(a);
    loader.retain(a);
    const late = loader.load(bundle("b", [entry("y", 2)]));

    loader.destroy();

    expect(loader.stats()).toEqual({ textures: 0, bytes: 0, resident: [] });
    expect(pixi.unload).toHaveBeenCalledWith(`/blobs/${hash(1)}`);
    await late;
    expect(loader.get(hash(2))).toBeNull();
    expect(pixi.unload).toHaveBeenCalledWith(`/blobs/${hash(2)}`);
    expect(await loader.load(a)).toEqual({ failed: [entry("x", 1)] });
  });

  it("reloads an evicted hash only after its unload settles, getting a fresh texture", async () => {
    serve(1);
    // Pixi's cache: a URL's load promise stays cached until its unload has awaited it.
    const cache = new Map<string, Promise<FakeTexture & { destroyed?: boolean }>>();
    const fresh = pixi.load.getMockImplementation()!;
    pixi.load.mockImplementation((asset: { src: string; parser?: string }) => {
      let cached = cache.get(asset.src);
      if (!cached) cache.set(asset.src, (cached = fresh(asset)));
      return cached;
    });
    let finishUnload!: () => void;
    pixi.unload.mockImplementationOnce(async (src: string) => {
      const texture = await cache.get(src)!;
      await new Promise<void>((r) => (finishUnload = r));
      cache.delete(src);
      texture.destroyed = true;
    });
    const loader = createAssetLoader({ project: "p", url, budgetBytes: 0 });
    const level = bundle("level", [entry("a", 1)]);
    await loader.load(level);
    const old = loader.get(hash(1));
    loader.retain(level);

    loader.release(level);
    const reload = loader.load(level);
    await vi.waitFor(() => expect(finishUnload).toBeTypeOf("function"));
    expect(pixi.load).toHaveBeenCalledTimes(1);
    finishUnload();
    expect(await reload).toEqual({ failed: [] });

    const resident = loader.get(hash(1)) as (FakeTexture & { destroyed?: boolean }) | null;
    expect(resident).not.toBeNull();
    expect(resident).not.toBe(old);
    expect(resident!.destroyed).toBeUndefined();
    expect((old as { destroyed?: boolean }).destroyed).toBe(true);
  });

  it("leaves a texture another loader holds when a destroyed loader's load settles", async () => {
    serve(1);
    // Pixi's cache: every load of a URL gets the same texture until it is unloaded.
    const cache = new Map<string, Promise<FakeTexture & { destroyed?: boolean }>>();
    const fresh = pixi.load.getMockImplementation()!;
    let arrive!: () => void;
    const gate = new Promise<void>((r) => (arrive = r));
    pixi.load.mockImplementation((asset: { src: string; parser?: string }) => {
      let cached = cache.get(asset.src);
      if (!cached) cache.set(asset.src, (cached = gate.then(() => fresh(asset))));
      return cached;
    });
    pixi.unload.mockImplementation(async (src: string) => {
      const texture = await cache.get(src);
      cache.delete(src);
      if (texture) texture.destroyed = true;
    });
    const level = bundle("level", [entry("a", 1)]);
    const a = createAssetLoader({ project: "p", url });
    const first = a.load(level);
    await vi.waitFor(() => expect(pixi.load).toHaveBeenCalledTimes(1));

    a.destroy();
    const b = createAssetLoader({ project: "p", url });
    const second = b.load(level);
    await vi.waitFor(() => expect(pixi.load).toHaveBeenCalledTimes(2));
    arrive();

    expect(await first).toEqual({ failed: [entry("a", 1)] });
    expect(await second).toEqual({ failed: [] });
    const texture = b.get(hash(1)) as (FakeTexture & { destroyed?: boolean }) | null;
    expect(texture).not.toBeNull();
    expect(texture!.destroyed).toBeUndefined();
    expect(pixi.unload).not.toHaveBeenCalled();

    b.destroy();
    await vi.waitFor(() => expect(pixi.unload).toHaveBeenCalledWith(`/blobs/${hash(1)}`));
    expect(texture!.destroyed).toBe(true);
  });

  it("keeps its state per loader", async () => {
    serve(1);
    const one = createAssetLoader({ project: "p", url });
    const two = createAssetLoader({ project: "q", url });
    await one.load(bundle("a", [entry("x", 1)]));
    expect(two.get(hash(1))).toBeNull();
    expect(two.stats().textures).toBe(0);
  });
});

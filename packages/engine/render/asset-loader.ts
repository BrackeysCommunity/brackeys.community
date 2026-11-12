import { Assets, type Texture } from "pixi.js";

import type { AssetBundle, BundleEntry } from "../project/bundle";
import type { ProjectId, Sha256 } from "../project/types";
import type { TextureSource } from "./pixi-view";

/** Where the host serves a bundle entry's bytes: dev server, site API or an exported file. */
export type AssetUrl = (project: ProjectId, entry: BundleEntry) => string;

/** `loaded` and `bytes` count the bundle's distinct blobs settled so far, failures included. */
export type LoadProgress = { loaded: number; total: number; bytes: number; totalBytes: number };

/**
 * Textures by content hash, shared by every bundle that holds the hash,
 * counted per resident bundle and evicted least-recently-used past a byte
 * budget once no resident bundle holds them.
 */
export type AssetLoader = TextureSource & {
  /** Loads every entry not resident; resolves when all are (failures reported, never thrown). */
  load(
    bundle: AssetBundle,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<{ failed: BundleEntry[] }>;
  /** Marks a bundle resident (`retain`) or done with (`release`); textures no resident bundle holds may be evicted. */
  retain(bundle: AssetBundle): void;
  release(bundle: AssetBundle): void;
  /** Evicts released textures least-recently-used until resident bytes fit the budget. */
  trim(): void;
  stats(): { textures: number; bytes: number; resident: string[] };
  /**
   * Drops every resident texture's GPU copy, by hash, so the renderer that
   * draws next uploads it again from its decoded image: what a renderer
   * rebuilt after a lost GPU context needs. A host's own loader may leave it out.
   */
  reupload?(): void;
  destroy(): void;
};

const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;

/**
 * What every loader on one Pixi `Assets` cache shares, by URL. Pixi hands
 * every load of a URL the same texture, so only the last loader holding or
 * loading it (`users`) may unload it; and it keeps a URL's cached load until
 * that unload has awaited it, so a load issued while one settles
 * (`unloading`) waits for it rather than get a texture about to be destroyed.
 */
type UrlUses = { users: Map<string, number>; unloading: Map<string, Promise<void>> };

const usesByCache = new WeakMap<object, UrlUses>();

function urlUses(cache: object): UrlUses {
  let uses = usesByCache.get(cache);
  if (!uses) usesByCache.set(cache, (uses = { users: new Map(), unloading: new Map() }));
  return uses;
}

type Resident = { texture: Texture; url: string; bytes: number; used: number };

/** Decoded RGBA bytes: what a texture costs the GPU, whatever its file weighed. */
function decodedBytes(texture: Texture): number {
  const source = texture.source as { pixelWidth?: number; pixelHeight?: number } | undefined;
  const w = source?.pixelWidth ?? texture.width;
  const h = source?.pixelHeight ?? texture.height;
  return Math.max(0, w) * Math.max(0, h) * 4;
}

/** A bundle's entries, one per hash (two ids may share content). */
function byHash(bundle: AssetBundle): Map<Sha256, BundleEntry> {
  const out = new Map<Sha256, BundleEntry>();
  for (const entry of bundle.entries) if (!out.has(entry.sha256)) out.set(entry.sha256, entry);
  return out;
}

/**
 * Loads textures through Pixi's `Assets` with the texture parser forced,
 * since hash URLs carry no extension. Retaining and releasing are by bundle
 * object: retain the bundle you later release. `release` trims.
 */
export function createAssetLoader(opts: {
  project: ProjectId;
  url: AssetUrl;
  /** Default 256 MiB of decoded texture bytes. */
  budgetBytes?: number;
}): AssetLoader {
  const budget = opts.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const textures = new Map<Sha256, Resident>();
  const pending = new Map<Sha256, Promise<boolean>>();
  const holds = new Map<Sha256, number>();
  const retained = new Map<AssetBundle, number>();
  const listeners = new Set<(hash: Sha256) => void>();
  let clock = 0;
  let residentBytes = 0;
  let destroyed = false;
  const { users, unloading } = urlUses(Assets);

  function acquire(url: string): void {
    users.set(url, (users.get(url) ?? 0) + 1);
  }

  /** Drops one use of `url`; true when that was the last. */
  function letGo(url: string): boolean {
    const count = users.get(url) ?? 0;
    if (count > 1) {
      users.set(url, count - 1);
      return false;
    }
    users.delete(url);
    return true;
  }

  function unload(resident: Resident): void {
    const { url } = resident;
    if (!letGo(url)) return;
    const done: Promise<void> = Assets.unload(url)
      .catch(() => {})
      .finally(() => {
        if (unloading.get(url) === done) unloading.delete(url);
      });
    unloading.set(url, done);
  }

  function fetchOne(hash: Sha256, entry: BundleEntry): Promise<boolean> {
    const inFlight = pending.get(hash);
    if (inFlight) return inFlight;
    const url = opts.url(opts.project, entry);
    const job = (async () => {
      let texture: Texture;
      acquire(url);
      try {
        await unloading.get(url);
        texture = await Assets.load<Texture>({ src: url, parser: "texture" });
      } catch {
        letGo(url);
        return false;
      } finally {
        pending.delete(hash);
      }
      if (!texture) {
        letGo(url);
        return false;
      }
      const resident: Resident = { texture, url, bytes: decodedBytes(texture), used: ++clock };
      if (destroyed) {
        unload(resident);
        return false;
      }
      textures.set(hash, resident);
      residentBytes += resident.bytes;
      for (const cb of [...listeners]) cb(hash);
      return true;
    })();
    pending.set(hash, job);
    return job;
  }

  function evict(hash: Sha256): void {
    const resident = textures.get(hash);
    if (!resident) return;
    textures.delete(hash);
    residentBytes -= resident.bytes;
    unload(resident);
  }

  function trim(): void {
    if (residentBytes <= budget) return;
    const free = [...textures].filter(([hash]) => !holds.has(hash));
    free.sort((a, b) => a[1].used - b[1].used);
    for (const [hash] of free) {
      if (residentBytes <= budget) break;
      evict(hash);
    }
  }

  return {
    get(hash) {
      const resident = textures.get(hash);
      if (!resident) return null;
      resident.used = ++clock;
      return resident.texture;
    },
    onLoad(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    async load(bundle, onProgress) {
      const wanted = byHash(bundle);
      if (destroyed) return { failed: [...wanted.values()] };
      const total = wanted.size;
      let totalBytes = 0;
      for (const entry of wanted.values()) totalBytes += entry.bytes;
      let loaded = 0;
      let bytes = 0;
      const report = () => onProgress?.({ loaded, total, bytes, totalBytes });
      const jobs: Promise<BundleEntry | null>[] = [];
      for (const [hash, entry] of wanted) {
        const resident = textures.get(hash);
        if (resident) {
          resident.used = ++clock;
          loaded++;
          bytes += entry.bytes;
          continue;
        }
        jobs.push(
          fetchOne(hash, entry).then((ok) => {
            loaded++;
            bytes += entry.bytes;
            report();
            return ok ? null : entry;
          }),
        );
      }
      report();
      const settled = await Promise.all(jobs);
      const failed = new Set(settled.flatMap((e) => (e ? [e.sha256] : [])));
      return { failed: bundle.entries.filter((e) => failed.has(e.sha256)) };
    },
    retain(bundle) {
      if (destroyed) return;
      retained.set(bundle, (retained.get(bundle) ?? 0) + 1);
      for (const hash of byHash(bundle).keys()) {
        holds.set(hash, (holds.get(hash) ?? 0) + 1);
        const resident = textures.get(hash);
        if (resident) resident.used = ++clock;
      }
    },
    release(bundle) {
      const count = retained.get(bundle);
      if (count === undefined) return;
      if (count > 1) retained.set(bundle, count - 1);
      else retained.delete(bundle);
      for (const hash of byHash(bundle).keys()) {
        const held = holds.get(hash) ?? 0;
        if (held > 1) holds.set(hash, held - 1);
        else holds.delete(hash);
      }
      trim();
    },
    trim,
    reupload() {
      for (const { texture } of textures.values()) texture.source?.unload();
    },
    stats: () => ({
      textures: textures.size,
      bytes: residentBytes,
      resident: [...retained.keys()].map((b) => b.name).sort(),
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const resident of textures.values()) unload(resident);
      textures.clear();
      residentBytes = 0;
      holds.clear();
      retained.clear();
      listeners.clear();
    },
  };
}

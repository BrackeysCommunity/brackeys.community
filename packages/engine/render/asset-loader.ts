import {
  Assets,
  BitmapFont,
  type BitmapFontData,
  bitmapFontTextParser,
  bitmapFontXMLStringParser,
  Cache,
  type Texture,
} from "pixi.js";

import type { AssetBundle, BundleEntry } from "../project/bundle";
import { parseBmfont } from "../project/inspect/bmfont";
import { readFontFormat } from "../project/inspect/font";
import { FONT_KIND } from "../project/kinds/font";
import type { AssetId, ProjectId, Sha256 } from "../project/types";
import { ensureWebFont, webFontFamily } from "../ui/web-font";
import type { TextureSource } from "./pixi-view";
import type { FontSource } from "./text";

/** Where the host serves a bundle entry's bytes: dev server, site API or an exported file. */
export type AssetUrl = (project: ProjectId, entry: BundleEntry) => string;

/** `loaded` and `bytes` count the bundle's distinct blobs settled so far, failures included. */
export type LoadProgress = { loaded: number; total: number; bytes: number; totalBytes: number };

/**
 * Textures and fonts by content hash, shared by every bundle that holds the
 * hash, counted per resident bundle and evicted least-recently-used past a
 * byte budget once no resident bundle holds them. A host's own loader may
 * leave the font members out; its text then draws in the default face.
 */
export type AssetLoader = TextureSource &
  Partial<Pick<FontSource, "bitmapFamily" | "webFamily">> & {
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

/** Numbers each loader, so two loaders installing one font never share Pixi's cache entry. */
let loaderSerial = 0;

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

/** A loaded font: a BMFont's glyph layout, or a web font registered with the document (`added` when this loader added it). */
type LoadedFont =
  | { kind: "bitmap"; data: BitmapFontData }
  | { kind: "web"; family: string; face: FontFace; added: boolean };

/** A texture or a font; `bytes` is a texture's decoded size, a font's file size. */
type Resident = {
  texture: Texture | null;
  font: LoadedFont | null;
  url: string;
  bytes: number;
  used: number;
};

/** A BMFont installed into Pixi's cache under `family`, drawn from `pages`. */
type Installed = { family: string; pages: readonly Sha256[]; font: BitmapFont };

/**
 * A BMFont's glyph layout from its text or XML form, as Pixi draws it; null
 * when it isn't one. Pixi's parsers give the glyph rectangles; the size and
 * distance field are the font kind's reading, which Pixi's text parser misses.
 */
function bitmapFontData(text: string): BitmapFontData | null {
  const layout = parseBmfont(text);
  if (!layout) return null;
  const body = text.replace(/^\uFEFF/, "");
  const data = /<font[\s>]/.test(body)
    ? bitmapFontXMLStringParser.parse(body)
    : bitmapFontTextParser.parse(body);
  // A negative BMFont size is the same size matched by cell height.
  data.fontSize = Math.abs(layout.size ?? 0) || layout.lineHeight;
  if (layout.distanceField) data.distanceField = { ...layout.distanceField };
  else delete data.distanceField;
  return data;
}

/**
 * `data` as a Pixi font on `pages`, its pixel-less glyphs (a space's 0×0
 * cell) left without a texture: they still advance, and Pixi's Canvas2D
 * renderer would otherwise tint each into a canvas its size, and drawing a
 * 0×0 canvas throws in Firefox.
 */
export function bitmapFontOn(data: BitmapFontData, pages: Texture[]): BitmapFont {
  const font = new BitmapFont({ data, textures: pages });
  for (const [key, glyph] of Object.entries(data.chars)) {
    if (glyph.width > 0 && glyph.height > 0) continue;
    const char = font.chars[key];
    if (!char) continue;
    char.texture?.destroy();
    delete char.texture;
  }
  return font;
}

/** A font's bytes loaded: a web font registered with `document.fonts` under its hash's family, else a BMFont. */
async function readFont(hash: Sha256, buffer: ArrayBuffer): Promise<LoadedFont | null> {
  const bytes = new Uint8Array(buffer);
  if (readFontFormat(bytes)) {
    const made = ensureWebFont(document, hash, buffer);
    if (!made) return null;
    try {
      await made.face.load();
    } catch (error) {
      if (made.added) document.fonts.delete(made.face);
      throw error;
    }
    return { kind: "web", family: webFontFamily(hash), face: made.face, added: made.added };
  }
  const data = bitmapFontData(new TextDecoder().decode(bytes));
  return data ? { kind: "bitmap", data } : null;
}

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
 * since hash URLs carry no extension, and fonts by fetching their bytes: a
 * web font becomes a `FontFace` once per hash, a BMFont is installed into
 * Pixi's cache once its pages have loaded too. Retaining and releasing are
 * by bundle object: retain the bundle you later release. `release` trims.
 */
export function createAssetLoader(opts: {
  project: ProjectId;
  url: AssetUrl;
  /** Default 256 MiB of decoded texture bytes and font file bytes. */
  budgetBytes?: number;
  /** How a font's bytes are fetched; default the global `fetch`. */
  fetch?: (url: string) => Promise<Response>;
}): AssetLoader & FontSource {
  const budget = opts.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const fetchBlob = opts.fetch ?? ((url: string) => fetch(url));
  const serial = ++loaderSerial;
  /** Font hashes by asset id, from the bundles loaded: what a web font's ref may name. */
  const fontIds = new Map<AssetId, Sha256>();
  const installed = new Map<Sha256, Installed>();
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

  function uninstall(hash: Sha256): void {
    const font = installed.get(hash);
    if (!font) return;
    installed.delete(hash);
    Cache.remove(`${font.family}-bitmap`);
    // The pages are the loader's textures: emptied first, so the font's destroy leaves them be.
    font.font.pages.length = 0;
    font.font.destroy();
  }

  function unload(resident: Resident): void {
    if (resident.font) {
      // A face the DOM helpers added first stays theirs.
      if (resident.font.kind === "web" && resident.font.added)
        document.fonts.delete(resident.font.face);
      return;
    }
    const { url } = resident;
    if (!letGo(url)) return;
    const done: Promise<void> = Assets.unload(url)
      .catch(() => {})
      .finally(() => {
        if (unloading.get(url) === done) unloading.delete(url);
      });
    unloading.set(url, done);
  }

  function settleResident(hash: Sha256, resident: Resident): boolean {
    if (destroyed) {
      unload(resident);
      return false;
    }
    textures.set(hash, resident);
    residentBytes += resident.bytes;
    for (const cb of [...listeners]) cb(hash);
    return true;
  }

  function fetchFont(hash: Sha256, entry: BundleEntry, url: string): Promise<boolean> {
    return (async () => {
      let font: LoadedFont | null;
      try {
        const response = await fetchBlob(url);
        if (!response.ok) return false;
        font = await readFont(hash, await response.arrayBuffer());
      } catch {
        return false;
      } finally {
        pending.delete(hash);
      }
      if (!font) return false;
      return settleResident(hash, { texture: null, font, url, bytes: entry.bytes, used: ++clock });
    })();
  }

  function fetchOne(hash: Sha256, entry: BundleEntry): Promise<boolean> {
    const inFlight = pending.get(hash);
    if (inFlight) return inFlight;
    const url = opts.url(opts.project, entry);
    if (entry.kind === FONT_KIND) {
      const job = fetchFont(hash, entry, url);
      pending.set(hash, job);
      return job;
    }
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
      return settleResident(hash, {
        texture,
        font: null,
        url,
        bytes: decodedBytes(texture),
        used: ++clock,
      });
    })();
    pending.set(hash, job);
    return job;
  }

  function evict(hash: Sha256): void {
    const resident = textures.get(hash);
    if (!resident) return;
    textures.delete(hash);
    residentBytes -= resident.bytes;
    for (const [font, { pages }] of [...installed])
      if (font === hash || pages.includes(hash)) uninstall(font);
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

  /** The resident font `ref` names, by hash or by a loaded bundle's asset id. */
  function fontAt(ref: string): { hash: Sha256; font: LoadedFont } | null {
    const hash = textures.has(ref) ? ref : fontIds.get(ref);
    const resident = hash === undefined ? undefined : textures.get(hash);
    if (!resident?.font || hash === undefined) return null;
    resident.used = ++clock;
    return { hash, font: resident.font };
  }

  return {
    get(hash) {
      const resident = textures.get(hash);
      if (!resident?.texture) return null;
      resident.used = ++clock;
      return resident.texture;
    },
    bitmapFamily(hash, pages) {
      const found = fontAt(hash);
      if (found?.font.kind !== "bitmap" || pages.length === 0) return null;
      const current = installed.get(hash);
      if (current && current.pages.join() === pages.join()) return current.family;
      const pageTextures: Texture[] = [];
      for (const page of pages) {
        const texture = textures.get(page)?.texture;
        if (!texture) return null;
        pageTextures.push(texture);
      }
      uninstall(hash);
      const family = `jams-bmfont-${serial}-${hash}`;
      const font = bitmapFontOn(found.font.data, pageTextures);
      Cache.set(`${family}-bitmap`, font);
      installed.set(hash, { family, pages: [...pages], font });
      return family;
    },
    webFamily(ref) {
      const found = fontAt(ref);
      return found?.font.kind === "web" ? found.font.family : null;
    },
    onLoad(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    async load(bundle, onProgress) {
      const wanted = byHash(bundle);
      if (destroyed) return { failed: [...wanted.values()] };
      for (const entry of bundle.entries)
        if (entry.kind === FONT_KIND) fontIds.set(entry.id, entry.sha256);
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
      for (const { texture } of textures.values()) texture?.source?.unload();
    },
    stats: () => ({
      textures: [...textures.values()].filter((r) => r.texture).length,
      bytes: residentBytes,
      resident: [...retained.keys()].map((b) => b.name).sort(),
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const hash of [...installed.keys()]) uninstall(hash);
      for (const resident of textures.values()) unload(resident);
      textures.clear();
      residentBytes = 0;
      holds.clear();
      retained.clear();
      listeners.clear();
      fontIds.clear();
    },
  };
}

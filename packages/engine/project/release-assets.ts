import type { Registry } from "../game/types";
import { scenePhysics } from "../scene/expand";
import { makeIssue } from "../scene/issues";
import { prefabsUsedBy } from "../scene/prefab";
import type { PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import { blobContent, type AssetBundle } from "./bundle";
import { sha256 } from "./hash";
import type { KindRegistry } from "./kinds";
import { byCodeUnit } from "./kinds/define";
import { sceneKind } from "./kinds/scene";
import type { SceneListEntry } from "./kinds/scene-list";
import type { RefIndex } from "./refs";
import type { ReleaseAsset, ReleaseScene } from "./release";
import type { AssetEntry, AssetId, ProjectView, Sha256 } from "./types";

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** `<dir>/<sha256><ext>`: a blob's file under `dir`, its extension the one its path ends in. */
export function blobFileIn(dir: string, path: string, hash: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return `${dir}/${hash}${/^\.[a-z0-9]+$/.test(ext) ? ext : ""}`;
}

/** Where a carried asset's content goes, by its hash. */
export type AssetFiles = {
  doc(hash: Sha256): string;
  blob(path: string, hash: Sha256): string;
};

/** A release's files: `data/<sha256>.json` and `assets/<sha256><ext>`. */
export const releaseFiles: AssetFiles = {
  doc: (hash) => `data/${hash}.json`,
  blob: (path, hash) => blobFileIn("assets", path, hash),
};

/** A scene version's files: `live/<sha256>.json` and `live/<sha256><ext>`. */
export const liveFiles: AssetFiles = {
  doc: (hash) => `live/${hash}.json`,
  blob: (path, hash) => blobFileIn("live", path, hash),
};

/**
 * Every live doc and blob `roots` reach through `index`'s references, the
 * roots included, sorted by id. A scene is taken only when `takesScene`
 * says so: a release ships only the scenes it lists, a version carries only
 * its own.
 */
export function reachedAssets(
  view: ProjectView,
  kinds: KindRegistry,
  index: RefIndex,
  roots: readonly AssetId[],
  takesScene: (id: AssetId) => boolean,
): AssetId[] {
  const takes = (entry: AssetEntry | undefined): entry is AssetEntry => {
    if (!entry) return false;
    const storage = kinds.get(entry.kind)?.storage;
    if (storage !== "doc" && storage !== "blob") return false;
    return entry.kind !== sceneKind.kind || takesScene(entry.id);
  };
  const seen = new Set<AssetId>();
  const pending = [...roots];
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    if (seen.has(id) || !takes(view.byId.get(id))) continue;
    seen.add(id);
    for (const site of index.targets(id)) pending.push(site.id);
  }
  return [...seen].sort(byCodeUnit);
}

export type ReleaseAssetOptions = {
  kinds: KindRegistry;
  texts: ReadonlyMap<AssetId, string>;
  files: AssetFiles;
  /** The blobs whose missing size an earlier issue already names. */
  unsized: ReadonlySet<AssetId>;
  issues: SceneIssue[];
  /** What the missing-content issues say: for a doc without text, and for a blob without a size (null: skipped silently). */
  missing: {
    text(entry: AssetEntry): string;
    blob(entry: AssetEntry): string | null;
  };
};

/**
 * `entry` as a release or a version carries it: a doc by its canonical
 * text's hash and size, a blob by its recorded content, each with its file,
 * name, licence, and a blob's meta and import settings. Null, with an issue
 * through `opts.missing`, when it has neither; `text` is the doc's.
 */
export async function releaseAssetOf(
  entry: AssetEntry,
  opts: ReleaseAssetOptions,
): Promise<{ asset: ReleaseAsset; text?: string } | null> {
  const common = {
    key: entry.key,
    kind: entry.kind,
    path: entry.path,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
  };
  const licence =
    entry.licence && Object.keys(entry.licence).length > 0
      ? { licence: structuredClone(entry.licence) }
      : {};
  const missing = (message: string): null => {
    opts.issues.push(makeIssue("asset-missing", { message, entityIds: [entry.id], got: entry.id }));
    return null;
  };
  if (opts.kinds.get(entry.kind)?.storage === "doc") {
    const text = opts.texts.get(entry.id);
    if (text === undefined) return missing(opts.missing.text(entry));
    const hash = await sha256(text);
    const asset: ReleaseAsset = {
      ...common,
      sha256: hash,
      bytes: utf8Bytes(text),
      storage: "doc",
      file: opts.files.doc(hash),
      ...licence,
    };
    return { asset, text };
  }
  // The size becomes the build file's row and the pin, so a guessed one would disagree with the bytes shipped.
  const content = blobContent(entry);
  if (!content) {
    if (opts.unsized.has(entry.id)) return null;
    const message = opts.missing.blob(entry);
    return message === null ? null : missing(message);
  }
  const asset: ReleaseAsset = {
    ...common,
    ...content,
    storage: "blob",
    file: opts.files.blob(entry.path, content.sha256),
    ...(entry.meta && Object.keys(entry.meta).length > 0
      ? { meta: structuredClone(entry.meta) }
      : {}),
    ...(entry.import && Object.keys(entry.import).length > 0
      ? { import: structuredClone(entry.import) }
      : {}),
    ...licence,
  };
  return { asset };
}

/**
 * A carried asset back as a project view's entry: its id, kind, path and
 * name, a blob's hash, size, import settings and meta, and its licence.
 */
export function assetEntryOf(
  id: AssetId,
  a: ReleaseAsset,
  created: AssetEntry["created"],
): AssetEntry {
  const blob = a.storage === "blob";
  return {
    key: a.key,
    id,
    kind: a.kind,
    path: a.path,
    ...(a.name !== undefined ? { name: a.name } : {}),
    ...(blob ? { sha256: a.sha256, bytes: a.bytes } : {}),
    ...(blob && a.import ? { import: structuredClone(a.import) } : {}),
    ...(blob && a.meta ? { meta: structuredClone(a.meta) } : {}),
    ...(a.licence ? { licence: { ...a.licence } } : {}),
    created,
  };
}

/** A listed scene's id, title and sublevel flag, as its `flow.scenes` entry starts. */
export const listedFields = (
  listed: SceneListEntry,
): Pick<ReleaseScene, "id" | "title" | "sublevel"> => ({
  id: listed.scene,
  ...(listed.title !== undefined ? { title: listed.title } : {}),
  ...(listed.sublevel ? { sublevel: true as const } : {}),
});

/**
 * A scene's `flow.scenes` entry as a release writes it, and a version
 * carries it: the scene list's fields, the physics it resolves to, the
 * prefabs its expansion used, and its bundle's ids and size.
 */
export function releaseSceneEntry(
  listed: SceneListEntry,
  def: SceneDefinition,
  library: PrefabLibrary,
  bundle: Pick<AssetBundle, "entries" | "bytes">,
  registry: Registry,
  engine: Readonly<Record<string, unknown>> | undefined,
): ReleaseScene {
  return {
    ...listedFields(listed),
    physics: scenePhysics(def, registry, engine),
    prefabs: prefabsUsedBy(def, library),
    bundle: { entries: bundle.entries.map((e) => e.id), bytes: bundle.bytes },
  };
}

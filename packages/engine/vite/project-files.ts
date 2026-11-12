import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, matchesGlob, relative, resolve, sep } from "node:path";

import * as Y from "yjs";

import { applyOpsToDoc } from "../collab/apply";
import type { AssetChange } from "../collab/asset-changed";
import {
  docLayout,
  docMeta,
  docPrefabs,
  docToScene,
  isPrefabDoc,
  sceneToDoc,
} from "../collab/convert";
import { randomKey } from "../collab/keys";
import { contentMap, layoutFromDoc, layoutPatch, layoutToDoc } from "../collab/layout";
import { sameValue } from "../collab/log";
import { migrateDocLayout, migrateLayout, projectDocWriter } from "../collab/migrate-layout";
import { docToPrefab, prefabPatch, prefabToDoc } from "../collab/prefab-doc";
import { applyRegistryBatch } from "../collab/project-apply";
import {
  appendHistory,
  PROJECT_LAYOUT_VERSION,
  projectAssetsMap,
  projectMetaMap,
  readEntry,
  readProject,
  seedProjectDoc,
  writeEntry,
} from "../collab/project-doc";
import { appendProjectLog } from "../collab/project-log";
import { COLLAB_LAYOUT_VERSION, type DocOrigin, type SceneOrigin } from "../collab/types";
import { createRegistry, withProject } from "../game/define";
import { ENGINE_COLLISION_GROUPS, type GameDefinition, type Registry } from "../game/types";
import {
  assetFileEntries,
  assetFileEntry,
  assetFileKind,
  idsAtPaths,
  mayBeAssetFile,
  orphanSidecarIssue,
  ownAssetId,
  projectPathMatcher,
  type AssetFile,
} from "../project/asset-files";
import { stableJson } from "../project/canonical";
import { docNameOf, parseDocName } from "../project/doc-names";
import { sha256 } from "../project/hash";
import { replacementHistory } from "../project/history";
import { inspectEntry } from "../project/inspect/entry";
import {
  createKindRegistry,
  formatAssetDoc,
  parseAssetDoc,
  type AssetKindDef,
  type BlobKindDef,
  type DocKindDef,
  type DocLayout,
  type InspectResult,
  type KindEnv,
  type KindRegistry,
} from "../project/kinds";
import { dataTableIssues } from "../project/kinds/data-table";
import { byCodeUnit, onePerProjectIssues } from "../project/kinds/define";
import { INPUT_MAP_KIND } from "../project/kinds/input-map";
import { kindInputMap } from "../project/kinds/input-script";
import { MATERIAL_KIND } from "../project/kinds/material";
import { prefabKind } from "../project/kinds/prefab";
import { sceneListIssues } from "../project/kinds/scene-list";
import type { BlobInspect, ProjectOp } from "../project/ops";
import { parseProjectFile, projectGlobs } from "../project/project-file";
import {
  formatSidecar,
  parseSidecar,
  SIDECAR_SUFFIX,
  sidecarPathOf,
  type AssetSidecar,
} from "../project/sidecar";
import {
  PROJECT_FILE,
  type AssetEntry,
  type AssetId,
  type AssetKey,
  type AssetPath,
  type CodeModuleInfo,
  type ProjectFile,
  type ProjectState,
  type Sha256,
} from "../project/types";
import { fileNameOf, folderPrefixOf, projectView, splitExtension } from "../project/view";
import { diffToOps } from "../scene/diff-to-ops";
import { makeIssue } from "../scene/issues";
import { parsePrefab, PREFABS_DIR, type ParsePrefabResult } from "../scene/prefab";
import {
  PREFAB_KIND,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "../scene/types";
import { defaultCacheDir, fileContentStore } from "./content-store";
import { resolveScenePath, sceneNameOf } from "./scene-paths";

/** The origin of every write the file adapter makes: seeding a doc and outside file changes. */
export const DISK_ORIGIN: SceneOrigin = { kind: "disk" };

/** What a file change did to a doc. */
export type DiskSync =
  | { kind: "unchanged" }
  | { kind: "applied"; ops: number }
  | { kind: "refused"; reason: string; issues?: SceneIssue[] };

/** A project on disk: its root, its project file, the registries its assets are judged by, and its dev cache. */
export type FileProject = {
  /** The directory holding `jams.project.json`; absolute. */
  dir: string;
  file: ProjectFile;
  registry: Registry;
  kinds: KindRegistry;
  /** Where doc states, trashed files and blobs are kept (`defaultCacheDir`). */
  cacheDir: string;
  /** The loaded game, whose registrations fill the project doc's code map; absent or null for none. */
  game?: GameDefinition | null;
};

/**
 * The project whose `jams.project.json` is in `dir`, judged by `game`'s
 * registries (the engine's alone without one). Throws when the file is
 * missing or doesn't parse. `cacheDir` defaults to `defaultCacheDir`.
 */
export async function readFileProject(
  dir: string,
  opts: { game?: GameDefinition | null; cacheDir?: string } = {},
): Promise<FileProject> {
  const root = resolve(dir);
  const parsed = parseProjectFile(await readFile(join(root, PROJECT_FILE), "utf8"));
  if (!parsed.ok)
    throw new Error(
      `${join(root, PROJECT_FILE)} doesn't parse: ${parsed.issues.map((i) => i.message).join("; ")}`,
    );
  const game = opts.game ?? null;
  return {
    dir: root,
    file: parsed.file,
    registry: createRegistry(game),
    kinds: createKindRegistry(game),
    cacheDir: opts.cacheDir ?? defaultCacheDir(parsed.file.id),
    game,
  };
}

export type ProjectProblem = { path: AssetPath; issues: SceneIssue[] };

export type ProjectScan = { state: ProjectState; problems: ProjectProblem[] };

export type { AssetChange };

/** What a settled file event did; a binary's new bytes also name the changed asset. */
export type ProjectSync = DiskSync | { kind: "applied"; ops: number; changed: AssetChange };

/** What a file event did: `pending` while an add or unlink waits for `settle` to pair it into a move. */
export type ProjectDiskSync = ProjectSync | { kind: "pending" };

/**
 * The origin a persisted doc state is loaded with: it isn't an edit, so
 * nothing that reacts to `disk` or user transactions should see it.
 */
export const PERSISTED_ORIGIN: unique symbol = Symbol("jams-engine:persisted");

const formatOfText = (text: string): number | undefined => {
  try {
    const v = (JSON.parse(text) as { v?: unknown } | null)?.v;
    return typeof v === "number" ? v : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Throws when a scene or prefab doc is at an older format than its file. A
 * doc only gets there by merging a client's copy of an older seed (a tab left
 * open across a reseed), so its text would mix both formats' values.
 */
function refuseDowngrade(path: AssetPath, doc: Y.Doc, diskText: string): void {
  const format = docMeta(doc)?.schemaVersion;
  const onDisk = formatOfText(diskText);
  if (format === undefined || onDisk === undefined || format >= onDisk) return;
  throw new Error(
    `${path}: the doc is at format v${format}, older than the file's v${onDisk}, so it isn't written; close the editor tabs on it and restart the dev server`,
  );
}

/** One raw add or unlink as `pairDiskEvents` sees it. */
export type DiskEvent = {
  type: "add" | "unlink";
  path: AssetPath;
  /** An unlink's registry key; an add's only when its sidecar names one. */
  key?: AssetKey;
  id?: AssetId;
  /** When the watcher reported it, ms. */
  at: number;
};

export type DiskChange =
  | { type: "unlink"; event: DiskEvent }
  | { type: "move"; from: DiskEvent; to: DiskEvent }
  | { type: "add"; event: DiskEvent };

/** How far apart an unlink and an add may be and still be one move, ms. */
export const MOVE_SETTLE_MS = 300;

/**
 * Pairs unlinks and adds into moves: an unlink and an add at most
 * `settleMs` apart that share a sidecar key, or else an id, are one move.
 * Each event pairs at most once, the earliest candidate first. Returns the
 * changes in the order to apply them: unlinks first (they free paths), then
 * moves, then adds, each in event order.
 */
export function pairDiskEvents(events: readonly DiskEvent[], settleMs: number): DiskChange[] {
  const unlinks = events.filter((e) => e.type === "unlink");
  const adds = events.filter((e) => e.type === "add");
  const partner = new Map<DiskEvent, DiskEvent>();
  const taken = new Set<DiskEvent>();
  for (const field of ["key", "id"] as const)
    for (const unlink of unlinks) {
      const value = unlink[field];
      if (partner.has(unlink) || value === undefined) continue;
      const add = adds.find(
        (a) => !taken.has(a) && a[field] === value && Math.abs(a.at - unlink.at) <= settleMs,
      );
      if (!add) continue;
      partner.set(unlink, add);
      taken.add(add);
    }
  return [
    ...unlinks
      .filter((u) => !partner.has(u))
      .map((event): DiskChange => ({ type: "unlink", event })),
    ...unlinks
      .filter((u) => partner.has(u))
      .map((from): DiskChange => ({ type: "move", from, to: partner.get(from)! })),
    ...adds.filter((a) => !taken.has(a)).map((event): DiskChange => ({ type: "add", event })),
  ];
}

export type ProjectFileAdapterOptions = {
  /** The move pairing window; default `MOVE_SETTLE_MS`. */
  settleMs?: number;
  now?: () => number;
};

export type ProjectFileAdapter = {
  /**
   * Reads every asset and sidecar under the project's globs into a
   * ProjectState; keys are ids unless a sidecar names one. A binary's bytes
   * are hashed, copied into the content store and inspected; its file wins
   * over what its sidecar says of them.
   */
  scan(): Promise<ProjectScan>;
  /** Fills an empty project doc from the files, or reconciles the persisted state with them. Returns the scan's problems. */
  loadProject(doc: Y.Doc): Promise<ProjectProblem[]>;
  /**
   * Fills an empty asset or scene doc from its file (or the trash cache), or
   * loads its persisted state and applies the file's difference as one
   * `disk` transaction (a layout-1 scene state is migrated first). A
   * created asset whose file isn't written yet stays for its creator to
   * fill: a declarative kind gets `meta` only, a scene or prefab nothing.
   * Throws when the file doesn't parse, or the doc isn't a doc asset of
   * this project.
   */
  loadDoc(name: string, doc: Y.Doc): Promise<void>;
  /**
   * Writes the registry's creates, moves, trashes, restores and binary
   * replacements (bytes from the content store), and the sidecars they need:
   * every binary has one; true when it wrote.
   */
  storeProject(doc: Y.Doc): Promise<boolean>;
  /**
   * A `path-taken` issue for the first live entry `storeProject` would skip:
   * one created or moved to a path that something on disk other than its
   * own file already holds, ignoring case (a file the scan doesn't list, a
   * folder, a file where a folder goes, a folder spelled in another case).
   * Null when every write lands. Writes nothing.
   */
  blockedWrite(doc: Y.Doc): Promise<SceneIssue | null>;
  /**
   * Writes the doc's canonical text when it changed, and a new file's
   * sidecar when it carries something; true when it wrote. A new file waits,
   * its content kept in the doc, while something on disk holds its path.
   */
  storeDoc(name: string, doc: Y.Doc): Promise<boolean>;
  /**
   * A file event under the project. An edit is one `disk` layoutPatch now; a
   * binary's new bytes are one `disk` replaceContent with re-inspected meta,
   * whose result names the change. An add or unlink is `pending` until
   * `settle`. The adapter's own writes are `unchanged`.
   */
  syncPath(
    path: AssetPath,
    docs: (name: string) => Y.Doc | undefined,
    project: Y.Doc,
  ): Promise<ProjectDiskSync>;
  /** Applies the pending adds and unlinks: paired into moves, else registry adds and trashes, each with the `disk` origin. */
  settle(docs: (name: string) => Y.Doc | undefined, project: Y.Doc): Promise<ProjectSync[]>;
  /**
   * Writes a doc's state to `<cacheDir>/docs/<prefix>/<project>.<key>.bin`
   * (the doc name with its `:` as a folder, which every file system
   * accepts). Stores call it; the host calls it again on unload.
   */
  persist(name: string, doc: Y.Doc): Promise<void>;
  /** Drops an unloaded doc; its persisted state and files stay. */
  forget(name: string): void;
  /** Whether a project-relative path under the asset globs may be an asset (`mayBeAssetFile`), or is a sidecar there. */
  watches(path: AssetPath): boolean;
  /** The doc name an entry's content lives under. */
  docNameOf(entry: Pick<AssetEntry, "key" | "kind">): string;
  /** A doc asset's content as plain JSON, as its kind parses it; undefined before it is seeded. Throws for a doc that isn't this project's. */
  valueOf(name: string, doc: Y.Doc): unknown;
  /**
   * Points every live binary whose hash the content store doesn't hold back
   * at bytes it does (the file's, else the newest held in its history),
   * with re-inspected meta and a project log entry, in one transaction
   * with `origin`. Returns what it repaired.
   */
  repairBlobs(doc: Y.Doc, origin: DocOrigin): Promise<BlobRepair[]>;
};

/** A binary entry `repairBlobs` pointed back at bytes the store holds. */
export type BlobRepair = { key: AssetKey; id: AssetId; from: Sha256; to: Sha256 };

type BlobContent = { sha256: Sha256; bytes: number };

/** What the adapter last read from or wrote to an asset's file: a doc kind's text, or a binary's hash. */
type OnDisk = {
  path: AssetPath;
  text: string | null;
  blob: BlobContent | null;
  sidecar: string | null;
};

type FileRead = {
  path: AssetPath;
  /** Null for a binary. */
  text: string | null;
  /** A binary's bytes, already in the content store; null when they couldn't be taken. */
  blob: (BlobContent & { data: Uint8Array }) | null;
  json: unknown;
  def: AssetKindDef | null;
  sidecarText: string | null;
  sidecar: AssetSidecar | null;
  id: AssetId | null;
  problems: ProjectProblem[];
};

const SKIPPED_DIRS: readonly string[] = ["node_modules", "dist", "__tests__"];
const SEEDED = { at: 0, by: "disk" } as const;
const TRASH_INDEX = "trash.json";

const isMissing = (error: unknown) =>
  error instanceof Error && (error as { code?: unknown }).code === "ENOENT";

/** Whether `file` is a file; a folder of the same name isn't. */
async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** A path that isn't a file to read: gone, a folder, or under a file. */
const notAFile = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return isMissing(error) || code === "EISDIR" || code === "ENOTDIR";
};

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (notAFile(error)) return null;
    throw error;
  }
}

async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if (notAFile(error)) return null;
    throw error;
  }
}

async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomKey()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isDocKind = (def: AssetKindDef | undefined | null): def is DocKindDef =>
  def?.storage === "doc";

/** How the adapter reads, seeds and patches one doc kind's docs: by layout, or by the scene and prefab codecs. */
type DocCodec = {
  /** Whether the doc holds content (a created declarative doc may hold `meta` alone). */
  seeded(doc: Y.Doc): boolean;
  value(doc: Y.Doc): unknown;
  /** Seeds an empty doc with `value` as one `disk` transaction; with no value, leaves it for its creator. */
  seed(doc: Y.Doc, key: AssetKey, value: unknown): void;
  /** Brings a seeded doc to `value` as one `disk` transaction, writing only what changed. */
  patch(doc: Y.Doc, value: unknown): Promise<DiskSync>;
};
const isBlobKind = (def: AssetKindDef | undefined | null): def is BlobKindDef =>
  def?.storage === "blob";

/** The kinds whose assets are files the adapter writes: docs and binaries, not code. */
const hasFile = (def: AssetKindDef | undefined | null): boolean =>
  def?.storage === "doc" || def?.storage === "blob";

const isEmpty = (record: Record<string, unknown> | undefined) =>
  record === undefined || Object.keys(record).length === 0;

/**
 * A project's files as registry entries and asset docs, and back. Keeps
 * what it last read from or wrote to each file, so a store writes only
 * when the canonical text changed and the watcher events its own writes
 * cause are no-ops. Calls for one doc must not overlap; the host queues them.
 */
export function createProjectFileAdapter(
  project: FileProject,
  options: ProjectFileAdapterOptions = {},
): ProjectFileAdapter {
  const { dir, kinds } = project;
  const projectId = project.file.id;
  const settleMs = options.settleMs ?? MOVE_SETTLE_MS;
  const now = options.now ?? Date.now;
  const { isAsset: isCandidate } = projectPathMatcher(project.file, matchesGlob);
  const blobs = fileContentStore(project.cacheDir);

  const files = new Map<AssetKey, OnDisk>();
  const loaded = new Map<AssetKey, Y.Doc>();
  const pending = new Map<AssetPath, number>();
  let scanned = new Map<AssetKey, AssetEntry>();
  let projectDoc: Y.Doc | null = null;
  let trash: Map<AssetKey, string> | null = null;
  let overlay: { key: string; registry: Registry } | null = null;
  /** What the last scan parsed each JSON file as. */
  let scannedJson = new Map<AssetKey, unknown>();

  /** A doc asset's value: its open doc's, else the text last read from its file, else the last scan's. */
  const docValue = (entry: AssetEntry): unknown => {
    const def = kinds.get(entry.kind);
    const doc = loaded.get(entry.key);
    if (doc && isDocKind(def) && def.layout !== "custom" && contentMap(doc).size > 0)
      return layoutFromDoc(doc, def.layout as DocLayout);
    const text = files.get(entry.key)?.text;
    return text == null ? (scannedJson.get(entry.key) ?? null) : (tryJson(text) ?? null);
  };

  /** The registry docs are judged by: the project's, with the live material assets among `entries` overlaid by id. */
  function registryOf(entries: Iterable<AssetEntry>, valueOf = docValue): Registry {
    const live = [...entries].filter((e) => e.kind === MATERIAL_KIND && !e.deleted);
    if (live.length === 0) return project.registry;
    const values = new Map<AssetId, unknown>(live.map((e) => [e.id, valueOf(e) ?? null]));
    const key = stableJson([...values].sort(([a], [b]) => byCodeUnit(a, b)));
    if (overlay?.key !== key) {
      const state = stateOf(live);
      overlay = { key, registry: withProject(project.registry, projectView(state, kinds), values) };
    }
    return overlay.registry;
  }
  const registryNow = () =>
    registryOf(projectDoc ? Object.values(readProject(projectDoc).assets) : scanned.values());
  const liveEntries = () =>
    projectDoc ? Object.values(readProject(projectDoc).assets) : [...scanned.values()];
  /** A loaded, seeded prefab doc's value by id. */
  const loadedPrefab = (byId: ReadonlyMap<string, AssetEntry>) => (id: string) => {
    const entry = byId.get(id);
    const doc = entry && loaded.get(entry.key);
    return doc && prefabCodec.seeded(doc) ? { ...docToPrefab(doc), id } : undefined;
  };
  const livePrefabEntries = () =>
    new Map(
      liveEntries()
        .filter((e) => e.kind === PREFAB_KIND && !e.deleted)
        .map((e) => [e.id, e]),
    );
  /** The project's prefabs by id, from their loaded docs, else their last-read files. */
  function prefabNow(registry: Registry): (id: string) => Prefab | undefined {
    const byId = livePrefabEntries();
    const texts = new Map<string, string>();
    for (const [id, entry] of byId) {
      const text = files.get(entry.key)?.text;
      if (text != null) texts.set(id, text);
    }
    const known = loadedPrefab(byId);
    const parsed = prefabResolver(texts, registry, known);
    return (id) => {
      const hit = known(id);
      if (hit) return hit;
      const r = parsed(id);
      return r?.ok ? { ...r.prefab, id } : undefined;
    };
  }
  /** The input map in effect among `entries`, as `KindEnv.inputMap` gives it to input scripts. */
  function inputMapOf(
    entries: readonly AssetEntry[],
    valueOf: (entry: AssetEntry) => unknown,
    registry: Registry,
  ) {
    const maps = entries.filter((e) => e.kind === INPUT_MAP_KIND);
    if (maps.length === 0) return null;
    const view = projectView(stateOf(maps), kinds);
    return kindInputMap(
      view,
      (id) => {
        const entry = view.byId.get(id);
        return entry ? valueOf(entry) : undefined;
      },
      registry,
    );
  }
  const envNow = (): KindEnv => {
    const registry = registryNow();
    return {
      registry,
      project: null,
      prefab: prefabNow(registry),
      inputMap: inputMapOf(liveEntries(), docValue, registry),
    };
  };

  const abs = (path: AssetPath) => join(dir, ...path.split("/"));
  const nameOf = (entry: Pick<AssetEntry, "key" | "kind">) => {
    const def = kinds.get(entry.kind);
    const prefix = def?.storage === "doc" && def.prefix === "scene" ? "scene" : "asset";
    return docNameOf({ kind: prefix, project: projectId, key: entry.key });
  };
  const keyAt = (path: AssetPath): AssetKey | undefined => {
    for (const [key, disk] of files) if (disk.path === path) return key;
    return undefined;
  };
  const entryOf = (key: AssetKey, doc: Y.Doc | null = projectDoc): AssetEntry | undefined => {
    if (!doc) return scanned.get(key);
    const map = projectAssetsMap(doc).get(key);
    return map instanceof Y.Map ? (readEntry(key, map) ?? undefined) : undefined;
  };
  const sceneCodec: DocCodec = {
    seeded: (doc) => docMeta(doc) !== null,
    value: (doc) => docToScene(doc),
    seed(doc, key, value) {
      if (value)
        sceneToDoc(value as SceneDefinition, {
          doc,
          origin: DISK_ORIGIN,
          project: projectId,
          assetKey: key,
        });
    },
    async patch(doc, value) {
      let batch;
      try {
        batch = diffToOps(docToScene(doc), value as SceneDefinition, registryNow());
      } catch (e) {
        return { kind: "refused", reason: (e as Error).message };
      }
      if (batch.ops.length === 0) return { kind: "unchanged" };
      const result = applyOpsToDoc(doc, batch, DISK_ORIGIN, registryNow(), {
        label: "Changed on disk",
        validate: "none",
        prefabs: await prefabLibrary(),
      });
      if (!result.ok)
        return { kind: "refused", reason: result.issue.message, issues: [result.issue] };
      return { kind: "applied", ops: batch.ops.length };
    },
  };
  const prefabCodec: DocCodec = {
    seeded: (doc) => docMeta(doc) !== null && isPrefabDoc(doc),
    value: (doc) => docToPrefab(doc),
    seed(doc, key, value) {
      if (value)
        prefabToDoc(value as Prefab, {
          doc,
          origin: DISK_ORIGIN,
          project: projectId,
          assetKey: key,
        });
    },
    async patch(doc, value) {
      const entry = prefabPatch(doc, value as Prefab, DISK_ORIGIN, { label: "Changed on disk" });
      return entry ? { kind: "applied", ops: 1 } : { kind: "unchanged" };
    },
  };
  const layoutCodec = (def: DocKindDef): DocCodec => {
    const layout = def.layout as DocLayout;
    return {
      seeded: (doc) => contentMap(doc).size > 0,
      value: (doc) => layoutFromDoc(doc, layout),
      seed(doc, key, value) {
        doc.transact(() => {
          seedMeta(doc, def, key, (value ?? undefined) as Record<string, unknown> | undefined);
          if (value) layoutToDoc(doc, layout, value, DISK_ORIGIN);
        }, DISK_ORIGIN);
      },
      async patch(doc, value) {
        return layoutPatch(doc, layout, value, DISK_ORIGIN)
          ? { kind: "applied", ops: 1 }
          : { kind: "unchanged" };
      },
    };
  };
  const codecOf = (def: DocKindDef): DocCodec =>
    def.layout !== "custom"
      ? layoutCodec(def)
      : def.kind === PREFAB_KIND
        ? prefabCodec
        : sceneCodec;
  const canonical = (def: DocKindDef, doc: Y.Doc) => formatAssetDoc(def, codecOf(def).value(doc));

  /** Every live prefab by id: from its loaded doc, else its file; a file that doesn't parse is left out. */
  async function prefabLibrary(): Promise<PrefabLibrary> {
    const out = new Map<string, Prefab>();
    const byId = livePrefabEntries();
    const known = loadedPrefab(byId);
    const texts = new Map<string, string>();
    for (const [id, entry] of byId) {
      if (known(id)) continue;
      const text = await readText(abs(files.get(entry.key)?.path ?? entry.path));
      if (text !== null) texts.set(id, text);
    }
    const parsed = prefabResolver(texts, registryNow(), known);
    for (const id of [...byId.keys()].sort(byCodeUnit)) {
      const hit = known(id);
      if (hit) {
        out.set(id, hit);
        continue;
      }
      const r = parsed(id);
      if (r?.ok) out.set(id, { ...r.prefab, id });
    }
    return out;
  }
  const persistedPath = (name: string) =>
    join(project.cacheDir, "docs", `${name.replace(":", "/")}.bin`);

  const idsIn = (doc: Y.Doc) => idsAtPaths(Object.values(readProject(doc).assets));

  /** `entry` with the content, meta and settings an inspection of `blob` gives; meta dropped when it fails. */
  function withBlob(
    entry: AssetEntry,
    blob: BlobContent,
    result: InspectResult<unknown>,
  ): AssetEntry {
    const { meta: _meta, ...rest } = entry;
    const next: AssetEntry = { ...rest, sha256: blob.sha256, bytes: blob.bytes };
    if (!result.ok) return next;
    next.meta = result.meta as Record<string, unknown>;
    if (result.import) next.import = result.import;
    return next;
  }

  // ─── Reading files ─────────────────────────────────────

  async function walk(rel: string, out: AssetPath[]): Promise<void> {
    const entries = await readdir(rel === "" ? dir : abs(rel), { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissing(error)) return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.includes(entry.name)) await walk(path, out);
      } else if (entry.isFile()) out.push(path);
    }
  }

  /** The asset at `path` as its file and sidecar say; null when the file is gone. */
  async function readAsset(path: AssetPath): Promise<FileRead | null> {
    const raw = await readBytes(abs(path));
    if (raw === null) return null;
    const problems: ProjectProblem[] = [];
    const sidecarPath = sidecarPathOf(path);
    const sidecarText = await readText(abs(sidecarPath));
    let sidecar: AssetSidecar | null = null;
    if (sidecarText !== null) {
      const parsed = parseSidecar(sidecarText);
      if (parsed.ok) sidecar = parsed.sidecar;
      else problems.push({ path: sidecarPath, issues: parsed.issues });
    }
    const isJson = path.toLowerCase().endsWith(".json");
    let text: string | null = null;
    let json: unknown;
    const decode = () => {
      text = raw.toString("utf8");
      json = isJson ? tryJson(text) : undefined;
      return json;
    };
    const def = assetFileKind(kinds, path, decode, sidecar?.assetKind);
    if (!isBlobKind(def) && text === null) decode();
    let blob: FileRead["blob"] = null;
    if (isBlobKind(def)) {
      text = null;
      if (raw.byteLength > def.maxBytes)
        problems.push({
          path,
          issues: [
            makeIssue("asset-too-large", {
              message: `${path} is ${raw.byteLength} bytes, more than a ${def.kind} may hold (${def.maxBytes})`,
              path: "",
              got: String(raw.byteLength),
              expected: String(def.maxBytes),
            }),
          ],
        });
      else {
        const data = new Uint8Array(raw);
        blob = { sha256: await blobs.put(data), bytes: data.byteLength, data };
      }
    }
    if (def === null && json === undefined && isJson)
      problems.push({
        path,
        issues: [
          makeIssue("schema", {
            message: `${path} isn't valid JSON, so its asset kind can't be told`,
            path: "",
          }),
        ],
      });
    const id = def ? (sidecar?.id ?? ownAssetId(def, path, json)) : null;
    if (def && id === null)
      problems.push({
        path,
        issues: [
          makeIssue("bad-id", {
            message: `${path} gives no asset id; give it a sidecar with one`,
            path: "",
          }),
        ],
      });
    return { path, text, blob, json, def, sidecarText, sidecar, id, problems };
  }

  /** Whether a read is an asset the registry lists: a doc kind's file, or a binary whose bytes were taken. */
  const listable = (read: FileRead): read is FileRead & AssetFile =>
    read.id !== null &&
    (read.def?.storage === "doc" || (read.def?.storage === "blob" && read.blob !== null));

  const onDiskOf = (read: FileRead): OnDisk => ({
    path: read.path,
    text: read.text,
    blob: read.blob && { sha256: read.blob.sha256, bytes: read.blob.bytes },
    sidecar: read.sidecarText,
  });

  async function scanFiles(): Promise<{
    entries: AssetEntry[];
    disk: Map<AssetKey, OnDisk>;
    problems: ProjectProblem[];
  }> {
    const paths: AssetPath[] = [];
    await walk("", paths);
    paths.sort();
    const present = new Set(paths);
    const problems: ProjectProblem[] = [];
    const reads: (FileRead & AssetFile)[] = [];
    // Docs parse once every material is read, each one's problems kept at its place in path order.
    const docs: { at: number; read: FileRead }[] = [];
    for (const path of paths) {
      if (path.endsWith(SIDECAR_SUFFIX)) {
        const base = path.slice(0, -SIDECAR_SUFFIX.length);
        if (!present.has(base) || !isCandidate(base))
          problems.push({ path, issues: [orphanSidecarIssue(path, base)] });
        continue;
      }
      if (
        !isCandidate(path) ||
        !mayBeAssetFile(kinds, path, () => present.has(sidecarPathOf(path)))
      )
        continue;
      const read = await readAsset(path);
      if (!read) continue;
      problems.push(...read.problems);
      if (!listable(read)) continue;
      if (read.def.storage === "doc") docs.push({ at: problems.length, read });
      reads.push(read);
    }
    const keyed = assetFileEntries(reads, SEEDED);
    const disk = new Map<AssetKey, OnDisk>();
    const json = new Map<AssetKey, unknown>();
    for (const { file, key } of keyed) {
      disk.set(key, onDiskOf(file));
      json.set(key, file.json ?? null);
    }
    const listed = keyed.map(
      ({ key, file }): AssetEntry => ({
        key,
        id: file.id,
        kind: file.def.kind,
        path: file.path,
        created: SEEDED,
      }),
    );
    const registry = registryOf(listed, (e) => json.get(e.key));
    const prefabTexts = new Map<string, string>();
    for (const { file } of keyed)
      if (file.def.kind === PREFAB_KIND && file.text !== null) prefabTexts.set(file.id, file.text);
    const prefabs = prefabResolver(prefabTexts, registry);
    const env: KindEnv = {
      registry,
      project: null,
      prefab: (id) => {
        const r = prefabs(id);
        return r?.ok ? { ...r.prefab, id } : undefined;
      },
      inputMap: inputMapOf(listed, (e) => json.get(e.key), registry),
    };
    for (const { at, read } of docs.reverse()) {
      const parsed = parseAssetDoc(read.def as DocKindDef, read.text!, env);
      if (!parsed.ok) problems.splice(at, 0, { path: read.path, issues: parsed.issues });
    }
    for (const { file, issue } of keyed)
      if (issue) problems.push({ path: file.path, issues: [issue] });
    scannedJson = json;
    return { entries: keyed.map((k) => k.entry), disk, problems };
  }

  function stateOf(entries: readonly AssetEntry[]): ProjectState {
    const assets: Record<AssetKey, AssetEntry> = {};
    for (const entry of [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
      assets[entry.key] = entry;
    return {
      meta: { projectId, layout: PROJECT_LAYOUT_VERSION, name: project.file.name },
      assets,
      history: {},
      code: {},
      build: {},
    };
  }

  async function scan(): Promise<ProjectScan> {
    const { entries, problems } = await scanFiles();
    scanned = new Map(entries.map((e) => [e.key, e]));
    return { state: stateOf(entries), problems };
  }

  // ─── The trash cache ───────────────────────────────────

  async function trashIndex(): Promise<Map<AssetKey, string>> {
    if (trash) return trash;
    const text = await readText(join(project.cacheDir, TRASH_INDEX));
    const json = text === null ? {} : tryJson(text);
    trash = new Map(
      json && typeof json === "object"
        ? Object.entries(json as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          )
        : [],
    );
    return trash;
  }

  async function saveTrash(): Promise<void> {
    const index = await trashIndex();
    const json = Object.fromEntries([...index].sort(([a], [b]) => (a < b ? -1 : 1)));
    await writeAtomic(join(project.cacheDir, TRASH_INDEX), `${JSON.stringify(json, null, 2)}\n`);
  }

  async function trashedText(key: AssetKey): Promise<string | null> {
    const hash = (await trashIndex()).get(key);
    const bytes = hash === undefined ? null : await blobs.get(hash);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  }

  /** A binary entry's current bytes from the content store; null when the store doesn't hold them. */
  async function blobOf(entry: AssetEntry): Promise<Uint8Array | null> {
    const hash = entry.sha256 ?? (await trashIndex()).get(entry.key);
    return hash === undefined ? null : blobs.get(hash);
  }

  async function persistedState(name: string): Promise<Uint8Array | null> {
    const bytes = await readBytes(persistedPath(name));
    return bytes === null ? null : new Uint8Array(bytes);
  }

  async function persistedDoc(name: string): Promise<Y.Doc | null> {
    const state = await persistedState(name);
    if (state === null) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state, PERSISTED_ORIGIN);
    return doc;
  }

  /** The text a restored or created entry's file gets: its loaded doc's, the trash cache's, or its persisted doc's; null when it has none yet. */
  async function contentFor(entry: AssetEntry): Promise<string | null> {
    const def = kinds.get(entry.kind);
    const doc = loaded.get(entry.key);
    if (isDocKind(def) && doc && codecOf(def).seeded(doc)) return canonical(def, doc);
    const cached = await trashedText(entry.key);
    if (cached !== null) return cached;
    if (!isDocKind(def)) return null;
    const persisted = await persistedDoc(nameOf(entry));
    if (persisted) liftLayout(def, persisted);
    return persisted && codecOf(def).seeded(persisted) ? canonical(def, persisted) : null;
  }

  // ─── Writing files ─────────────────────────────────────

  /**
   * The sidecar `entry` needs beside its file: a binary's always (its hash,
   * size, settings and meta); a doc kind's only when it carries something.
   */
  function sidecarFor(entry: AssetEntry, disk: OnDisk): string | null {
    const def = kinds.get(entry.kind);
    if (!def) return null;
    if (isBlobKind(def)) return blobSidecar(entry);
    if (disk.text === null) return null;
    const json = tryJson(disk.text);
    const detected = kinds.detect(entry.path, json)?.kind ?? null;
    const stem = splitExtension(fileNameOf(entry.path))[0];
    const name = entry.name !== undefined && entry.name !== stem ? entry.name : undefined;
    const carries =
      entry.key !== entry.id ||
      entry.id !== ownAssetId(def, entry.path, json) ||
      detected !== entry.kind ||
      entry.licence !== undefined ||
      name !== undefined;
    if (!carries) return null;
    const sidecar: Omit<AssetSidecar, "key"> & { key?: AssetKey } = {
      kind: "asset-sidecar",
      v: 1,
      key: entry.key,
      id: entry.id,
      assetKind: entry.kind,
    };
    if (name !== undefined) sidecar.name = name;
    if (entry.licence !== undefined) sidecar.licence = entry.licence;
    return formatSidecar(sidecar, { detectedKind: detected });
  }

  function blobSidecar(entry: AssetEntry): string {
    const stem = splitExtension(fileNameOf(entry.path))[0];
    const sidecar: Omit<AssetSidecar, "key"> & { key?: AssetKey } = {
      kind: "asset-sidecar",
      v: 1,
      key: entry.key,
      id: entry.id,
      assetKind: entry.kind,
    };
    if (entry.name !== undefined && entry.name !== stem) sidecar.name = entry.name;
    if (entry.sha256 !== undefined) {
      sidecar.sha256 = entry.sha256;
      sidecar.bytes = entry.bytes ?? 0;
    }
    if (!isEmpty(entry.import)) sidecar.import = entry.import;
    if (entry.meta !== undefined) sidecar.meta = entry.meta;
    if (entry.licence !== undefined) sidecar.licence = entry.licence;
    return formatSidecar(sidecar, { detectedKind: kinds.detect(entry.path)?.kind ?? null });
  }

  async function writeSidecar(
    path: AssetPath,
    disk: OnDisk,
    want: string | null,
  ): Promise<boolean> {
    if (want === disk.sidecar) return false;
    const file = abs(sidecarPathOf(path));
    if (want === null) await rm(file, { force: true });
    else await writeAtomic(file, want);
    disk.sidecar = want;
    return true;
  }

  /** Removes the folders a file left empty, up to the project root: an empty folder doesn't exist. */
  async function pruneFolders(path: AssetPath): Promise<void> {
    let folder = folderPrefixOf(path);
    while (folder !== "") {
      try {
        await rmdir(abs(folder.slice(0, -1)));
      } catch {
        return;
      }
      folder = folderPrefixOf(folder.slice(0, -1));
    }
  }

  async function moveToTrash(key: AssetKey, disk: OnDisk): Promise<void> {
    // Read again before changing it: another writer (the CLI on files) may have changed it meanwhile.
    trash = null;
    const index = await trashIndex();
    const hash =
      disk.blob?.sha256 ??
      entryOf(key)?.sha256 ??
      (disk.text === null ? null : await blobs.put(new TextEncoder().encode(disk.text)));
    if (hash !== null) index.set(key, hash);
    await saveTrash();
    const doc = loaded.get(key);
    const entry = entryOf(key);
    if (doc && entry) await persist(nameOf(entry), doc);
    await rm(abs(disk.path), { force: true });
    if (disk.sidecar !== null) await rm(abs(sidecarPathOf(disk.path)), { force: true });
    files.delete(key);
    await pruneFolders(disk.path);
  }

  async function forgetTrashed(key: AssetKey): Promise<void> {
    trash = null;
    const index = await trashIndex();
    if (index.delete(key)) await saveTrash();
  }

  // ─── Docs ──────────────────────────────────────────────

  function docRef(name: string): { key: AssetKey; entry: AssetEntry; def: DocKindDef } {
    const ref = parseDocName(name);
    if (!ref || ref.kind === "project" || ref.project !== projectId)
      throw new Error(`${name} isn't an asset doc of project "${projectId}"`);
    const entry = entryOf(ref.key);
    if (!entry) throw new Error(`project "${projectId}" has no asset with the key "${ref.key}"`);
    const def = kinds.get(entry.kind);
    if (!isDocKind(def)) throw new Error(`${name} is a ${entry.kind}, which isn't a doc kind`);
    return { key: ref.key, entry, def };
  }

  function parseOrThrow(def: DocKindDef, text: string, path: AssetPath): Record<string, unknown> {
    const parsed = parseAssetDoc(def, text, envNow());
    if (!parsed.ok) {
      const first = parsed.issues.find((i) => i.severity === "error") ?? parsed.issues[0];
      throw new Error(`${path} doesn't parse${first ? `: ${first.message}` : "."}`);
    }
    return parsed.value as Record<string, unknown>;
  }

  function seedMeta(doc: Y.Doc, def: DocKindDef, key: AssetKey, value?: Record<string, unknown>) {
    const meta = doc.getMap<unknown>("meta");
    if (meta.size > 0) return;
    meta.set("kind", def.kind);
    meta.set("schemaVersion", typeof value?.v === "number" ? value.v : def.version);
    meta.set("layout", COLLAB_LAYOUT_VERSION);
    meta.set("project", projectId);
    meta.set("key", key);
  }

  /** Whether a persisted state can take the file's difference; a state that can't is dropped for the file. */
  async function takesFile(
    codec: DocCodec,
    state: Uint8Array,
    fromFile: unknown,
    text: string,
    def: DocKindDef,
  ): Promise<boolean> {
    const trial = new Y.Doc();
    Y.applyUpdate(trial, state, PERSISTED_ORIGIN);
    liftLayout(def, trial);
    if (!codec.seeded(trial) || canonical(def, trial) === text) return true;
    return (await codec.patch(trial, fromFile)).kind !== "refused";
  }

  /**
   * Lifts a persisted doc to this engine's layout where that needs no
   * project: every doc but a layout-1 scene that still holds prefabs.
   */
  function liftLayout(def: DocKindDef, doc: Y.Doc): void {
    if (!docMeta(doc) || docLayout(doc) >= COLLAB_LAYOUT_VERSION) return;
    if (def.layout !== "custom") migrateDocLayout(doc, def.layout as DocLayout);
    else if (def.kind === PREFAB_KIND || docPrefabs(doc).size === 0) migrateDocLayout(doc);
  }

  /** Lifts a persisted layout-1 scene: its prefabs become prefab assets of their own. */
  async function migrateScene(key: AssetKey, doc: Y.Doc): Promise<void> {
    if (!projectDoc || !docMeta(doc) || docLayout(doc) >= COLLAB_LAYOUT_VERSION) return;
    const seeded: { key: AssetKey; doc: Y.Doc }[] = [];
    migrateLayout(
      doc,
      projectDocWriter(projectDoc, {
        scene: key,
        now,
        prefabDoc(prefab) {
          const open = loaded.get(prefab);
          if (open) return open;
          const fresh = new Y.Doc();
          seeded.push({ key: prefab, doc: fresh });
          return fresh;
        },
      }),
    );
    for (const s of seeded) await persist(nameOf({ key: s.key, kind: PREFAB_KIND }), s.doc);
  }

  async function loadDoc(name: string, doc: Y.Doc): Promise<void> {
    if (!projectDoc && scanned.size === 0) await scan();
    const { key, entry, def } = docRef(name);
    const codec = codecOf(def);
    const disk = files.get(key);
    const path = disk?.path ?? entry.path;
    // Only a tracked file is the entry's own. Before the registry loads, every entry is one the
    // scan listed at its path. A file holding a new entry's path is a blocker, so that doc loads
    // from its persisted state or its seed.
    const own = disk !== undefined || (!projectDoc && scanned.has(key));
    const text = entry.deleted || !own ? null : await readText(abs(path));
    const fromFile = text === null ? null : parseOrThrow(def, text, path);
    const persisted = await persistedState(name);
    if (persisted && (text === null || (await takesFile(codec, persisted, fromFile, text, def))))
      Y.applyUpdate(doc, persisted, PERSISTED_ORIGIN);
    liftLayout(def, doc);
    if (codec.seeded(doc)) {
      if (def.kind !== PREFAB_KIND && def.layout === "custom") await migrateScene(key, doc);
      if (fromFile && text !== canonical(def, doc)) await codec.patch(doc, fromFile);
    } else {
      const cached = fromFile ? null : await trashedText(key);
      const value = fromFile ?? (cached === null ? null : parseOrThrow(def, cached, path));
      codec.seed(doc, key, value);
    }
    if (text !== null) {
      const sidecar = disk ? disk.sidecar : await readText(abs(sidecarPathOf(path)));
      files.set(key, { path, text, blob: null, sidecar });
    }
    loaded.set(key, doc);
  }

  async function storeDoc(name: string, doc: Y.Doc): Promise<boolean> {
    const { key, entry, def } = docRef(name);
    loaded.set(key, doc);
    await persist(name, doc);
    if (entry.deleted || !codecOf(def).seeded(doc)) return false;
    const disk = files.get(key);
    if (disk?.text && def.layout === "custom") refuseDowngrade(entry.path, doc, disk.text);
    const text = canonical(def, doc);
    if (disk) {
      if (disk.text === text) return false;
      await writeAtomic(abs(disk.path), text);
      disk.text = text;
      return true;
    }
    if ((await diskHolder(entry.path)) !== null) return false;
    await writeAtomic(abs(entry.path), text);
    const created: OnDisk = { path: entry.path, text, blob: null, sidecar: null };
    files.set(key, created);
    await writeSidecar(entry.path, created, sidecarFor(entry, created));
    await forgetTrashed(key);
    return true;
  }

  async function persist(name: string, doc: Y.Doc): Promise<void> {
    await writeAtomic(persistedPath(name), Y.encodeStateAsUpdate(doc));
  }

  // ─── The registry ──────────────────────────────────────

  /**
   * One `disk` transaction bringing the doc's registry in line with a scan,
   * writing only what differs: files win; a binary whose bytes changed
   * meanwhile adds both hashes to its history; doc and binary kinds without
   * a file go to the trash.
   */
  function reconcile(doc: Y.Doc, entries: readonly AssetEntry[]): void {
    const state = readProject(doc);
    const seen = new Set<AssetKey>();
    const at = now();
    doc.transact(() => {
      for (const scannedEntry of entries) {
        seen.add(scannedEntry.key);
        const current = state.assets[scannedEntry.key];
        const blob = isBlobKind(kinds.get(scannedEntry.kind));
        if (!current) {
          writeEntry(doc, scannedEntry);
          if (blob) appendHistory(doc, scannedEntry.key, []);
          continue;
        }
        const {
          deleted: _deleted,
          name: _name,
          licence: _licence,
          sha256: _sha256,
          bytes: _bytes,
          meta: _meta,
          import: _import,
          ...kept
        } = current;
        const next: AssetEntry = {
          ...kept,
          id: scannedEntry.id,
          kind: scannedEntry.kind,
          path: scannedEntry.path,
        };
        if (scannedEntry.name !== undefined) next.name = scannedEntry.name;
        for (const field of ["sha256", "bytes", "meta", "import"] as const)
          if (scannedEntry[field] !== undefined)
            Object.assign(next, { [field]: scannedEntry[field] });
        if (scannedEntry.licence !== undefined) next.licence = scannedEntry.licence;
        if (sameValue(current, next)) continue;
        writeEntry(doc, next);
        if (blob && next.sha256 !== undefined && current.sha256 !== next.sha256) {
          const previous =
            current.sha256 === undefined
              ? null
              : { sha256: current.sha256, bytes: current.bytes ?? 0 };
          const fresh = { sha256: next.sha256, bytes: next.bytes ?? 0 };
          const items = replacementHistory(state.history[next.key] ?? [], previous, fresh, {
            at,
            by: "disk",
          });
          appendHistory(doc, next.key, items);
        }
      }
      for (const entry of Object.values(state.assets))
        if (!seen.has(entry.key) && !entry.deleted && hasFile(kinds.get(entry.kind)))
          writeEntry(doc, { ...entry, deleted: { at, by: "disk" } });
    }, DISK_ORIGIN);
  }

  /** What the scan's files fail on together: a second asset of a one-per-project kind, a table row id two assets hold. */
  function acrossAssets(entries: readonly AssetEntry[]): ProjectProblem[] {
    const view = projectView(stateOf(entries));
    const values = new Map<AssetId, unknown>();
    for (const entry of view.byId.values()) values.set(entry.id, scannedJson.get(entry.key));
    return [
      ...onePerProjectIssues(view, kinds),
      ...dataTableIssues(view, values),
      ...sceneListIssues(view, values),
    ].map((issue) => ({
      path: view.byKey.get(issue.entityIds[0] ?? "")?.path ?? "",
      issues: [issue],
    }));
  }

  async function loadProject(doc: Y.Doc): Promise<ProjectProblem[]> {
    const { entries, disk, problems } = await scanFiles();
    problems.push(...acrossAssets(entries));
    scanned = new Map(entries.map((e) => [e.key, e]));
    const name = docNameOf({ kind: "project", project: projectId });
    const persisted = await persistedState(name);
    if (persisted) Y.applyUpdate(doc, persisted, PERSISTED_ORIGIN);
    if (projectMetaMap(doc).size > 0 || projectAssetsMap(doc).size > 0) reconcile(doc, entries);
    else seedProjectDoc(doc, stateOf(entries), DISK_ORIGIN);
    files.clear();
    for (const [key, onDisk] of disk) files.set(key, onDisk);
    projectDoc = doc;
    return problems;
  }

  async function storeProject(doc: Y.Doc): Promise<boolean> {
    projectDoc = doc;
    const state = readProject(doc);
    let wrote = false;
    const moves: { entry: AssetEntry; disk: OnDisk }[] = [];
    const creates: { entry: AssetEntry; def: AssetKindDef }[] = [];
    for (const entry of Object.values(state.assets)) {
      const def = kinds.get(entry.kind);
      if (!def || !hasFile(def)) continue;
      const disk = files.get(entry.key);
      if (entry.deleted) {
        if (disk) {
          await moveToTrash(entry.key, disk);
          wrote = true;
        }
      } else if (!disk) creates.push({ entry, def });
      else if (disk.path !== entry.path) moves.push({ entry, disk });
    }
    // A purged entry leaves the registry; its trashed text goes from the index too.
    const index = await trashIndex();
    const purged = [...index.keys()].filter((key) => !Object.hasOwn(state.assets, key));
    if (purged.length > 0) {
      for (const key of purged) index.delete(key);
      await saveTrash();
    }

    // Trashed files are gone and moving files are staged aside before any
    // create, so an entry can take a path this same write frees.
    const blocked = await blockedEntries(state);
    const staged: { entry: AssetEntry; disk: OnDisk; tmp: string }[] = [];
    for (const move of moves) {
      if (blocked.has(move.entry.key)) continue;
      const tmp = `${abs(move.disk.path)}.${process.pid}.${randomKey()}.move`;
      await rename(abs(move.disk.path), tmp);
      if (move.disk.sidecar !== null) await rm(abs(sidecarPathOf(move.disk.path)), { force: true });
      staged.push({ ...move, tmp });
    }

    for (const { entry, def } of creates) {
      if (blocked.has(entry.key)) continue;
      const folded = entry.path.toLowerCase();
      if (staged.some((m) => m.entry.path.toLowerCase() === folded)) continue;
      let onDisk: OnDisk;
      if (isBlobKind(def)) {
        const data = await blobOf(entry);
        if (data === null) continue;
        await writeAtomic(abs(entry.path), data);
        const blob = { sha256: entry.sha256 ?? (await sha256(data)), bytes: data.byteLength };
        onDisk = { path: entry.path, text: null, blob, sidecar: null };
      } else {
        const text = await contentFor(entry);
        if (text === null) continue;
        await writeAtomic(abs(entry.path), text);
        onDisk = { path: entry.path, text, blob: null, sidecar: null };
      }
      files.set(entry.key, onDisk);
      await forgetTrashed(entry.key);
      wrote = true;
    }

    for (const { entry, disk, tmp } of staged) {
      await mkdir(dirname(abs(entry.path)), { recursive: true });
      await rename(tmp, abs(entry.path));
      const from = disk.path;
      disk.path = entry.path;
      disk.sidecar = null;
      await pruneFolders(from);
      wrote = true;
    }

    for (const entry of Object.values(state.assets)) {
      const disk = files.get(entry.key);
      if (!disk || entry.deleted || disk.path !== entry.path) continue;
      if (disk.blob && entry.sha256 !== undefined && entry.sha256 !== disk.blob.sha256) {
        const data = await blobs.get(entry.sha256);
        if (data === null) continue;
        await writeAtomic(abs(disk.path), data);
        disk.blob = { sha256: entry.sha256, bytes: data.byteLength };
        wrote = true;
      }
      if (await writeSidecar(disk.path, disk, sidecarFor(entry, disk))) wrote = true;
    }
    await persist(docNameOf({ kind: "project", project: projectId }), doc);
    return wrote;
  }

  /** What on disk holds `path`, ignoring case, as a project-relative path; null when it is free to write. */
  async function diskHolder(path: AssetPath): Promise<AssetPath | null> {
    const segments = path.split("/");
    let at = "";
    for (const [i, segment] of segments.entries()) {
      const names = await readdir(at === "" ? dir : abs(at)).catch(() => null);
      if (!names) return null;
      const want = segment.toLowerCase();
      const found = names.find((n) => n.toLowerCase() === want);
      if (found === undefined) return null;
      const next = at === "" ? found : `${at}/${found}`;
      if (i === segments.length - 1 || found !== segment) return next;
      const folder = await stat(abs(next)).then(
        (st) => st.isDirectory(),
        () => false,
      );
      if (!folder) return next;
      at = next;
    }
    return null;
  }

  /**
   * The live entries a store would create or move onto a path something on
   * disk already holds, with that holder. A path a trash or another move in
   * the same store frees doesn't count, unless that move is held too.
   */
  async function blockedEntries(state: ProjectState): Promise<Map<AssetKey, AssetPath>> {
    // Folded path → the key of the entry moving off it; null for a trash.
    const freed = new Map<string, AssetKey | null>();
    const held: { key: AssetKey; holder: AssetPath }[] = [];
    for (const entry of Object.values(state.assets)) {
      const disk = files.get(entry.key);
      if (disk && entry.deleted) freed.set(disk.path.toLowerCase(), null);
      else if (disk && disk.path !== entry.path) freed.set(disk.path.toLowerCase(), entry.key);
    }
    for (const entry of Object.values(state.assets)) {
      if (entry.deleted || !hasFile(kinds.get(entry.kind))) continue;
      const disk = files.get(entry.key);
      if (disk && disk.path === entry.path) continue;
      const holder = await diskHolder(entry.path);
      if (holder !== null) held.push({ key: entry.key, holder });
    }
    const blocked = new Map<AssetKey, AssetPath>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const { key, holder } of held) {
        if (blocked.has(key)) continue;
        const folded = holder.toLowerCase();
        const freer = freed.get(folded);
        if (freer === null || (freer !== undefined && !blocked.has(freer))) continue;
        blocked.set(key, holder);
        changed = true;
      }
    }
    return blocked;
  }

  async function blockedWrite(doc: Y.Doc): Promise<SceneIssue | null> {
    const state = readProject(doc);
    const blocked = await blockedEntries(state);
    for (const entry of Object.values(state.assets)) {
      const holder = blocked.get(entry.key);
      if (holder === undefined) continue;
      return makeIssue("path-taken", {
        message:
          holder === entry.path
            ? `"${entry.path}" (${entry.id}) is already on disk and isn't that asset's file`
            : `"${entry.path}" (${entry.id}) is blocked by "${holder}" on disk`,
        entityIds: [entry.id],
        got: entry.path,
        hint: "Move or remove the file in the way, or give the asset another path.",
      });
    }
    return null;
  }

  // ─── File events ───────────────────────────────────────

  /**
   * A registry change from disk, in one `disk` transaction: the ops when the
   * entry is the one its id names, then a direct write of whatever the ops
   * left different from `next`, so the files' truth always lands.
   */
  function applyFromDisk(
    doc: Y.Doc,
    next: AssetEntry,
    ops: ProjectOp[],
    inspect?: BlobInspect,
  ): void {
    doc.transact(() => {
      const id = entryOf(next.key, doc)?.id;
      const shared = Object.values(readProject(doc).assets).some(
        (e) => e.key !== next.key && !e.deleted && e.id === id,
      );
      if (ops.length > 0 && !shared)
        applyRegistryBatch(doc, { v: 1, label: "Changed on disk", ops }, DISK_ORIGIN, {
          registry: registryNow(),
          kinds,
          now: next.deleted?.at ?? now(),
          inspect,
        });
      const current = entryOf(next.key, doc);
      if (!current || !sameValue(current, next)) writeEntry(doc, next, DISK_ORIGIN);
    }, DISK_ORIGIN);
  }

  /**
   * New bytes for a binary from disk: `replaceContent` with re-inspected
   * meta, and both hashes in its history even where the op is refused (a
   * recording's file was replaced by hand: the file still wins).
   */
  function replaceFromDisk(
    doc: Y.Doc,
    entry: AssetEntry,
    def: BlobKindDef,
    blob: BlobContent & { data: Uint8Array },
  ): AssetChange {
    const result = inspectEntry(def, entry, blob.data, idsIn(doc));
    const next = withBlob(entry, blob, result);
    const content = { sha256: blob.sha256, bytes: blob.bytes };
    const previous =
      entry.sha256 === undefined ? null : { sha256: entry.sha256, bytes: entry.bytes ?? 0 };
    doc.transact(() => {
      const before = readProject(doc).history[entry.key]?.length ?? 0;
      const op: ProjectOp = { op: "replaceContent", id: entry.id, ...content };
      applyFromDisk(doc, next, [op], result.ok ? () => result : undefined);
      const held = readProject(doc).history[entry.key];
      // The op, when it applied, already recorded the replacement.
      if ((held?.length ?? 0) > before) return;
      const items = replacementHistory(held ?? [], previous, content, { at: now(), by: "disk" });
      if (items.length > 0 || !held) appendHistory(doc, entry.key, items);
    }, DISK_ORIGIN);
    return {
      key: entry.key,
      id: next.id,
      kind: entry.kind,
      path: next.path,
      ...content,
      previous: previous?.sha256 ?? null,
    };
  }

  const bump = (result: ProjectSync): ProjectSync =>
    result.kind === "applied" ? { ...result, ops: result.ops + 1 } : { kind: "applied", ops: 1 };

  async function syncEdit(
    key: AssetKey,
    read: FileRead,
    docs: (name: string) => Y.Doc | undefined,
    doc: Y.Doc,
  ): Promise<ProjectSync> {
    const disk = files.get(key)!;
    const entry = entryOf(key, doc);
    const def = entry && kinds.get(entry.kind);
    let result: ProjectSync = { kind: "unchanged" };
    if (entry && isBlobKind(def)) {
      if (!read.blob)
        return {
          kind: "refused",
          reason: `${read.path} changed on disk but can't be taken.`,
          issues: read.problems.flatMap((p) => p.issues),
        };
      if (read.blob.sha256 !== disk.blob?.sha256) {
        const changed = replaceFromDisk(doc, entry, def, read.blob);
        disk.blob = { sha256: read.blob.sha256, bytes: read.blob.bytes };
        result = { kind: "applied", ops: 1, changed };
      }
    } else if (read.text !== null && read.text !== disk.text) {
      const open = entry && (docs(nameOf(entry)) ?? loaded.get(key));
      if (isDocKind(def) && open) {
        const parsed = parseAssetDoc(def, read.text, envNow());
        if (!parsed.ok)
          return {
            kind: "refused",
            reason: `${read.path} changed on disk but doesn't parse.`,
            issues: parsed.issues,
          };
        const codec = codecOf(def);
        if (codec.seeded(open)) {
          const patched = await codec.patch(open, parsed.value);
          if (patched.kind === "refused") return patched;
          result = patched;
        } else {
          codec.seed(open, key, parsed.value);
          result = { kind: "applied", ops: 1 };
        }
      }
      disk.text = read.text;
    }
    const current = entryOf(key, doc);
    if (current && def && read.sidecarText !== disk.sidecar) {
      const issues = read.problems.flatMap((p) => p.issues);
      if (read.sidecarText !== null && !read.sidecar)
        return { kind: "refused", reason: `${sidecarPathOf(read.path)} doesn't parse.`, issues };
      const { name: _name, licence: _licence, ...kept } = current;
      let next: AssetEntry = { ...kept, id: read.id ?? current.id };
      if (read.sidecar?.name !== undefined) next.name = read.sidecar.name;
      if (isBlobKind(def) && read.blob) {
        const settings = read.sidecar?.import ?? {};
        if (!sameValue(current.import ?? {}, settings)) {
          const { import: _import, ...rest } = next;
          const base: AssetEntry = isEmpty(settings) ? rest : { ...rest, import: { ...settings } };
          next = withBlob(base, read.blob, inspectEntry(def, base, read.blob.data, idsIn(doc)));
        }
      }
      if (read.sidecar?.licence !== undefined) next.licence = read.sidecar.licence;
      disk.sidecar = read.sidecarText;
      if (!sameValue(current, next)) {
        writeEntry(doc, next, DISK_ORIGIN);
        result = bump(result);
      }
    }
    return result;
  }

  async function syncPath(
    path: AssetPath,
    docs: (name: string) => Y.Doc | undefined,
    doc: Y.Doc,
  ): Promise<ProjectDiskSync> {
    const sidecarOf = path.endsWith(SIDECAR_SUFFIX) ? path.slice(0, -SIDECAR_SUFFIX.length) : null;
    const target = sidecarOf ?? path;
    if (!isCandidate(target)) return { kind: "unchanged" };
    const key = keyAt(target);
    const onDisk = await exists(abs(target));
    if (key !== undefined && onDisk) {
      const read = await readAsset(target);
      if (read) return syncEdit(key, read, docs, doc);
    }
    if (key === undefined && !onDisk) return { kind: "unchanged" };
    if (!pending.has(target)) pending.set(target, now());
    return { kind: "pending" };
  }

  async function settle(
    docs: (name: string) => Y.Doc | undefined,
    doc: Y.Doc,
  ): Promise<ProjectSync[]> {
    const batch = [...pending].sort((a, b) => a[1] - b[1]);
    pending.clear();
    const results: ProjectSync[] = [];
    const events: DiskEvent[] = [];
    const reads = new Map<DiskEvent, FileRead & AssetFile>();
    for (const [path, at] of batch) {
      const key = keyAt(path);
      const read = await readAsset(path);
      if (read && key !== undefined) results.push(await syncEdit(key, read, docs, doc));
      else if (read) {
        if (!listable(read)) continue;
        const event: DiskEvent = { type: "add", path, id: read.id!, at };
        if (read.sidecar) event.key = read.sidecar.key;
        events.push(event);
        reads.set(event, read);
      } else if (key !== undefined)
        events.push({ type: "unlink", path, key, id: entryOf(key, doc)?.id, at });
    }

    for (const change of pairDiskEvents(events, settleMs)) {
      if (change.type === "unlink") {
        const key = change.event.key!;
        const entry = entryOf(key, doc);
        const disk = files.get(key)!;
        await moveToTrash(key, { ...disk, sidecar: null });
        const stale = await readText(abs(sidecarPathOf(disk.path)));
        if (stale !== null && stale === disk.sidecar)
          await rm(abs(sidecarPathOf(disk.path)), { force: true });
        if (!entry || entry.deleted) continue;
        const next = { ...entry, deleted: { at: now(), by: "disk" } };
        applyFromDisk(doc, next, [{ op: "deleteAsset", id: entry.id, force: true }]);
        results.push({ kind: "applied", ops: 1 });
      } else if (change.type === "move") {
        const key = change.from.key!;
        const read = reads.get(change.to)!;
        const entry = entryOf(key, doc);
        const disk = files.get(key)!;
        const left = await readText(abs(sidecarPathOf(disk.path)));
        if (left !== null && left === disk.sidecar)
          await rm(abs(sidecarPathOf(disk.path)), { force: true });
        disk.path = read.path;
        if (!entry) continue;
        const ops: ProjectOp[] = [];
        if (folderPrefixOf(entry.path) !== folderPrefixOf(read.path))
          ops.push({ op: "moveAsset", ids: [entry.id], to: folderPrefixOf(read.path) });
        if (fileNameOf(entry.path) !== fileNameOf(read.path))
          ops.push({ op: "renameAsset", id: entry.id, file: fileNameOf(read.path) });
        const { name: _name, licence: _licence, deleted: _deleted, ...kept } = entry;
        const next: AssetEntry = { ...kept, path: read.path, id: read.id ?? entry.id };
        if (read.sidecar?.name !== undefined) next.name = read.sidecar.name;
        if (read.sidecar?.licence !== undefined) next.licence = read.sidecar.licence;
        applyFromDisk(doc, next, ops);
        disk.sidecar = read.sidecarText;
        const edit = await syncEdit(key, read, docs, doc);
        results.push(
          edit.kind === "refused"
            ? edit
            : edit.kind === "applied"
              ? { ...edit, ops: ops.length + edit.ops }
              : { kind: "applied", ops: ops.length },
        );
        await pruneFolders(change.from.path);
      } else {
        const read = reads.get(change.event)!;
        const state = readProject(doc);
        let key = read.sidecar?.key ?? read.id!;
        const holder = state.assets[key];
        if (holder && !holder.deleted) key = randomKey();
        const trashed = state.assets[key];
        const fresh = assetFileEntry(read, key, { at: now(), by: "disk" }, idsIn(doc)).entry;
        const next: AssetEntry = trashed ? { ...fresh, created: trashed.created } : fresh;
        doc.transact(() => {
          writeEntry(doc, next);
          if (next.sha256 !== undefined && !readProject(doc).history[key])
            appendHistory(doc, key, []);
        }, DISK_ORIGIN);
        files.set(key, onDiskOf(read));
        await forgetTrashed(key);
        const open = docs(nameOf(next)) ?? loaded.get(key);
        const def = kinds.get(next.kind);
        if (open && isDocKind(def) && read.text !== null) {
          const parsed = parseAssetDoc(def, read.text, envNow());
          const codec = codecOf(def);
          if (parsed.ok) {
            if (codec.seeded(open)) await codec.patch(open, parsed.value);
            else codec.seed(open, key, parsed.value);
          }
        }
        results.push({ kind: "applied", ops: 1 });
      }
    }
    return results;
  }

  async function repairBlobs(doc: Y.Doc, origin: DocOrigin): Promise<BlobRepair[]> {
    const state = readProject(doc);
    const repaired: BlobRepair[] = [];
    const fixes: AssetEntry[] = [];
    for (const entry of Object.values(state.assets)) {
      const def = kinds.get(entry.kind);
      if (!isBlobKind(def) || entry.deleted || entry.sha256 === undefined) continue;
      if (await blobs.has(entry.sha256)) continue;
      const candidates: BlobContent[] = [
        ...(files.get(entry.key)?.blob ? [files.get(entry.key)!.blob!] : []),
        ...[...(state.history[entry.key] ?? [])].reverse(),
      ];
      let fallback: (BlobContent & { data: Uint8Array }) | null = null;
      for (const c of candidates) {
        if (c.sha256 === entry.sha256) continue;
        const data = await blobs.get(c.sha256);
        if (data) {
          fallback = { sha256: c.sha256, bytes: data.byteLength, data };
          break;
        }
      }
      if (!fallback) continue;
      fixes.push(withBlob(entry, fallback, inspectEntry(def, entry, fallback.data, idsIn(doc))));
      repaired.push({ key: entry.key, id: entry.id, from: entry.sha256, to: fallback.sha256 });
    }
    if (fixes.length === 0) return repaired;
    const self = docNameOf({ kind: "project", project: projectId });
    doc.transact(() => {
      for (const fix of fixes) writeEntry(doc, fix);
      const id = randomKey();
      appendProjectLog(doc, {
        id,
        actor: origin,
        label: `Repair ${repaired.map((r) => r.id).join(", ")}: bytes the content store doesn't hold (hash-mismatch)`,
        at: now(),
        docs: [{ doc: self, entry: id }],
      });
    }, origin);
    return repaired;
  }

  return {
    scan,
    loadProject,
    loadDoc,
    storeProject,
    blockedWrite,
    storeDoc,
    syncPath,
    settle,
    persist,
    repairBlobs,
    valueOf(name, doc) {
      const { def } = docRef(name);
      const codec = codecOf(def);
      return codec.seeded(doc) ? codec.value(doc) : undefined;
    },
    forget(name) {
      const ref = parseDocName(name);
      if (ref && ref.kind !== "project") loaded.delete(ref.key);
    },
    watches(path) {
      if (path.endsWith(SIDECAR_SUFFIX)) return isCandidate(path.slice(0, -SIDECAR_SUFFIX.length));
      return (
        isCandidate(path) && mayBeAssetFile(kinds, path, () => existsSync(abs(sidecarPathOf(path))))
      );
    },
    docNameOf: nameOf,
  };
}

// ─── Code modules ────────────────────────────────────────

const SKIPPED_CODE_DIR = /^(node_modules|dist|\..*)$/;

async function walkCode(dir: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(rel === "" ? dir : join(dir, rel), { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    },
  );
  for (const entry of entries) {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_CODE_DIR.test(entry.name)) await walkCode(dir, path, out);
    } else if (entry.isFile()) out.push(path);
  }
}

/** What a game definition registers: its types, asset kinds, tables, code materials, layers and collision groups, each sorted. */
export function gameRegisters(
  game: GameDefinition | null | undefined,
): CodeModuleInfo["registers"] {
  if (!game) return {};
  const registers: CodeModuleInfo["registers"] = {};
  const lists = {
    types: game.types.map((t) => t.type),
    kinds: (game.assetKinds ?? []).map((k) => k.kind),
    tables: Object.keys(game.tables ?? {}),
    materials: Object.keys(game.materials ?? {}),
    layers: (game.layers ?? []).map((l) => l.name),
    // An engine group's entry only adds interactions; it registers no group.
    collisionGroups: Object.keys(game.collisionGroups ?? {}).filter(
      (name) => !(ENGINE_COLLISION_GROUPS as readonly string[]).includes(name),
    ),
  };
  for (const [field, names] of Object.entries(lists) as [keyof typeof lists, string[]][])
    if (names.length > 0) registers[field] = [...names].sort();
  return registers;
}

/**
 * The project's code modules, by project-relative path: the files its
 * `code` globs name (`!` globs and `ignore` exclude). The module the project
 * file names as the game's registers what the loaded game holds; the rest
 * register nothing the definition can attribute to them.
 */
export async function codeModules(project: FileProject): Promise<Record<string, CodeModuleInfo>> {
  if (!projectGlobs(project.file).code.some((g) => !g.startsWith("!"))) return {};
  const paths: string[] = [];
  await walkCode(project.dir, "", paths);
  const gameModule = project.file.game
    ? relative(project.dir, resolve(project.dir, project.file.game.module)).split(sep).join("/")
    : null;
  const code: Record<string, CodeModuleInfo> = {};
  for (const path of paths.sort()) {
    if (!isCodePath(project.file, path)) continue;
    code[path] = { registers: path === gameModule ? gameRegisters(project.game) : {} };
  }
  return code;
}

/** Whether a project-relative path is one of the project's code modules. */
export function isCodePath(file: ProjectFile, path: string): boolean {
  return projectPathMatcher(file, matchesGlob).isCode(path);
}

// ─── Prefab files, for the CLI ───────────────────────────

/** `<scenes dir>/prefabs`: where a scenes directory outside any project keeps its prefab files. */
export const prefabsDirOf = (scenesDir: string) => join(scenesDir, PREFABS_DIR);

/** The file for prefab `id` in a scenes directory; ids follow scene names' rules. */
export const prefabPath = (scenesDir: string, id: string) =>
  resolveScenePath(prefabsDirOf(scenesDir), id);

export type PrefabFiles = {
  prefabs: PrefabLibrary;
  /** Each prefab file's text as read, by id. */
  texts: Map<string, string>;
  /** Each read prefab's file, by id; absolute. */
  files: Map<string, string>;
  /** Files that didn't parse, or whose `id` isn't their asset's id; they are left out. */
  problems: { id: string; issues: SceneIssue[] }[];
};

type PrefabRead = PrefabFiles & { prefabs: Map<string, Prefab> };

const emptyPrefabRead = (): PrefabRead => ({
  prefabs: new Map(),
  texts: new Map(),
  files: new Map(),
  problems: [],
});

const badPrefabId = (message: string): SceneIssue[] => [
  { severity: "error", code: "bad-id", message, path: "/id", entityIds: [] },
];

/**
 * Parses prefab texts by id on demand, each with the others (and `known`,
 * tried first) as its lookup, so a migration reads the units of the
 * prefabs its instances and variants name. A cycle reads as unresolved.
 */
function prefabResolver(
  texts: ReadonlyMap<string, string>,
  registry: Registry,
  known: (id: string) => Prefab | undefined = () => undefined,
): (id: string) => ParsePrefabResult | undefined {
  const done = new Map<string, ParsePrefabResult>();
  const open = new Set<string>();
  const lookup = (id: string): Prefab | undefined => {
    const hit = known(id);
    if (hit) return hit;
    const r = get(id);
    return r?.ok ? r.prefab : undefined;
  };
  const get = (id: string): ParsePrefabResult | undefined => {
    const hit = done.get(id);
    if (hit) return hit;
    const text = texts.get(id);
    if (text === undefined || open.has(id)) return undefined;
    open.add(id);
    const r = parsePrefab(text, registry, { prefab: lookup });
    open.delete(id);
    done.set(id, r);
    return r;
  };
  return get;
}

/** Fills `out` from prefab texts read by id, checking each parsed id against `idProblem`. */
function collectPrefabs(
  out: PrefabRead,
  read: ReadonlyMap<string, { text: string; path: string }>,
  registry: Registry,
  idProblem: (id: string, got: string) => string,
): void {
  const parsed = prefabResolver(new Map([...read].map(([id, r]) => [id, r.text])), registry);
  for (const [id, { text, path }] of read) {
    const result = parsed(id)!;
    if (!result.ok) {
      out.problems.push({ id, issues: result.issues });
      continue;
    }
    if (result.prefab.id !== id) {
      out.problems.push({ id, issues: badPrefabId(idProblem(id, result.prefab.id)) });
      continue;
    }
    out.prefabs.set(id, result.prefab);
    out.texts.set(id, text);
    out.files.set(id, path);
  }
}

/**
 * Reads every prefab in `prefabs/` of a scenes directory outside any
 * project, where a prefab's id is its file name; a missing `prefabs/` is an
 * empty library.
 */
export async function readPrefabFiles(scenesDir: string, registry: Registry): Promise<PrefabFiles> {
  const dir = prefabsDirOf(scenesDir);
  const names = await readdir(dir).catch(() => [] as string[]);
  const read = new Map<string, { text: string; path: string; file: string }>();
  for (const file of names.sort()) {
    const id = sceneNameOf(file);
    if (!id) continue;
    const path = join(dir, file);
    read.set(id, { text: await readFile(path, "utf8"), path, file });
  }
  const out = emptyPrefabRead();
  collectPrefabs(
    out,
    read,
    registry,
    (id, got) =>
      `prefabs/${read.get(id)!.file} has the id "${got}"; a prefab's id is its file name`,
  );
  return out;
}

/**
 * Reads a project's live prefab assets from `state` (a scan of its files),
 * each at its registry path, judged by `registry`.
 */
export async function readProjectPrefabFiles(
  project: Pick<FileProject, "dir" | "kinds">,
  state: ProjectState,
  registry: Registry,
): Promise<PrefabFiles> {
  const view = projectView(state, project.kinds);
  const read = new Map<string, { text: string; path: string; asset: string }>();
  for (const entry of [...view.byId.values()].sort((a, b) => byCodeUnit(a.id, b.id))) {
    if (entry.kind !== prefabKind.kind) continue;
    const path = join(project.dir, ...entry.path.split("/"));
    const text = await readText(path);
    if (text !== null) read.set(entry.id, { text, path, asset: entry.path });
  }
  const out = emptyPrefabRead();
  collectPrefabs(
    out,
    read,
    registry,
    (id, got) => `${read.get(id)!.asset} has the id "${got}"; its asset's id is "${id}"`,
  );
  return out;
}

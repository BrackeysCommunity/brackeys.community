import type { Registry } from "../game/types";
import { assetFileEntries, ownAssetId, type AssetFile } from "./asset-files";
import { entryInfo, type AssetInfo } from "./asset-info";
import { deepFreeze } from "./canonical";
import type { ContentStore } from "./content-store";
import { createKindRegistry, parseAssetDoc, type KindRegistry } from "./kinds";
import { rowSchemaOf, tableAssets } from "./kinds/data-table";
import {
  byCodeUnit,
  byPathThenKey,
  docLookup,
  isPlainObject,
  isRuntimeKind,
  runtimeKindNames,
  type DocLookup,
} from "./kinds/define";
import { gameSettingsEntries, gameSettingsValues } from "./kinds/game-settings";
import type { InputMapFile } from "./kinds/input-map";
import { kindInputMap } from "./kinds/input-script";
import { sceneListEntries, sceneListFlow, type SceneListFlow } from "./kinds/scene-list";
import type { AssetSidecar } from "./sidecar";
import { jsonValues, pinnedDocs, snapshotView, type ProjectSnapshot } from "./snapshot";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  AssetKindName,
  AssetPath,
  ProjectId,
  ProjectView,
} from "./types";
import { projectView } from "./view";

/** What game code reads of its project, as of load and frozen for the run. */
export type ProjectRuntimeView = {
  /** game-settings' `game` block, defaults applied. */
  settings: Readonly<Record<string, unknown>>;
  /** game-settings' `engine` block as written (`resolution` and the like); empty without one. */
  engine: Readonly<Record<string, unknown>>;
  /** Rows of a table, merged across its assets in path order. */
  table(name: string): readonly Readonly<Record<string, unknown> & { id: string }>[];
  /** What `assetInfo` gives for a blob asset, frozen at load; undefined for an unknown id, a doc asset or an unknown frame. */
  asset(id: AssetId, frame?: string): AssetInfo | undefined;
  /**
   * The project's input map, the first by path: the bindings layer between
   * the host's and the game's. Seats, actions and touch controls it gets
   * wrong are left out, so those keep the game's; null without one.
   */
  inputMap: InputMapFile | null;
  /**
   * The project's scene list, the first by path: the start scene and the
   * listed scenes in order, a repeated scene's later entries left out;
   * `{ start: null, scenes: [] }` without one. `runtimeView` always sets it.
   */
  flow?: SceneListFlow;
  /**
   * A runtime kind's doc (`DocKindDef.runtime`), parsed, migrated and
   * frozen; undefined for an unknown id, a doc that doesn't parse, or a
   * kind that isn't a runtime kind. `runtimeView` always sets it.
   */
  doc?: DocLookup["read"];
  /** The ids `doc` answers for a runtime kind, in path order. `runtimeView` always sets it. */
  docs?: DocLookup["ids"];
};

type Row = Readonly<Record<string, unknown> & { id: string }>;

/**
 * The runtime view of a project; `values` holds each doc asset's plain JSON
 * by id. `settings` is the first game-settings asset's `game` block by
 * path, with the game's `projectSettings` defaults applied. A table's rows
 * are its assets' rows in path order, each through the table's row schema
 * (defaults applied); a row that doesn't fit it, or whose id an earlier row
 * has, is left out (the editor reports both). A table the game doesn't
 * declare has no rows. `engine` is that asset's `engine` block, unparsed.
 * `inputMap` is the first input-map asset by path, as `usableInputMap`
 * reads it, and `flow` the first scene list's as `sceneListFlow` reads it.
 * `doc` and `docs` hold every doc of `kinds`' runtime kinds that parses.
 * Read once, copied and frozen.
 */
export function runtimeView(
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
  registry: Registry,
  kinds: KindRegistry = createKindRegistry(registry.game),
): ProjectRuntimeView {
  const [settingsEntry] = gameSettingsEntries(view);
  const file = settingsEntry ? values.get(settingsEntry.id) : undefined;
  const game = isPlainObject(file) && isPlainObject(file.game) ? file.game : undefined;
  const settings = deepFreeze(structuredClone(gameSettingsValues(registry, game)));
  const engine = deepFreeze(
    structuredClone(isPlainObject(file) && isPlainObject(file.engine) ? file.engine : {}),
  );

  const tables = new Map<string, readonly Row[]>();
  for (const [name, def] of Object.entries(registry.game?.tables ?? {})) {
    const schema = rowSchemaOf(def);
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const { rows: own } of tableAssets(view, values, name)) {
      for (const raw of own) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) continue;
        const row = parsed.data as Row;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(deepFreeze(structuredClone(row)));
      }
    }
    tables.set(name, Object.freeze(rows));
  }
  const none: readonly Row[] = Object.freeze([]);

  const assets = new Map<AssetId, { info: AssetInfo; frames: ReadonlyMap<string, AssetInfo> }>();
  for (const entry of view.byId.values()) {
    if (entry.sha256 === undefined) continue;
    const read = entryInfo(structuredClone(entry));
    const info = deepFreeze(read.info);
    const frames = new Map<string, AssetInfo>();
    for (const [name, own] of read.frames) frames.set(name, deepFreeze({ ...info, ...own }));
    assets.set(entry.id, { info, frames });
  }

  const map = kindInputMap(view, (id) => values.get(id), registry);
  const inputMap = map ? deepFreeze(structuredClone(map)) : null;

  const [listEntry] = sceneListEntries(view);
  const flow = deepFreeze(
    structuredClone(sceneListFlow(listEntry ? values.get(listEntry.id) : undefined)),
  );

  const runtimeDocs = docLookup(runtimeDocsOf(view, values, registry, kinds));

  return Object.freeze({
    settings,
    engine,
    table: (name: string) => tables.get(name) ?? none,
    asset: (id: AssetId, frame?: string): AssetInfo | undefined => {
      const found = assets.get(id);
      return frame === undefined ? found?.info : found?.frames.get(frame);
    },
    inputMap,
    flow,
    doc: runtimeDocs.read,
    docs: runtimeDocs.ids,
  });
}

/** Each runtime kind's docs that parse, frozen, by id in path order. */
function runtimeDocsOf(
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
  registry: Registry,
  kinds: KindRegistry,
): Map<AssetKindName, Map<AssetId, unknown>> {
  const out = new Map<AssetKindName, Map<AssetId, unknown>>();
  const env = { registry, project: view };
  const entries = [...view.byId.values()].sort(byPathThenKey);
  for (const def of kinds.list()) {
    if (!isRuntimeKind(def)) continue;
    const parsed = new Map<AssetId, unknown>();
    for (const entry of entries) {
      if (entry.kind !== def.kind || !values.has(entry.id)) continue;
      const read = parseAssetDoc(def, values.get(entry.id), env);
      if (read.ok) parsed.set(entry.id, deepFreeze(structuredClone(read.value)));
    }
    out.set(def.kind, parsed);
  }
  return out;
}

/**
 * `runtimeView` of a snapshot: its runtime kinds' docs (`runtimeKindNames`), each
 * read from its canonical text in `store`, and its blobs as the snapshot
 * pins them: hash, size, import settings and meta, so `asset` gives what
 * `assetInfo` gives over the project (pixel sizes and frames included)
 * while no blob is read. Throws a `SnapshotError` when a doc has no text
 * there or bytes that don't hash to its pin; a text that isn't JSON is left
 * out.
 */
export async function snapshotRuntimeView(
  snapshot: ProjectSnapshot,
  store: ContentStore,
  registry: Registry,
): Promise<ProjectRuntimeView> {
  const kinds = createKindRegistry(registry.game);
  const { texts } = await pinnedDocs(snapshot, store, runtimeKindNames(kinds));
  const view = snapshotView(snapshot, kinds);
  return runtimeView(view, jsonValues(texts), registry, kinds);
}

/** A project file as a host holds it in memory: a doc's parsed JSON, or a binary's sidecar alone. */
export type HeldFile = {
  /** Project-relative. */
  path: AssetPath;
  /** A doc's JSON; absent for a binary, whose sidecar carries its hash, size, import settings and meta. */
  json?: unknown;
  sidecar?: AssetSidecar | null;
};

/** A project read from held files: the view and kinds bundles are computed over, and what its game reads. */
export type HeldProject = { view: ProjectView; kinds: KindRegistry; runtime: ProjectRuntimeView };

/**
 * The project `files` make, keyed and identified the way the scene CLI
 * seeds one from disk: in path order, each file's kind detected from its
 * path, JSON and sidecar, its id and key its sidecar's, else its own. A
 * binary is read from its sidecar, so no blob is fetched; one whose sidecar
 * has no hash, a doc without its JSON and a file of no kind are left out.
 */
export function heldProject(
  files: readonly HeldFile[],
  registry: Registry,
  meta: { projectId: ProjectId; name: string },
): HeldProject {
  const kinds = createKindRegistry(registry.game);
  const held: (AssetFile & { json: unknown })[] = [];
  for (const { path, json, sidecar = null } of [...files].sort((a, b) =>
    byCodeUnit(a.path, b.path),
  )) {
    const def = kinds.detect(path, json, sidecar?.assetKind);
    if (!def) continue;
    if (def.storage === "doc" ? json === undefined : sidecar?.sha256 === undefined) continue;
    const id = sidecar?.id ?? ownAssetId(def, path, json);
    if (id === null) continue;
    held.push({ path, def, id, sidecar, blob: null, json });
  }
  const assets: Record<AssetKey, AssetEntry> = {};
  const docs = new Map<AssetKey, unknown>();
  for (const { file, key, entry } of assetFileEntries(held, { at: 0, by: "host" })) {
    const { sidecar } = file;
    if (file.def.storage === "blob" && sidecar) {
      entry.sha256 = sidecar.sha256;
      entry.bytes = sidecar.bytes;
      if (sidecar.import && Object.keys(sidecar.import).length > 0)
        entry.import = structuredClone(sidecar.import);
      if (sidecar.meta) entry.meta = structuredClone(sidecar.meta);
    } else docs.set(key, file.json);
    assets[key] = entry;
  }
  const view = projectView(
    {
      meta: { projectId: meta.projectId, layout: 1, name: meta.name },
      assets,
      history: {},
      code: {},
      build: {},
    },
    kinds,
  );
  // Two files may take one id: each id reads the doc of the entry the view resolves it to.
  const values = new Map<AssetId, unknown>();
  for (const [id, entry] of view.byId) if (docs.has(entry.key)) values.set(id, docs.get(entry.key));
  return { view, kinds, runtime: runtimeView(view, values, registry, kinds) };
}

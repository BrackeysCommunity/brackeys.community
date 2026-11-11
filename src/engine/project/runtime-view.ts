import type { Registry } from "../game/types";
import { entryInfo, type AssetInfo } from "./asset-info";
import { deepFreeze } from "./canonical";
import type { ContentStore } from "./content-store";
import { createKindRegistry } from "./kinds";
import { DATA_TABLE_KIND, rowSchemaOf, tableAssets } from "./kinds/data-table";
import { isPlainObject } from "./kinds/define";
import { GAME_SETTINGS_KIND, gameSettingsEntries, gameSettingsValues } from "./kinds/game-settings";
import {
  INPUT_MAP_KIND,
  inputMapEntries,
  usableInputMap,
  type InputMapFile,
} from "./kinds/input-map";
import { jsonValues, pinnedDocs, snapshotView, type ProjectSnapshot } from "./snapshot";
import type { AssetId, AssetKindName, ProjectView } from "./types";

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
};

/** The doc kinds a runtime view reads: a host loading one passes these docs' values. */
export const RUNTIME_VIEW_KINDS: readonly AssetKindName[] = [
  GAME_SETTINGS_KIND,
  DATA_TABLE_KIND,
  INPUT_MAP_KIND,
];

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
 * reads it. Read once, copied and frozen.
 */
export function runtimeView(
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
  registry: Registry,
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

  const [mapEntry] = inputMapEntries(view);
  const map = mapEntry ? usableInputMap(values.get(mapEntry.id), registry) : null;
  const inputMap = map ? deepFreeze(structuredClone(map)) : null;

  return Object.freeze({
    settings,
    engine,
    table: (name: string) => tables.get(name) ?? none,
    asset: (id: AssetId, frame?: string): AssetInfo | undefined => {
      const found = assets.get(id);
      return frame === undefined ? found?.info : found?.frames.get(frame);
    },
    inputMap,
  });
}

/**
 * `runtimeView` of a snapshot: its game-settings, data-table and input-map docs, each
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
  const { texts } = await pinnedDocs(snapshot, store, RUNTIME_VIEW_KINDS);
  const view = snapshotView(snapshot, createKindRegistry(registry.game));
  return runtimeView(view, jsonValues(texts), registry);
}

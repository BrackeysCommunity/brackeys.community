import type { Registry } from "../game/types";
import type { ContentStore } from "./content-store";
import { DATA_TABLE_KIND, rowSchemaOf, tableAssets } from "./kinds/data-table";
import { isPlainObject } from "./kinds/define";
import { GAME_SETTINGS_KIND, gameSettingsEntries, gameSettingsValues } from "./kinds/game-settings";
import { jsonValues, pinnedDocs, type ProjectSnapshot } from "./snapshot";
import type { AssetId, ProjectView } from "./types";

/** What game code reads of its project, as of load and frozen for the run. */
export type ProjectRuntimeView = {
  /** game-settings' `game` block, defaults applied. */
  settings: Readonly<Record<string, unknown>>;
  /** Rows of a table, merged across its assets in path order. */
  table(name: string): readonly Readonly<Record<string, unknown> & { id: string }>[];
};

type Row = Readonly<Record<string, unknown> & { id: string }>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * The runtime view of a project; `values` holds each doc asset's plain JSON
 * by id. `settings` is the first game-settings asset's `game` block by
 * path, with the game's `projectSettings` defaults applied. A table's rows
 * are its assets' rows in path order, each through the table's row schema
 * (defaults applied); a row that doesn't fit it, or whose id an earlier row
 * has, is left out (the editor reports both). A table the game doesn't
 * declare has no rows. Read once, copied and frozen.
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

  return Object.freeze({ settings, table: (name: string) => tables.get(name) ?? none });
}

/**
 * `runtimeView` of a snapshot: its game-settings and data-table docs, each
 * read from its canonical text in `store`. Throws a `SnapshotError` when
 * one has no text there or bytes that don't hash to its pin; a text that
 * isn't JSON is left out.
 */
export async function snapshotRuntimeView(
  snapshot: ProjectSnapshot,
  store: ContentStore,
  registry: Registry,
): Promise<ProjectRuntimeView> {
  const { view, texts } = await pinnedDocs(snapshot, store, [GAME_SETTINGS_KIND, DATA_TABLE_KIND]);
  return runtimeView(view, jsonValues(texts), registry);
}

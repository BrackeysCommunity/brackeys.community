import { deepFreeze } from "../project/canonical";
import { docLookup } from "../project/kinds/define";
import type { InputMapFile } from "../project/kinds/input-map";
import type { SceneListFlow } from "../project/kinds/scene-list";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId, AssetKindName } from "../project/types";

type Row = Readonly<Record<string, unknown> & { id: string }>;

export type MemoryRuntimeViewInit = {
  /** game-settings' `game` block as the game reads it; nothing is defaulted. */
  settings?: Readonly<Record<string, unknown>>;
  /** game-settings' `engine` block; default `{}`. */
  engine?: Readonly<Record<string, unknown>>;
  /** Each table's rows by table name. */
  tables?: Readonly<Record<string, readonly Row[]>>;
  inputMap?: InputMapFile | null;
  flow?: SceneListFlow;
  /** Runtime docs: kind → id → parsed value, ids in the order `docs(kind)` gives them. */
  docs?: Readonly<Record<AssetKindName, Readonly<Record<AssetId, unknown>>>>;
};

/**
 * A ProjectRuntimeView built from plain values, for tests and hosts with no
 * project files: everything copied and frozen, no blob assets. Docs are
 * taken as given, so they are neither parsed nor checked against a kind.
 */
export function memoryRuntimeView(init: MemoryRuntimeViewInit = {}): ProjectRuntimeView {
  const frozen = <T>(value: T): T => deepFreeze(structuredClone(value));
  const settings = frozen(init.settings ?? {});
  const engine = frozen(init.engine ?? {});
  const tables = frozen(init.tables ?? {});
  const byKind = new Map<AssetKindName, Map<AssetId, unknown>>();
  for (const [kind, byId] of Object.entries(init.docs ?? {})) {
    const values = new Map<AssetId, unknown>();
    for (const [id, value] of Object.entries(byId)) values.set(id, frozen(value));
    byKind.set(kind, values);
  }
  const docs = docLookup(byKind);
  const none: readonly Row[] = Object.freeze([]);
  return Object.freeze({
    settings,
    engine,
    table: (name: string) => (Object.hasOwn(tables, name) ? tables[name]! : none),
    asset: () => undefined,
    inputMap: init.inputMap ? frozen(init.inputMap) : null,
    flow: frozen(init.flow ?? { start: null, scenes: [] }),
    doc: docs.doc,
    docs: docs.docs,
  });
}

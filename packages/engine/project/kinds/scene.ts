import type { z } from "zod";

import type { Registry } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import { createScene } from "../../scene/create";
import { expandInstance } from "../../scene/expand";
import { formatScene } from "../../scene/format";
import { isGridValue } from "../../scene/grid";
import { MIGRATIONS } from "../../scene/migrate";
import { parseScene } from "../../scene/parse";
import { CHILD_SEPARATOR, gridTurns, headOfRef } from "../../scene/resolve";
import { sceneGameOf, sceneRegistry, sceneSchemaFor } from "../../scene/schema";
import {
  SCENE_FORMAT_VERSION,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "../../scene/types";
import { schemaRefSites, type RefSite } from "../refs";
import { defineAssetKind, folderOf, isPlainObject, type DocLookup, type KindEnv } from "./define";
import { bodyRefs, bulkMaterialRefs } from "./fields";
import { docStringKeyIssues } from "./strings";
import { tilemapIssues, tilesetImageInfo, type TilesetFile } from "./tileset";

const SCENE_KIND = "scene";
const TILEMAP = "tilemap";

type TileGrid = Parameters<typeof tilemapIssues>[3];

/** One entity judged by the tile rule, when its type is a tilemap. */
function entityTilemapIssues(
  entity: { id: string; type: string; tileset?: unknown; cells?: unknown },
  registry: Registry,
  lookup: DocLookup,
  env: KindEnv,
  grid: TileGrid,
  pointer: string,
): SceneIssue[] {
  const type = registry.types.get(entity.type);
  if ((type?.base ?? type?.type) !== TILEMAP) return [];
  const tilesetId = typeof entity.tileset === "string" ? entity.tileset : undefined;
  const tileset =
    tilesetId === undefined ? undefined : lookup.read<TilesetFile>("tileset", tilesetId);
  return tilemapIssues(
    {
      id: entity.id,
      ...(tilesetId === undefined ? {} : { tileset: tilesetId }),
      ...(isGridValue(entity.cells) ? { cells: entity.cells } : {}),
    },
    tileset,
    tileset ? tilesetImageInfo(env.project, tileset.image) : null,
    grid,
    pointer,
  );
}

/** The project's prefabs as the lookup holds them, `own` in place of its stored copy. */
function prefabLibrary(lookup: DocLookup, own?: Prefab): PrefabLibrary {
  const library = new Map<string, Prefab>();
  for (const id of lookup.ids("prefab")) {
    const prefab = lookup.read<Prefab>("prefab", id);
    if (prefab) library.set(id, prefab);
  }
  if (own) library.set(own.id, own);
  return library;
}

/**
 * The tilemaps `inst` places, as a load expands it (params, overrides,
 * variant bases, nested instances), each judged by the tile rule. A prefab
 * that doesn't resolve or expand is another check's issue.
 */
function instanceTilemapIssues(
  inst: InstanceDef,
  library: PrefabLibrary,
  registry: Registry,
  lookup: DocLookup,
  env: KindEnv,
  grid: TileGrid,
  cells: boolean,
  where: (entityId: string) => string,
): SceneIssue[] {
  let expanded: ReturnType<typeof expandInstance>;
  try {
    expanded = expandInstance(inst, library, registry, { cells });
  } catch {
    return [];
  }
  if (!expanded.ok) return [];
  return expanded.entities.flatMap((e) =>
    entityTilemapIssues(e, registry, lookup, env, grid, where(e.id)),
  );
}

/** Each tilemap the scene loads, its own and its instances', judged by the one tile rule. */
function sceneTilemapIssues(def: SceneDefinition, lookup: DocLookup, env: KindEnv): SceneIssue[] {
  const registry = sceneRegistry(sceneGameOf(def), env.registry);
  if (!registry) return [];
  const grid = def.settings?.grid;
  const gridInfo = grid ? { settings: grid, pxPerMetre: pxPerMetreOf(registry) } : null;
  const own = (def.entities ?? []).flatMap((entity, i) =>
    entityTilemapIssues(entity, registry, lookup, env, gridInfo, `/entities/${i}`),
  );
  const instances = def.instances ?? [];
  if (instances.length === 0) return own;
  const library = prefabLibrary(lookup);
  const cells = gridTurns(def);
  return [
    ...own,
    ...instances.flatMap((inst, i) =>
      inst.off
        ? []
        : instanceTilemapIssues(
            inst,
            library,
            registry,
            lookup,
            env,
            gridInfo,
            cells,
            () => `/instances/${i}`,
          ),
    ),
  ];
}

/**
 * Each tilemap a prefab places, as one instance of it would: its own
 * children, a variant's base children and nested instances' children.
 * No scene grid is known here, so only the tileset and tile ids are judged.
 */
export function prefabTilemapIssues(prefab: Prefab, lookup: DocLookup, env: KindEnv): SceneIssue[] {
  const registry = sceneRegistry(prefab.game, env.registry);
  if (!registry) return [];
  const prefix = `${prefab.id}${CHILD_SEPARATOR}`;
  const entityAt = new Map(prefab.entities.map((e, i) => [e.id, i]));
  const instanceAt = new Map((prefab.instances ?? []).map((inst, i) => [inst.id, i]));
  const where = (id: string) => {
    const child = id.startsWith(prefix) ? id.slice(prefix.length) : id;
    const entity = entityAt.get(child);
    if (entity !== undefined) return `/entities/${entity}`;
    const instance = instanceAt.get(headOfRef(child));
    return instance !== undefined ? `/instances/${instance}` : "/base";
  };
  const self: InstanceDef = { id: prefab.id, prefab: prefab.id, at: [0, 0] };
  return instanceTilemapIssues(
    self,
    prefabLibrary(lookup, prefab),
    registry,
    lookup,
    env,
    null,
    false,
    where,
  ).map((issue) => ({
    ...issue,
    entityIds: issue.entityIds.map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id)),
  }));
}

/** A level: entities, instances and bulk geometry, co-edited per entity and field through the scene codec. */
export const sceneKind = defineAssetKind({
  kind: SCENE_KIND,
  title: "Scene",
  description: "A level: entities, prefab instances and bulk geometry.",
  match: { test: (json) => isPlainObject(json) && !("kind" in json) && "v" in json },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  prefix: "scene",
  version: SCENE_FORMAT_VERSION,
  migrations: MIGRATIONS,
  schemaId: `urn:jams-engine:scene:v${SCENE_FORMAT_VERSION}`,
  schema: (env) => sceneSchemaFor(env.registry) as unknown as z.ZodType<SceneDefinition>,
  layout: "custom",
  parse(input, env) {
    const result = parseScene(input, env.registry, { prefab: env.prefab });
    if (!result.ok) return result;
    const { def, issues, migratedFrom } = result;
    return migratedFrom === undefined
      ? { ok: true, value: def, issues }
      : { ok: true, value: def, migratedFrom, issues };
  },
  format: (def: SceneDefinition) => formatScene(def).text,
  crossValidate: (def: SceneDefinition, lookup: DocLookup, env) => [
    ...docStringKeyIssues(SCENE_KIND, def, lookup),
    ...sceneTilemapIssues(def, lookup, env),
  ],
  empty: (env, { id }) => createScene(id, env.registry),
  refs(def: SceneDefinition, env): RefSite[] {
    const registry = sceneRegistry(sceneGameOf(def), env.registry);
    const refs = bodyRefs(registry, def);
    if (!registry) return refs;
    return [
      ...refs,
      ...schemaRefSites(registry.settings, def.settings, "/settings"),
      ...bulkMaterialRefs(registry, def, []),
    ];
  },
});

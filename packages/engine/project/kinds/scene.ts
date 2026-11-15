import type { z } from "zod";

import { pxPerMetreOf } from "../../game/units";
import { createScene } from "../../scene/create";
import { formatScene } from "../../scene/format";
import { isGridValue } from "../../scene/grid";
import { MIGRATIONS } from "../../scene/migrate";
import { parseScene } from "../../scene/parse";
import { sceneGameOf, sceneRegistry, sceneSchemaFor } from "../../scene/schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition, type SceneIssue } from "../../scene/types";
import { schemaRefSites, type RefSite } from "../refs";
import { defineAssetKind, folderOf, isPlainObject, type DocLookup, type KindEnv } from "./define";
import { bodyRefs, bulkMaterialRefs } from "./fields";
import { docStringKeyIssues } from "./strings";
import { tilemapIssues, tilesetImageInfo, type TilesetFile } from "./tileset";

const SCENE_KIND = "scene";
const TILEMAP = "tilemap";

/** Each tilemap entity's cells, tileset and grid, judged by the one tile rule. */
function sceneTilemapIssues(def: SceneDefinition, lookup: DocLookup, env: KindEnv): SceneIssue[] {
  const registry = sceneRegistry(sceneGameOf(def), env.registry);
  if (!registry) return [];
  const grid = def.settings?.grid;
  const gridInfo = grid ? { settings: grid, pxPerMetre: pxPerMetreOf(registry) } : null;
  const issues: SceneIssue[] = [];
  (def.entities ?? []).forEach((entity, i) => {
    const type = registry.types.get(entity.type);
    if ((type?.base ?? type?.type) !== TILEMAP) return;
    const tilesetId = typeof entity.tileset === "string" ? entity.tileset : undefined;
    const tileset =
      tilesetId === undefined ? undefined : lookup.read<TilesetFile>("tileset", tilesetId);
    issues.push(
      ...tilemapIssues(
        {
          id: entity.id,
          ...(tilesetId === undefined ? {} : { tileset: tilesetId }),
          ...(isGridValue(entity.cells) ? { cells: entity.cells } : {}),
        },
        tileset,
        tileset ? tilesetImageInfo(env.project, tileset.image) : null,
        gridInfo,
        `/entities/${i}`,
      ),
    );
  });
  return issues;
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

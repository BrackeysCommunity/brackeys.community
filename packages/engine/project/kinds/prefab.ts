import type { z } from "zod";

import { ENGINE_REGISTRY_ID } from "../../game/types";
import { formatPrefab } from "../../scene/format";
import { MIGRATIONS } from "../../scene/migrate";
import { parsePrefab, PREFABS_DIR, prefabOf, prefabSchemaFor } from "../../scene/prefab";
import { sceneRegistry } from "../../scene/schema";
import { PREFAB_KIND, SCENE_FORMAT_VERSION, type Prefab } from "../../scene/types";
import type { RefSite } from "../refs";
import { defineAssetKind, folderOf, joinFolder } from "./define";
import { bodyRefs, bulkMaterialRefs } from "./fields";

/** A reusable piece of a level placed by instances, co-edited per child and field. */
export const prefabKind = defineAssetKind({
  kind: "prefab",
  title: "Prefab",
  description: "A reusable group of entities around a local origin, placed in scenes by instances.",
  match: { jsonKind: PREFAB_KIND },
  defaultFolder: (_env, near) => {
    const folder = folderOf(near);
    return folder === PREFABS_DIR || folder.endsWith(`/${PREFABS_DIR}`)
      ? folder
      : joinFolder(folder, PREFABS_DIR);
  },
  storage: "doc",
  version: SCENE_FORMAT_VERSION,
  migrations: MIGRATIONS,
  schemaId: `urn:jams-engine:prefab:v${SCENE_FORMAT_VERSION}`,
  schema: (env) => prefabSchemaFor(env.registry) as unknown as z.ZodType<Prefab>,
  layout: "custom",
  idField: "id",
  parse(input, env) {
    const result = parsePrefab(input, env.registry, { prefab: env.prefab });
    if (!result.ok) return result;
    const { prefab, issues, migratedFrom } = result;
    return migratedFrom === undefined
      ? { ok: true, value: prefab, issues }
      : { ok: true, value: prefab, migratedFrom, issues };
  },
  format: (prefab: Prefab) => formatPrefab(prefab),
  empty: (env, { id }) =>
    prefabOf(
      id,
      { entities: [] },
      env.registry.id === ENGINE_REGISTRY_ID ? undefined : env.registry.id,
    ),
  refs(prefab: Prefab, env): RefSite[] {
    const registry = sceneRegistry(prefab.game, env.registry);
    const base: RefSite[] =
      typeof prefab.base === "string"
        ? [{ pointer: "/base", id: prefab.base, kinds: ["prefab"] }]
        : [];
    const refs = [...base, ...bodyRefs(registry, prefab)];
    return registry ? [...refs, ...bulkMaterialRefs(registry, prefab.bulk, ["bulk"])] : refs;
  },
});

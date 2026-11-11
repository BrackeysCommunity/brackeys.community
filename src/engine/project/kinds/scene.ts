import type { z } from "zod";

import { createScene } from "../../scene/create";
import { formatScene } from "../../scene/format";
import { MIGRATIONS } from "../../scene/migrate";
import { parseScene } from "../../scene/parse";
import { sceneGameOf, sceneRegistry, sceneSchemaFor } from "../../scene/schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { schemaRefSites, type RefSite } from "../refs";
import { defineAssetKind, folderOf, isPlainObject } from "./define";
import { bodyRefs, bulkMaterialRefs } from "./fields";

/** A level: entities, instances and bulk geometry, co-edited per entity and field through the scene codec. */
export const sceneKind = defineAssetKind({
  kind: "scene",
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

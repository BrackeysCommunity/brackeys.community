import { z } from "zod";

import { SceneV1 } from "./schema";
import { SCENE_FORMAT_VERSION } from "./types";

/** Prefix of every JSON Schema `$id` the engine publishes: `urn:jams-engine:<name>:v<n>`. */
export const SCHEMA_ID_BASE = "urn:jams-engine:";

/** Zod's `id` meta names `$defs` entries; it isn't a JSON Schema keyword, so it is dropped from the output. */
export function stripMetaIds(ctx: { jsonSchema: Record<string, unknown> }): void {
  delete ctx.jsonSchema.id;
}

export function sceneJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(SceneV1, {
    target: "draft-2020-12",
    override: stripMetaIds,
  }) as Record<string, unknown>;
  return {
    $schema,
    $id: `${SCHEMA_ID_BASE}scene:v${SCENE_FORMAT_VERSION}`,
    title: `jams engine scene, format v${SCENE_FORMAT_VERSION}`,
    ...rest,
  };
}

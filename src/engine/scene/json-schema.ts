import { z } from "zod";

import { ENGINE_REGISTRY_ID, type Registry } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { fragmentSchemaFor } from "./fragment";
import { jsonPointer } from "./issues";
import { prefabSchemaFor } from "./prefab";
import { sceneSchemaFor } from "./schema";
import { SCENE_FORMAT_VERSION } from "./types";

/** Prefix of every JSON Schema `$id` the engine publishes: `urn:jams-engine:<name>:v<n>`. */
export const SCHEMA_ID_BASE = "urn:jams-engine:";

/** `urn:jams-engine:<name>:v<version>`, or `urn:jams-engine:<name>:<game>:v<version>` for a game's registry. */
export function schemaIdFor(registry: Registry, name: string, version: number): string {
  const game = registry.id === ENGINE_REGISTRY_ID ? "" : `${registry.id}:`;
  return `${SCHEMA_ID_BASE}${name}:${game}v${version}`;
}

/** Zod's `id` meta names `$defs` entries; it isn't a JSON Schema keyword, so it is dropped from the output. */
export function stripMetaIds(ctx: { jsonSchema: Record<string, unknown> }): void {
  delete ctx.jsonSchema.id;
}

/** Draft 2020-12 JSON Schema of a Zod schema, `$defs` named by `meta({ id })`. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: "draft-2020-12",
    override: stripMetaIds,
  }) as Record<string, unknown>;
}

/** The JSON Schema of scenes judged by `registry`, with `$id` `registry.schemaId` and the agent surface version. */
export function sceneJsonSchema(registry: Registry): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(sceneSchemaFor(registry));
  const of = registry.id === ENGINE_REGISTRY_ID ? "" : ` for ${registry.id}`;
  return {
    $schema,
    $id: registry.schemaId,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine scene${of}, format v${SCENE_FORMAT_VERSION}`,
    ...rest,
  };
}

function documentSchema(
  registry: Registry,
  name: string,
  title: string,
  schema: z.ZodType,
): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(schema);
  const of = registry.id === ENGINE_REGISTRY_ID ? "" : ` for ${registry.id}`;
  return {
    $schema,
    $id: schemaIdFor(registry, name, SCENE_FORMAT_VERSION),
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine ${title}${of}, format v${SCENE_FORMAT_VERSION}`,
    ...rest,
  };
}

/** The JSON Schema of scene fragments (the clipboard's JSON) judged by `registry`. */
export function fragmentJsonSchema(registry: Registry): Record<string, unknown> {
  return documentSchema(registry, "fragment", "scene fragment", fragmentSchemaFor(registry));
}

/** The JSON Schema of prefab files judged by `registry`, the game's contract included. */
export function prefabJsonSchema(registry: Registry): Record<string, unknown> {
  return documentSchema(registry, "prefab", "prefab", prefabSchemaFor(registry));
}

type JsonNode = Record<string, unknown>;

const isNode = (v: unknown): v is JsonNode => v !== null && typeof v === "object";

/**
 * JSON Pointers of every object property and tuple item in a JSON Schema
 * that has no `description`, so a test can keep a schema readable as
 * documentation. A `const` tuple item (a shape's tag) needs none; a `$ref`
 * counts as described when its target is.
 */
export function undescribedProperties(schema: Record<string, unknown>): string[] {
  const defs = isNode(schema.$defs) ? (schema.$defs as Record<string, JsonNode>) : {};
  const described = (node: unknown): boolean => {
    if (!isNode(node)) return true;
    if (typeof node.description === "string" && node.description.length > 0) return true;
    if ("const" in node) return true;
    const ref = typeof node.$ref === "string" ? node.$ref.split("/").pop() : undefined;
    return ref !== undefined && typeof defs[ref]?.description === "string";
  };
  const out: string[] = [];
  const walk = (node: unknown, pointer: string): void => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${pointer}/${i}`));
      return;
    }
    if (!isNode(node)) return;
    if (isNode(node.properties)) {
      for (const [k, v] of Object.entries(node.properties))
        if (!described(v)) out.push(`${pointer}${jsonPointer(["properties", k])}`);
    }
    if (Array.isArray(node.prefixItems)) {
      node.prefixItems.forEach((v, i) => {
        if (!described(v)) out.push(`${pointer}/prefixItems/${i}`);
      });
    }
    for (const [k, v] of Object.entries(node)) walk(v, `${pointer}/${k}`);
  };
  walk(schema, "");
  return out;
}

/**
 * Entity fields in a scene JSON Schema without a `title`, as
 * `<type>.<field>`: the inspector labels fields by it. A `$ref` counts as
 * titled when its target is.
 */
export function untitledEntityFields(schema: Record<string, unknown>): string[] {
  const defs = isNode(schema.$defs) ? (schema.$defs as Record<string, JsonNode>) : {};
  const titled = (node: JsonNode): boolean => {
    if (typeof node.title === "string") return true;
    const ref = typeof node.$ref === "string" ? node.$ref.split("/").pop() : undefined;
    return ref !== undefined && typeof defs[ref]?.title === "string";
  };
  const entities = Array.isArray(defs.Entity?.oneOf) ? (defs.Entity.oneOf as JsonNode[]) : [];
  return entities.flatMap((entity) => {
    const props = isNode(entity.properties) ? (entity.properties as Record<string, JsonNode>) : {};
    const type = String(props.type?.const);
    return Object.entries(props)
      .filter(([, field]) => !titled(field))
      .map(([name]) => `${type}.${name}`);
  });
}

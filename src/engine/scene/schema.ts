import { z } from "zod";

import { BASE_FIELDS, ID_PATTERN, PathSchema, PtSchema } from "../game/fields";
import { ENGINE_REGISTRY_ID, type RegisteredType, type Registry } from "../game/types";
import { makeIssue } from "./issues";
import { derivesFrom, isShapeSchema } from "./shapes";
import { SCENE_FORMAT_VERSION, type EntityTypeName, type SceneIssue } from "./types";

export { ID_PATTERN };

// ─── Which registry judges a scene ───────────────────────

/** The scene's `game` key, read without validating anything, so a tool can pick the registry. */
export function sceneGameOf(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const game = (raw as Record<string, unknown>).game;
  return typeof game === "string" ? game : undefined;
}

/**
 * The registry a scene naming `game` is judged by: `registry` when it is
 * that game's, the engine's alone when the scene names no game (so a
 * gameless scene means the same to every tool), `null` for any other game.
 */
export function sceneRegistry(game: string | undefined, registry: Registry): Registry | null {
  if (game === undefined) return registry.primitives;
  return game === registry.id && registry.id !== ENGINE_REGISTRY_ID ? registry : null;
}

export function unknownGameIssue(game: string, registry: Registry): SceneIssue {
  const have =
    registry.id === ENGINE_REGISTRY_ID ? "engine primitives only" : `the "${registry.id}" game`;
  return makeIssue("unknown-game", {
    message: `the scene is for game "${game}", but this tool has ${have}`,
    path: "/game",
    expected: registry.id === ENGINE_REGISTRY_ID ? "no game key" : `"${registry.id}"`,
    got: JSON.stringify(game),
  });
}

// ─── Field kinds ─────────────────────────────────────────

/** What a field's schema holds, for tools that treat geometry specially. */
export type FieldKind = "shape" | "point" | "path" | "value";

/** Shape tuples, points and paths are recognised by the schema they were built from (`game/fields.ts`). */
export function fieldKind(schema: z.core.$ZodType): FieldKind {
  if (isShapeSchema(schema)) return "shape";
  if (derivesFrom(schema, PtSchema)) return "point";
  if (derivesFrom(schema, PathSchema)) return "path";
  return "value";
}

/** `schema` without its optional, nullable, default and other wrappers. */
export function unwrapSchema(schema: z.core.$ZodType): z.core.$ZodType {
  let s = schema;
  while ("innerType" in s._zod.def) s = (s._zod.def as { innerType: z.core.$ZodType }).innerType;
  return s;
}

/** A type's geometry fields, in declaration order. */
export function geometryFields(
  t: RegisteredType,
): { field: string; kind: Exclude<FieldKind, "value"> }[] {
  const out: { field: string; kind: Exclude<FieldKind, "value"> }[] = [];
  for (const [field, schema] of Object.entries(t.shape)) {
    const kind = fieldKind(schema);
    if (kind !== "value") out.push({ field, kind });
  }
  return out;
}

// ─── Schemas ─────────────────────────────────────────────

const { id: idField, ...editorFields } = BASE_FIELDS;

function typeSchema(t: RegisteredType) {
  return z
    .strictObject({
      id: idField,
      type: z.literal(t.type).describe(t.description).meta({ title: "Type", group: "identity" }),
      ...editorFields,
      ...t.shape,
    })
    .describe(`${t.type}: ${t.description}`);
}

/** The on-disk schema of one registered type's entities; `undefined` for an unregistered type. */
export function entitySchemaFor(registry: Registry, type: EntityTypeName): z.ZodObject | undefined {
  const t = registry.types.get(type);
  return t && typeSchema(t);
}

const unwrapOptional = (schema: z.ZodType): z.ZodType =>
  schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodType) : schema;

function bulkSchemas(registry: Registry): Record<string, z.ZodType> {
  const out: Record<string, z.ZodType> = {};
  for (const b of [...registry.bulkKeys].sort((x, y) => (x.key < y.key ? -1 : 1))) {
    const t = registry.types.get(b.type)!;
    const material = b.material ? registry.materials.get(b.material) : undefined;
    const what = material
      ? `${t.bulk!.description} Material ${b.material}: ${material.description}`
      : t.bulk!.description;
    out[b.key] = z
      .array(unwrapOptional(t.shape[b.field] as z.ZodType))
      .optional()
      .describe(`${what} Entries have no id; ops refer to them as ~${b.key}:<index>.`);
  }
  return out;
}

const BoundsSchema = z
  .tuple([
    z.number().int().describe("minX, px."),
    z.number().int().describe("minY, px (top; y is down)."),
    z.number().int().describe("maxX, px."),
    z.number().int().describe("maxY, px (bottom)."),
  ])
  .superRefine(([minX, minY, maxX, maxY], ctx) => {
    if (!(minX < maxX))
      ctx.addIssue({
        code: "custom",
        message: `bounds minX (${minX}) must be < maxX (${maxX})`,
        path: [0],
      });
    if (!(minY < maxY))
      ctx.addIssue({
        code: "custom",
        message: `bounds minY (${minY}) must be < maxY (${maxY})`,
        path: [1],
      });
  })
  .describe(
    "World rectangle [minX, minY, maxX, maxY] in px; y is down. Limits the camera; anything outside it is flagged.",
  )
  .meta({ title: "Bounds", unit: "px" });

const IntPt = z
  .tuple([
    z.number().int().describe("x, px.").meta({ unit: "px" }),
    z.number().int().describe("y, px; y is down.").meta({ unit: "px" }),
  ])
  .describe("A point [x, y] in integer world pixels; y is down.");

export const GroupSchema = z
  .strictObject({
    at: IntPt.describe(
      "The group's origin in world px. Members store their geometry relative to it, so moving the group is one edit here.",
    ).meta({ title: "Origin", unit: "px", group: "geometry" }),
    name: BASE_FIELDS.name,
  })
  .describe("A group of entities and instances that move together around a local origin.")
  .meta({ id: "Group" });

/** Override keys: a child id or `~key:index`, a dot, then a field path. */
export const OVERRIDE_PATH =
  /^(?:[a-z0-9][a-z0-9-]{0,47}|~[a-z0-9:-]+:\d+)\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

export const InstanceSchema = z
  .strictObject({
    id: idField,
    prefab: z
      .string()
      .regex(ID_PATTERN)
      .describe("The prefab placed here: the file prefabs/<prefab>.json beside the scene.")
      .meta({ title: "Prefab", group: "identity" }),
    ...editorFields,
    at: IntPt.describe(
      "Where the prefab's origin lands, in world px (relative to the group's origin when in a group).",
    ).meta({ title: "Position", unit: "px", group: "geometry" }),
    overrides: z
      .record(
        z.string().regex(OVERRIDE_PATH, {
          error: "an override key is `<childId>.<field.path>`, e.g. door.path.speed",
        }),
        z.unknown(),
      )
      .optional()
      .describe(
        "Child fields that differ from the prefab, keyed `<childId>.<field.path>` (`door.path.speed`, `~solid:0.shape`). Values are in the prefab's own frame, before `at`.",
      )
      .meta({ title: "Overrides", group: "overrides" }),
  })
  .describe(
    "One placement of a prefab. Its children load with ids `<id>/<childId>`, moved by `at`.",
  )
  .meta({ id: "Instance" });

/**
 * The schema of a scene judged by `registry`: header keys, one optional
 * array per bulk key, and `entities` discriminated by `type`, in canonical
 * key order. A game's schema requires `"game": "<id>"`; the engine's has no
 * `game` key.
 */
export function sceneSchemaFor(registry: Registry): z.ZodObject {
  const types = [...registry.types.values()].map(typeSchema);
  const entity = z
    .discriminatedUnion(
      "type",
      types as [ReturnType<typeof typeSchema>, ...ReturnType<typeof typeSchema>[]],
    )
    .describe(
      "An entity with a stable id. `type` picks the registered type and which fields apply.",
    )
    .meta({ id: "Entity" });
  const game =
    registry.id === ENGINE_REGISTRY_ID
      ? {}
      : {
          game: z
            .literal(registry.id)
            .describe("The game whose registered types this scene uses.")
            .meta({ title: "Game" }),
        };
  return z
    .strictObject({
      $schema: z
        .string()
        .optional()
        .describe("Path or URI of this file's JSON Schema, for editors. Ignored by the engine."),
      v: z
        .literal(SCENE_FORMAT_VERSION)
        .describe(
          "Scene format version. Files are migrated up on load and always saved at the current version.",
        ),
      ...game,
      name: z
        .string()
        .regex(ID_PATTERN)
        .describe("Scene name, same rules as an id; matches the file name without .json.")
        .meta({ title: "Name" }),
      bounds: BoundsSchema,
      settings: z
        .strictObject(registry.settings)
        .optional()
        .describe("Scene-wide settings: the engine's, then the game's.")
        .meta({ title: "Settings" }),
      groups: z
        .record(z.string().regex(ID_PATTERN), GroupSchema)
        .optional()
        .describe(
          "Groups by id. An entity or instance whose `group` names one stores its geometry relative to the group's `at`.",
        ),
      instances: z
        .array(InstanceSchema)
        .optional()
        .describe("Prefab instances, each a copy of a prefab file placed at `at`."),
      ...bulkSchemas(registry),
      entities: z
        .array(entity)
        .optional()
        .describe(
          "Entities with stable ids: anything that moves, has parameters, or is referenced.",
        ),
    })
    .describe(
      "A jams engine scene. Units are integer pixels with y pointing down. Simple static geometry lives in the bulk arrays; everything else is an entity.",
    );
}

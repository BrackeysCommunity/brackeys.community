import { z } from "zod";

import { BEHAVIORS_FIELD, type BehaviorBlock, type RegisteredBehavior } from "../game/behaviors";
import {
  AssetIdSchema,
  BASE_FIELDS,
  fieldMeta,
  ID_PATTERN,
  PathSchema,
  PtSchema,
} from "../game/fields";
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
export type FieldKind =
  | "shape"
  | "point"
  | "path"
  | "vector"
  | "angle"
  | "mirror"
  | "grid"
  | "value";

const META_KINDS: readonly string[] = ["vector", "angle", "mirror", "grid"];

/**
 * Shape tuples, points and paths are recognised by the schema they were
 * built from, vectors, angles, mirrors and grids by their builder's
 * `meta.kind` (`game/fields.ts`).
 */
export function fieldKind(schema: z.core.$ZodType): FieldKind {
  const kind = fieldMeta(schema, "kind");
  if (typeof kind === "string" && META_KINDS.includes(kind)) return kind as FieldKind;
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

// ─── Behaviors ───────────────────────────────────────────

/** The meta key that marks a type's `behaviors` object (`"slot"`) or a type that has none (`"none"`). */
export const BEHAVIOR_SLOT_META = "x-behaviors";

/**
 * One behavior's block on a type: its fields, each optional when `given`
 * (the behavior's defaults under the type's) fills it. `needed` tells
 * whether some field has no default, so a required behavior's block must
 * be written.
 */
function blockSchema(
  b: RegisteredBehavior,
  given: BehaviorBlock,
): { schema: z.ZodType; needed: boolean } {
  const shape: Record<string, z.core.$ZodType> = {};
  let needed = false;
  for (const [field, s] of Object.entries(b.shape)) {
    const optional = s._zod.optin === "optional" || given[field] !== undefined;
    if (!optional) needed = true;
    shape[field] = optional && s._zod.optout !== "optional" ? (s as z.ZodType).optional() : s;
  }
  const schema = z
    .strictObject(shape)
    .describe(b.description)
    .meta({ title: b.inspector?.label ?? b.name, group: "behaviors" });
  return { schema, needed };
}

/**
 * A type's `behaviors` object: a block per allowed behavior, validated by
 * its fields. Any other name parses, so validation can report it as
 * unknown or forbidden by name.
 */
function behaviorsSchema(registry: Registry, t: RegisteredType): z.ZodType {
  if (t.loads === false) return z.record(z.string(), z.unknown()).optional();
  const rules = registry.behaviorRules(t.type);
  const shape: Record<string, z.core.$ZodType> = {};
  let needed = false;
  for (const name of rules.allowed) {
    const b = registry.behaviors.get(name);
    if (!b) continue;
    const block = blockSchema(b, rules.defaults.get(name) ?? {});
    const must = block.needed && rules.required.has(name);
    if (must) needed = true;
    shape[name] = must ? block.schema : block.schema.optional();
  }
  const slot = z
    .object(shape)
    .catchall(z.unknown())
    .describe(
      "Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present.",
    )
    .meta({ title: "Behaviors", group: "behaviors", [BEHAVIOR_SLOT_META]: "slot" });
  return needed ? slot : slot.optional();
}

const { id: idField, ...editorFields } = BASE_FIELDS;

function typeSchema(registry: Registry, t: RegisteredType): z.ZodObject {
  const schema = z
    .strictObject({
      id: idField,
      type: z.literal(t.type).describe(t.description).meta({ title: "Type", group: "identity" }),
      ...editorFields,
      ...t.shape,
      [BEHAVIORS_FIELD]: behaviorsSchema(registry, t),
    })
    .describe(`${t.type}: ${t.description}`);
  return t.loads === false ? schema.meta({ [BEHAVIOR_SLOT_META]: "none" }) : schema;
}

/** The on-disk schema of one registered type's entities; `undefined` for an unregistered type. */
export function entitySchemaFor(registry: Registry, type: EntityTypeName): z.ZodObject | undefined {
  const t = registry.types.get(type);
  return t && typeSchema(registry, t);
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

const RotSchema = z
  .literal([1, 2, 3])
  .optional()
  .describe("Quarter turns clockwise (y down), applied after `flip`. Omitted means 0.")
  .meta({ title: "Rotation", group: "geometry" });

const FlipSchema = z
  .literal(true)
  .optional()
  .describe("Mirror x in the local frame, before `rot`. Omitted means not mirrored.")
  .meta({ title: "Mirror", group: "geometry" });

export const GroupSchema = z
  .strictObject({
    at: IntPt.describe(
      "The group's origin in world px. Members store their geometry relative to it, so moving the group is one edit here.",
    ).meta({ title: "Origin", unit: "px", group: "geometry" }),
    rot: RotSchema,
    flip: FlipSchema,
    name: BASE_FIELDS.name,
  })
  .describe("A group of entities and instances that move together around a local origin.")
  .meta({ id: "Group" });

const OVERRIDE_ID = ID_PATTERN.source.slice(1, -1);
const OVERRIDE_BULK = `~${OVERRIDE_ID}(?::${OVERRIDE_ID})?:(?:0|[1-9][0-9]*)`;
const OVERRIDE_SEGMENT = `(?:${BEHAVIORS_FIELD}\\.(?:${OVERRIDE_ID}/)?${OVERRIDE_ID}|[A-Za-z_$][A-Za-z0-9_$]*|0|[1-9][0-9]*)`;

/**
 * Override keys: a child ref (ids joined by `/`, optionally ending in a
 * `~key:index`), a dot, then a field path whose segment right after
 * `behaviors` may be a behavior name (`door.behaviors.game/glow.intensity`).
 */
export const OVERRIDE_PATH = new RegExp(
  `^(?:${OVERRIDE_ID}(?:/${OVERRIDE_ID})*(?:/${OVERRIDE_BULK})?|${OVERRIDE_BULK})\\.${OVERRIDE_SEGMENT}(?:\\.${OVERRIDE_SEGMENT})*$`,
);

export const InstanceSchema = z
  .strictObject({
    id: idField,
    prefab: z
      .string()
      .regex(ID_PATTERN)
      .describe("The prefab placed here: the file prefabs/<prefab>.json beside the scene.")
      .meta({ title: "Prefab", group: "identity" }),
    ...editorFields,
    z: BASE_FIELDS.z.describe(
      "Added to the z of every child, an integer in [-10000, 10000]. Omitted means 0.",
    ),
    at: IntPt.describe(
      "Where the prefab's origin lands, in world px (relative to the group's origin when in a group).",
    ).meta({ title: "Position", unit: "px", group: "geometry" }),
    rot: RotSchema,
    flip: FlipSchema,
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Values of the prefab's exposed parameters, by name.")
      .meta({ title: "Parameters", group: "overrides" }),
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
    "One placement of a prefab. Its children load with ids `<id>/<childId>`, mirrored by `flip`, turned by `rot` and moved by `at`.",
  )
  .meta({ id: "Instance" });

/**
 * The schema of a scene judged by `registry`: header keys, one optional
 * array per bulk key, and `entities` discriminated by `type`, in canonical
 * key order. A game's schema requires `"game": "<id>"`; the engine's has no
 * `game` key.
 */
export function sceneSchemaFor(registry: Registry): z.ZodObject {
  const types = [...registry.types.values()].map((t) => typeSchema(registry, t));
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
      assets: z
        .array(AssetIdSchema)
        .optional()
        .describe("Asset ids only game code names, so they count as used: sorted, each once.")
        .meta({ title: "Assets" }),
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

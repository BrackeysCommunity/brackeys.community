import { z } from "zod";

import { BEHAVIORS_FIELD, type BehaviorBlock, type RegisteredBehavior } from "../game/behaviors";
import { isSpawnOnly, placeableTypes } from "../game/define";
import {
  AssetIdSchema,
  BASE_FIELDS,
  fieldMeta,
  ID_PATTERN,
  PathSchema,
  PtSchema,
  Z_LIMIT,
} from "../game/fields";
import { ENGINE_REGISTRY_ID, type RegisteredType, type Registry } from "../game/types";
import { FIELD_NAME_SOURCE } from "./field-path";
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
  | "side"
  | "grid"
  | "tags"
  | "value";

const META_KINDS: readonly string[] = ["vector", "angle", "mirror", "side", "grid", "tags"];

/**
 * Shape tuples, points and paths are recognised by the schema they were
 * built from, vectors, angles, mirrors, sides, grids and tags by their
 * builder's `meta.kind` (`game/fields.ts`).
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

/** A type's geometry fields, in declaration order. Tags are labels, not geometry. */
export function geometryFields(
  t: RegisteredType,
): { field: string; kind: Exclude<FieldKind, "value" | "tags"> }[] {
  const out: { field: string; kind: Exclude<FieldKind, "value" | "tags"> }[] = [];
  for (const [field, schema] of Object.entries(t.shape)) {
    const kind = fieldKind(schema);
    if (kind !== "value" && kind !== "tags") out.push({ field, kind });
  }
  return out;
}

/** A type's tag fields (`tagsField`), in declaration order; what `ctx.query`'s `tag` reads. */
export function tagFieldsOf(t: RegisteredType | undefined): string[] {
  if (!t) return [];
  return Object.entries(t.shape).flatMap(([field, schema]) =>
    fieldKind(schema) === "tags" ? [field] : [],
  );
}

/** The string tags an entity carries across its type's `tagFields`; what `ctx.query`'s `tag` matches. */
export function entityTags(
  e: Readonly<Record<string, unknown>>,
  tagFields: readonly string[],
): Set<string> {
  const tags = new Set<string>();
  for (const field of tagFields) {
    const value = e[field];
    if (Array.isArray(value)) for (const t of value) if (typeof t === "string") tags.add(t);
  }
  return tags;
}

/** A type's grid fields, in declaration order; none for an unregistered type. */
export function gridFieldsOf(t: RegisteredType | undefined): string[] {
  return t ? geometryFields(t).flatMap((f) => (f.kind === "grid" ? [f.field] : [])) : [];
}

// ─── Schemas ─────────────────────────────────────────────

// ─── Behaviors ───────────────────────────────────────────

/** The meta key that marks a type's `behaviors` object (`"slot"`) or a type that has none (`"none"`). */
export const BEHAVIOR_SLOT_META = "x-behaviors";

/**
 * A block field without its default, so parsing keeps only what a file
 * writes (`expandScene` fills the rest); the description and the
 * default stay in its metadata for the JSON Schema. A default under an
 * `optional` or `nullable` wrapper goes too (`blockSchema` makes the field
 * optional again), and `nullable` is kept.
 */
function withoutDefault(s: z.core.$ZodType): z.core.$ZodType {
  let inner: z.core.$ZodType = s;
  let meta: Record<string, unknown> = {};
  let fallback: unknown;
  let defaulted = false;
  let nullable = false;
  for (;;) {
    if (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) {
      if (!defaulted) fallback = inner._zod.def.defaultValue;
      defaulted = true;
    } else if (inner instanceof z.ZodNullable) nullable = true;
    else if (!(inner instanceof z.ZodOptional)) break;
    meta = { ...z.globalRegistry.get(inner), ...meta };
    inner = inner.unwrap();
  }
  if (!defaulted) return s;
  const bare = inner as z.ZodType;
  return (nullable ? bare.nullable() : bare).meta({ ...meta, default: fallback });
}

/**
 * `schema`, a behavior's block, with the behavior's `refine` applied to the
 * block over `given` (the defaults it will carry): every path that checks a
 * block goes through here.
 */
export function refineBlock<S extends z.ZodType>(
  b: Pick<RegisteredBehavior, "refine">,
  schema: S,
  given: BehaviorBlock = {},
): S {
  const refine = b.refine;
  if (!refine) return schema;
  return schema.superRefine((block, issue) => {
    const message = refine({ ...given, ...(block as BehaviorBlock) });
    if (message !== undefined) issue.addIssue({ code: "custom", message, input: block });
  });
}

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
    const kept = withoutDefault(s);
    shape[field] =
      optional && kept._zod.optout !== "optional" ? (kept as z.ZodType).optional() : kept;
  }
  const schema = refineBlock(b, z.strictObject(shape), given)
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

/** Schemas built from a registry, which never changes once built, so each is built once per registry. */
const built = new WeakMap<Registry, Map<string, unknown>>();

export function builtFor<T>(registry: Registry, key: string, build: () => T): T {
  let byKey = built.get(registry);
  if (!byKey) built.set(registry, (byKey = new Map()));
  if (!byKey.has(key)) byKey.set(key, build());
  return byKey.get(key) as T;
}

const { id: idField, ...editorFields } = BASE_FIELDS;

function typeSchema(
  registry: Registry,
  t: RegisteredType,
  id: z.core.$ZodType = idField,
): z.ZodObject {
  const schema = z
    .strictObject({
      id,
      type: z.literal(t.type).describe(t.description).meta({ title: "Type", group: "identity" }),
      ...editorFields,
      ...t.shape,
      [BEHAVIORS_FIELD]: behaviorsSchema(registry, t),
    })
    .describe(`${t.type}: ${t.description}`);
  return t.loads === false ? schema.meta({ [BEHAVIOR_SLOT_META]: "none" }) : schema;
}

/**
 * The on-disk schema of one placeable type's entities; `undefined` for an
 * unregistered or spawn-only type, which no scene may name.
 */
export function entitySchemaFor(registry: Registry, type: EntityTypeName): z.ZodObject | undefined {
  const t = registry.types.get(type);
  return t && !isSpawnOnly(registry, type)
    ? builtFor(registry, `entity:${type}`, () => typeSchema(registry, t))
    : undefined;
}

const SpawnIdSchema = z
  .string()
  .optional()
  .describe(
    "A runtime id `<name>#<label>`; omitted, the next `<type>#<n>`. The runtime checks it.",
  );

/**
 * What `ctx.spawn` takes for `type`: the entity as a scene file writes it,
 * without its scene id (a runtime id is checked by the runtime, not here).
 * Placeable and spawn-only types alike; `undefined` for a type that is
 * unregistered or never loads.
 */
export function spawnSchemaFor(registry: Registry, type: EntityTypeName): z.ZodObject | undefined {
  const t = registry.types.get(type);
  return t && t.loads !== false
    ? builtFor(registry, `spawn:${type}`, () => typeSchema(registry, t, SpawnIdSchema))
    : undefined;
}

/** Why a scene can't name `type`, worded once for parse, ops and validate. */
export function spawnOnlyMessage(type: EntityTypeName): string {
  return `type "${type}" is spawned by game code only; a scene can't place it`;
}

/** The hint for a spawn-only type named in a scene, prefab or op. */
export function spawnOnlyHint(registry: Registry): string {
  return `Make it with ctx.spawn in game code, or place one of ${placeableTypes(registry).join(", ")}.`;
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
    z.number().describe("minX, m.").meta({ unit: "m" }),
    z.number().describe("minY, m (top; y is down).").meta({ unit: "m" }),
    z.number().describe("maxX, m.").meta({ unit: "m" }),
    z.number().describe("maxY, m (bottom).").meta({ unit: "m" }),
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
    "World rectangle [minX, minY, maxX, maxY] in metres; y is down. Limits the camera; anything outside it is flagged.",
  )
  .meta({ title: "Bounds", unit: "m" });

const MetrePt = z
  .tuple([
    z.number().describe("x, m.").meta({ unit: "m" }),
    z.number().describe("y, m; y is down.").meta({ unit: "m" }),
  ])
  .describe("A point [x, y] in world metres; y is down.")
  .meta({ unit: "m" });

const RotSchema = z
  .number()
  .gt(0)
  .lt(360)
  .optional()
  .describe("Degrees clockwise (y down), in (0, 360), applied after `flip`. Omitted means 0.")
  .meta({ kind: "angle", unit: "deg", title: "Rotation", group: "geometry" });

const FlipSchema = z
  .literal(true)
  .optional()
  .describe("Mirror x in the local frame, before `rot`. Omitted means not mirrored.")
  .meta({ title: "Mirror", group: "geometry" });

const OVERRIDE_ID = ID_PATTERN.source.slice(1, -1);
const OVERRIDE_BULK = `~${OVERRIDE_ID}(?::${OVERRIDE_ID})?:(?:0|[1-9][0-9]*)`;
const OVERRIDE_SEGMENT = `(?:${BEHAVIORS_FIELD}\\.(?:${OVERRIDE_ID}/)?${OVERRIDE_ID}|${FIELD_NAME_SOURCE}|0|[1-9][0-9]*)`;

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
      `Added to the z of every child, an integer in [-${Z_LIMIT}, ${Z_LIMIT}]. Omitted means 0.`,
    ),
    at: MetrePt.describe(
      "Where the prefab's origin lands, in world metres (in its parent's frame when it has one).",
    ).meta({ title: "Position", unit: "m", group: "geometry" }),
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
 * array per bulk key, and `entities` discriminated by `type` over the
 * placeable types (spawn-only types are left out), in canonical key order. A game's schema requires `"game": "<id>"`; the engine's has no
 * `game` key.
 */
export function sceneSchemaFor(registry: Registry): z.ZodObject {
  return builtFor(registry, "scene", () => buildSceneSchema(registry));
}

function buildSceneSchema(registry: Registry): z.ZodObject {
  const types = placeableTypes(registry).map((name) => entitySchemaFor(registry, name)!);
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
      "A jams engine scene. Lengths are metres with y pointing down; the game's px per metre draws them. Simple static geometry lives in the bulk arrays; everything else is an entity.",
    );
}

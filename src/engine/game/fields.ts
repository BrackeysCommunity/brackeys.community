import { z } from "zod";

import type { AssetId, AssetKindName } from "../project/types";
import { closest } from "../scene/did-you-mean";
import {
  canonicalGrid,
  CHUNK_KEY_PATTERN,
  GRID_CHUNK,
  GRID_MAX_VALUE,
  GRID_ROW_PATTERN,
  gridProblems,
  type GridCells,
} from "../scene/grid";
import { derivesFrom, SHAPE_TYPES, ShapeTupleSchema, shapeTupleSchemaOf } from "../scene/shapes";
import type { Pt, ShapeTuple, ShapeType } from "../scene/types";
import { BEHAVIORS_FIELD } from "./behaviors";
import type { FieldEnv } from "./types";

/**
 * Field builders for entity type schemas. Every field carries a
 * `.describe()`, because the JSON Schema, `codes` and the inspector print it.
 */

/** Ids, scene names and game ids. `~` can never match, so a bulk reference is never a real id. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** An id, or `<instance>/<child>` at any depth: what a reference field may name. */
export const CHILD_REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}(?:\/[a-z0-9][a-z0-9-]{0,47}){0,8}$/;

const coord = (description: string) => z.number().describe(description).meta({ unit: "px" });

export const PtSchema = z
  .tuple([coord("x, px."), coord("y, px; y is down.")])
  .describe("A point [x, y] in integer world pixels; y is down.")
  .meta({ id: "Pt", unit: "px" });

export const PathSchema = z
  .strictObject({
    pts: z
      .array(PtSchema)
      .describe(
        "Waypoints in absolute world px. The entity's shape is centred on each point in turn. At least 2, no repeats.",
      )
      .meta({ title: "Waypoints" }),
    mode: z
      .enum(["ping_pong", "loop"])
      .describe(
        "ping_pong: travel to the last point, then back. loop: after the last point, travel back to the first along the closing segment.",
      )
      .meta({ title: "Mode" }),
    speed: z
      .number()
      .describe("Travel speed along the path, px per second; must be > 0.")
      .meta({ title: "Speed", unit: "px/s" }),
    pauseMs: z
      .number()
      .min(0)
      .optional()
      .describe("How long it waits at each waypoint, in milliseconds. Omitted means 0.")
      .meta({ title: "Pause", unit: "ms" }),
  })
  .describe("A waypoint path with linear segments.")
  .meta({ id: "Path", title: "Path", group: "motion" });

/** A point field, absolute world px. */
export function pointField(description: string) {
  return PtSchema.meta({ title: "Position", unit: "px", description });
}

/** A meta key of `schema`, looking through its optional, nullable, default and other wrappers. */
export function fieldMeta(schema: z.core.$ZodType, key: string): unknown {
  for (let s: z.core.$ZodType | undefined = schema; s; ) {
    const value = z.globalRegistry.get(s)?.[key];
    if (value !== undefined) return value;
    s = (s._zod.def as { innerType?: z.core.$ZodType }).innerType;
  }
  return undefined;
}

const VectorSchema = z
  .tuple([z.number().describe("dx, px."), z.number().describe("dy, px; y is down.")])
  .meta({ unit: "px" });

/** A direction or offset [dx, dy]: turned and mirrored with its entity, never translated. */
export function vectorField(description: string): z.ZodType<Pt> {
  return VectorSchema.describe(description).meta({ kind: "vector" });
}

/** An angle, clockwise (y down): turned and mirrored with its entity. */
export function angleField(description: string, unit: "deg") {
  return z.number().describe(description).meta({ kind: "angle", unit });
}

/** Whether the entity is mirrored along `axis`: toggled when its entity is flipped across that axis. */
export function mirrorField(axis: "x", description: string) {
  return z.boolean().describe(description).meta({ kind: "mirror", axis });
}

const GRID_META = "x-grid";

/** What a gridField's cells may hold: `values` names cells 1..n, `max` is the largest value. */
export type GridFieldInfo = { values: readonly string[]; max: number };

/**
 * Cells on the scene's grid, local to the entity's `at`. `values` names
 * cells 1..n for the schema and inspector; `max` defaults to
 * `values.length`, or 65535 without `values`. Parsing rewrites the value
 * canonically (`canonicalGrid`), so a hand-written row comes out as the
 * formatter writes it.
 */
export function gridField(
  description: string,
  opts: { values?: readonly string[]; max?: number } = {},
): z.ZodType<GridCells> {
  const values = opts.values ?? [];
  const max = opts.max ?? (values.length > 0 ? values.length : GRID_MAX_VALUE);
  if (!Number.isInteger(max) || max < 1 || max > GRID_MAX_VALUE)
    throw new RangeError(`gridField: max ${max} isn't an integer in [1, ${GRID_MAX_VALUE}]`);
  const named = values.map((v, i) => `${i + 1}: ${v}.`).join(" ");
  const info: GridFieldInfo = { values: [...values], max };
  return z
    .record(
      z.string().regex(CHUNK_KEY_PATTERN),
      z.array(z.string().regex(GRID_ROW_PATTERN)).max(GRID_CHUNK),
    )
    .superRefine((value, ctx) => {
      for (const p of gridProblems(value, max))
        ctx.addIssue({
          code: "custom",
          message: p.message,
          path: p.path,
          params: { sceneCode: "grid-invalid", got: p.got },
        });
    })
    .overwrite((value) => {
      try {
        return canonicalGrid(value) as Record<string, string[]>;
      } catch {
        return value;
      }
    })
    .describe(
      `${description} Cells in 32x32 chunks keyed "cx,cy", each chunk up to 32 run-length rows ("0*4,3*6,7"); 0 is empty${named ? `. ${named}` : "."}`,
    )
    .meta({
      title: "Cells",
      group: "geometry",
      kind: "grid",
      [GRID_META]: info,
    }) as unknown as z.ZodType<GridCells>;
}

/** The values and largest value a gridField takes, or null for any other schema. */
export function gridFieldInfo(schema: z.core.$ZodType): GridFieldInfo | null {
  const info = fieldMeta(schema, GRID_META);
  return info !== null && typeof info === "object" ? (info as GridFieldInfo) : null;
}

/** An asset id; parses as a string so a dangling id is `asset-missing`, not a parse failure. */
export const AssetIdSchema = z.string().regex(ID_PATTERN);

/** The largest `z` magnitude: z is an integer in [-Z_LIMIT, Z_LIMIT]. */
export const Z_LIMIT = 10_000;

const ASSET_KIND_META = "x-asset-kind";

/**
 * A reference to a project asset of one of `kinds`. Parsing takes any id;
 * the JSON Schema's enum of the project's live ids comes from `env`.
 */
export function assetField(
  env: FieldEnv,
  kinds: AssetKindName | readonly AssetKindName[],
  description: string,
): z.ZodType<AssetId> {
  const list = typeof kinds === "string" ? [kinds] : [...kinds];
  const ids = env.assets(list);
  return AssetIdSchema.describe(description).meta({
    title: "Asset",
    group: "assets",
    [ASSET_KIND_META]: list,
    ...(ids.length > 0 ? { enum: [...ids] } : {}),
  });
}

/** The kinds an assetField names, or null for any other schema. */
export function assetKindsOf(schema: z.core.$ZodType): readonly AssetKindName[] | null {
  const kinds = fieldMeta(schema, ASSET_KIND_META);
  return Array.isArray(kinds) ? (kinds as AssetKindName[]) : null;
}

const SHAPE_META = { title: "Shape", group: "geometry" } as const;

/** Every shape type except `chain`, which has no interior and so can't be a body. */
export const BODY_SHAPE_TYPES: readonly ShapeType[] = SHAPE_TYPES.filter((t) => t !== "chain");

const BodyShapeSchema = shapeTupleSchemaOf(BODY_SHAPE_TYPES, "BodyShape", "a body's");

/** A shape tuple field for a body: any shape type but `chain`. Every body field shares one schema, so one `$defs` entry. */
export function bodyShapeField(description: string): z.ZodType<ShapeTuple> {
  return BodyShapeSchema.meta({ ...SHAPE_META, description });
}

/** A shape tuple field, optionally limited to some shape types. `id` names its `$defs` entry, so use each id once. */
export function shapeField(
  description: string,
  only?: { types: readonly ShapeType[]; id: string; owner: string },
): z.ZodType<ShapeTuple> {
  const schema = only ? shapeTupleSchemaOf(only.types, only.id, only.owner) : ShapeTupleSchema;
  return schema.meta({ ...SHAPE_META, description });
}

function unknownMaterialMessage(got: unknown, known: readonly string[]): string {
  const name =
    typeof got === "string"
      ? `unknown material ${JSON.stringify(got)}`
      : `a material is a name, not ${JSON.stringify(got)}`;
  if (known.length === 0) return `${name}: this project and game define no materials`;
  const suggestion = typeof got === "string" ? closest(got, known) : undefined;
  return `${name}${suggestion ? `; did you mean "${suggestion}"?` : "."} Known: ${known.join(", ")}.`;
}

/** An optional material, one of the registry's; the description lists each with its own. */
export function materialField(env: FieldEnv, description = "Surface material.") {
  const [first, ...rest] = env.materials;
  const error = (iss: { input?: unknown }) => unknownMaterialMessage(iss.input, env.materials);
  const schema =
    first === undefined
      ? z.never({ error })
      : z.enum([first, ...rest] as [string, ...string[]], { error });
  const each = env.materials.map((m) => `${m}: ${env.materialDefs.get(m)?.description ?? ""}`);
  const text = each.length > 0 ? `${description} ${each.join(" ")}` : description;
  return schema.optional().describe(text).meta({ title: "Material", group: "surface" });
}

/**
 * A reference to another entity by id, or to an instance's child by its
 * resolved ref (`gate-2/door`, `room-1/door-1/panel`). The type's `refs`
 * say which types it may name.
 */
export function refField(description: string): z.ZodType<string> {
  return z.string().regex(CHILD_REF_PATTERN).describe(description).meta({ title: "Reference" });
}

const AttachSchema = z.string().regex(CHILD_REF_PATTERN);

/**
 * `attach`: the id of a path follower whose body this entity's collider
 * rides (an instance's child by its resolved ref, `gate-2/lift`), at its offset from the follower's first path point. Its shape
 * stays in world px, as placed with the follower at that point. A type
 * with this field gets the reference to `follower` without declaring it.
 */
export function attachField(description: string) {
  return AttachSchema.optional()
    .describe(description)
    .meta({ title: "Attached to", group: "motion" });
}

/** Whether a field is an `attachField`. */
export const isAttachField = (schema: z.core.$ZodType) => derivesFrom(schema, AttachSchema);

/** Free-form labels a game reads, e.g. `["spawn"]`. */
export function tagsField(description: string) {
  return z
    .array(z.string().regex(ID_PATTERN))
    .optional()
    .describe(description)
    .meta({ title: "Tags" });
}

/** Fields every entity has besides `type`. */
export const BASE_FIELDS = {
  id: z
    .string()
    .regex(ID_PATTERN)
    .describe(
      "Stable id, unique in the scene: lowercase letters, digits and '-', 1-48 characters, starting with a letter or digit. Ops and other entities refer to the entity by it.",
    )
    .meta({ title: "Id", group: "identity" }),
  name: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe("Display label for the editor's outliner. No runtime effect.")
    .meta({ title: "Name", group: "identity" }),
  layer: z
    .string()
    .regex(ID_PATTERN)
    .optional()
    .describe(
      "Scene layer, one of the game's layers; omitted means the type's default. The editor shows, hides and locks entities by layer, and the engine's own visuals draw on it; a type's shape visuals keep the draw layer their system chooses.",
    )
    .meta({ title: "Layer", group: "identity" }),
  group: z
    .string()
    .regex(ID_PATTERN)
    .optional()
    .describe(
      "The declared group (top-level `groups`) this belongs to. Its geometry is stored relative to the group's `at`, and members select and move together.",
    )
    .meta({ title: "Group", group: "identity" }),
  off: z
    .boolean()
    .optional()
    .describe(
      "When true the entity stays in the file but is not loaded, e.g. to A/B a change without deleting it.",
    )
    .meta({ title: "Disabled", group: "identity" }),
  z: z
    .number()
    .int()
    .min(-Z_LIMIT)
    .max(Z_LIMIT)
    .optional()
    .describe(
      `Draw order within the layer, an integer in [-${Z_LIMIT}, ${Z_LIMIT}]; higher draws on top, ties keep spawn order (on a y-sorted layer, z first, then y). Omitted means 0.`,
    )
    .meta({ title: "Z", group: "identity" }),
} as const;

/** Keys `BASE_FIELDS`, `type` and behavior blocks take; a type's own fields can't reuse them. */
export const RESERVED_FIELDS: readonly string[] = [
  "type",
  ...Object.keys(BASE_FIELDS),
  BEHAVIORS_FIELD,
];

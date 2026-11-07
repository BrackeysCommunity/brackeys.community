import { z } from "zod";

import { derivesFrom, SHAPE_TYPES, ShapeTupleSchema, shapeTupleSchemaOf } from "../scene/shapes";
import type { ShapeTuple, ShapeType } from "../scene/types";
import type { FieldEnv } from "./types";

/**
 * Field builders for entity type schemas. Every field carries a
 * `.describe()`, because the JSON Schema, `codes` and the inspector print it.
 */

/** Ids, scene names and game ids. `~` can never match, so a bulk reference is never a real id. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

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

/** An optional material, one of the registry's; the description lists each with its own. */
export function materialField(env: FieldEnv, description = "Surface material.") {
  const [first, ...rest] = env.materials;
  const schema =
    first === undefined ? z.never() : z.enum([first, ...rest] as [string, ...string[]]);
  const each = env.materials.map((m) => `${m}: ${env.materialDefs.get(m)?.description ?? ""}`);
  const text = each.length > 0 ? `${description} ${each.join(" ")}` : description;
  return schema.optional().describe(text).meta({ title: "Material", group: "surface" });
}

const AttachSchema = z.string().regex(ID_PATTERN);

/**
 * `attach`: the id of a path follower whose body this entity's collider
 * rides, at its offset from the follower's first path point. Its shape
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
    .enum(["terrain", "gameplay", "decor", "editor"])
    .optional()
    .describe(
      "Editor layer, for showing, hiding and locking groups of entities. No runtime effect.",
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
} as const;

/** Keys `BASE_FIELDS` and `type` take; a type's own fields can't reuse them. */
export const RESERVED_FIELDS: readonly string[] = ["type", ...Object.keys(BASE_FIELDS)];

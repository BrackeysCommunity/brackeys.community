import { z } from "zod";

import { closest } from "./did-you-mean";
import {
  BEHAVIORS,
  BULK_KEYS,
  OP_NAMES,
  SHAPE_BULK_KEYS,
  type OpBatch,
  type Ref,
  type SceneOp,
} from "./types";

export const OPS_SCHEMA_ID = "urn:jams-engine:ops:v1";

const SPOT_ANCHORS = ["center", "top", "bottom", "left", "right"] as const;

const int = (description: string) => z.number().int().describe(description);

const PtSchema = z
  .tuple([int("x in world pixels."), int("y in world pixels; y is down.")])
  .describe("A point [x, y] in integer world pixels. y is down, so a larger y is lower on screen.");

const BoundsSchema = z
  .tuple([int("minX"), int("minY"), int("maxX"), int("maxY")])
  .describe(
    "The scene's playable area as [minX, minY, maxX, maxY] in integer world pixels; y is down.",
  );

const RefSchema = z
  .string()
  .min(1)
  .describe(
    "An entity id such as `lift`, or a bulk reference `~<bulkKey>:<index>` such as `~solid:3` or `~solid:ice:0`. " +
      "Bulk references shift when an earlier entry is removed, so a batch that uses one must carry `base`. " +
      "All references in a batch resolve against the document the batch started from.",
  );

const IdSchema = z
  .string()
  .describe(
    "An entity id: lowercase letters, digits and hyphens, starting with a letter or digit, at most 48 characters.",
  );

const IndexSchema = z
  .number()
  .int()
  .min(0)
  .describe(
    "Insert at this position instead of appending. Used by inverse batches to restore an entry where it was.",
  );

const ShapeInputSchema = z
  .union([
    z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .describe(
        'A shape tuple: ["box", cx, cy, hw, hh, rotDeg?], ["circle", cx, cy, r], ["capsule", cx, cy, halfLen, r, rotDeg?], ' +
          '["poly", x1, y1, x2, y2, x3, y3, ...] (convex) or ["chain", x1, y1, ..., xn, yn] (static polyline). ' +
          "Box and capsule sizes are half-extents. Integer pixels, integer degrees, y down.",
      ),
    z
      .looseObject({ type: z.string().describe("box, circle, capsule, poly, chain or rect.") })
      .describe(
        'A shape object with named fields, or `{ type: "rect", left, top, right, bottom }` for a box given by its edges ' +
          "(width and height must be even so the half-extents are integers).",
      ),
  ])
  .describe(
    "A shape in any accepted form. It is checked when the op applies and stored as a tuple.",
  );

const EntityInputSchema = z
  .looseObject({
    b: z
      .enum(BEHAVIORS)
      .describe(
        "The entity's behavior: what it does at runtime. The remaining fields depend on it, as in the scene schema.",
      ),
    id: IdSchema.optional().describe(
      "Optional. Without one the id is generated as `<behavior>-<n>` with the lowest free n and returned in `created`. " +
        "Pass your own id to refer to the entity later in the same batch.",
    ),
  })
  .describe(
    "An entity as in the scene file, with `id` optional and `shape` accepting any shape form. " +
      "A mover's `shape` is local to its path point; every other position is absolute.",
  );

const AddOp = z
  .strictObject({
    op: z.literal("add"),
    entity: EntityInputSchema,
    index: IndexSchema.optional(),
  })
  .describe("Add one entity to `entities`.");

const AddBulkShapesOp = z
  .strictObject({
    op: z.literal("addBulk"),
    key: z
      .enum(SHAPE_BULK_KEYS)
      .describe("The bulk bucket: `solid`, `solid:<material>` or `cloud`."),
    shapes: z
      .array(ShapeInputSchema)
      .min(1)
      .describe("Shapes to append, in order. Absolute world pixels."),
    index: IndexSchema.optional(),
  })
  .describe("Add id-less shapes to a bulk bucket of simple static geometry.");

const AddBulkAnchorsOp = z
  .strictObject({
    op: z.literal("addBulk"),
    key: z.literal("anchor").describe("The bulk bucket of grapple anchor points."),
    points: z.array(PtSchema).min(1).describe("Anchor points to append, in order."),
    index: IndexSchema.optional(),
  })
  .describe("Add id-less grapple anchor points.");

const AddBulkOp = z.discriminatedUnion("key", [AddBulkShapesOp, AddBulkAnchorsOp], {
  error: (iss) =>
    iss.code === "invalid_union" && iss.note
      ? unknownValueMessage(
          "addBulk key",
          (iss.input as { key?: unknown } | undefined)?.key,
          BULK_KEYS,
        )
      : undefined,
});

const UpdateOp = z
  .strictObject({
    op: z.literal("update"),
    ref: RefSchema,
    set: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Field path to new value, e.g. `{ "path.speed": 140 }` or `{ "shape": ["box", 0, 0, 40, 6] }`. ' +
          "Paths are dot-separated, with numeric segments for array items (`path.pts.1`); missing objects on the way are created. " +
          "On a bulk reference only `shape` (or `at` for an anchor) can be set. `id` and `b` can't be set: use rename, or remove and add.",
      ),
    unset: z
      .array(z.string())
      .optional()
      .describe("Field paths to delete. An array item is spliced out."),
  })
  .describe("Change fields of one entity. The result is checked against its behavior's schema.");

const MoveOp = z
  .strictObject({
    op: z.literal("move"),
    refs: z.array(RefSchema).min(1).describe("What to move."),
    by: PtSchema.describe("The offset [dx, dy] in integer pixels; positive dy moves down."),
  })
  .describe(
    "Translate entities. A mover's path points move (its shape stays local); anchors, constructs and notes move `at`.",
  );

const PlaceOp = z
  .strictObject({
    op: z.literal("place"),
    ref: RefSchema,
    at: PtSchema.describe("Where the chosen spot of the shape should end up."),
    anchor: z
      .enum(SPOT_ANCHORS)
      .optional()
      .describe(
        "Which spot of the shape's bounding box lands on `at`: `center` (default), or the middle of the `top`, `bottom`, " +
          "`left` or `right` edge. `top` puts the top edge at y without knowing the half-height. Point entities ignore it.",
      ),
  })
  .describe("Move one entity so a spot of its bounding box lands on a point.");

const RemoveOp = z
  .strictObject({
    op: z.literal("remove"),
    refs: z.array(RefSchema).min(1).describe("What to remove."),
  })
  .describe("Remove entities or bulk entries.");

const RenameOp = z
  .strictObject({
    op: z.literal("rename"),
    from: IdSchema.describe("The current id."),
    to: IdSchema.describe("The new id; must be free."),
  })
  .describe("Change an entity's id and rewrite every reference to it.");

const PromoteOp = z
  .strictObject({
    op: z.literal("promote"),
    ref: RefSchema.describe("A bulk reference such as `~solid:3`."),
    id: IdSchema.describe("The id the new entity gets; must be free."),
  })
  .describe(
    "Turn a bulk entry into an entity with an id, keeping its behavior and material, so it can be referenced without `base`.",
  );

const DemoteOp = z
  .strictObject({
    op: z.literal("demote"),
    id: IdSchema.describe(
      "A solid, cloud or anchor entity with no fields beyond what a bulk entry holds.",
    ),
  })
  .describe("Turn an entity back into an id-less bulk entry, appended to its bucket.");

const SetSpawnOp = z
  .strictObject({
    op: z.literal("setSpawn"),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Which spawn to set (default 0). An index at or past the end appends a new spawn."),
    at: PtSchema.describe("The player's feet, in integer world pixels."),
  })
  .describe("Set or add a player spawn point.");

const RemoveSpawnOp = z
  .strictObject({
    op: z.literal("removeSpawn"),
    index: z.number().int().min(0).describe("The spawn to remove."),
  })
  .describe("Remove a player spawn point.");

const SetSceneOp = z
  .strictObject({
    op: z.literal("setScene"),
    set: z
      .strictObject({
        name: z.string().min(1).optional().describe("The scene's name."),
        bounds: BoundsSchema.optional(),
      })
      .describe("Scene-level fields to change."),
  })
  .describe("Change the scene's name or bounds.");

export const SceneOpSchema = z
  .discriminatedUnion(
    "op",
    [
      AddOp,
      AddBulkOp,
      UpdateOp,
      MoveOp,
      PlaceOp,
      RemoveOp,
      RenameOp,
      PromoteOp,
      DemoteOp,
      SetSpawnOp,
      RemoveSpawnOp,
      SetSceneOp,
    ],
    {
      error: (iss) =>
        iss.code === "invalid_union" && iss.note
          ? unknownValueMessage("op", (iss.input as { op?: unknown } | undefined)?.op, OP_NAMES)
          : undefined,
    },
  )
  .describe("One edit to a scene document.");

export const OpBatchSchema = z
  .strictObject({
    label: z
      .string()
      .optional()
      .describe('A short human label for history and logs, e.g. "Add 3 clouds".'),
    base: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional()
      .describe(
        "The sceneHash of the document these ops were written against. Required when any op uses a `~` bulk reference; " +
          "a mismatch fails with `stale-base`. Batches that use only ids apply without it.",
      ),
    actor: z
      .string()
      .optional()
      .describe('Who made the edit: "human", "agent", or an agent\'s name.'),
    ops: z.array(SceneOpSchema).describe("Applied in order, atomically: if one fails, none apply."),
  })
  .describe(
    "A batch of scene edits. Coordinates are integer world pixels with y down, rotations are integer degrees, " +
      "and sizes of boxes and capsules are half-extents.",
  );

function unknownValueMessage(what: string, got: unknown, known: readonly string[]): string {
  const expected = `Expected one of: ${known.join(", ")}.`;
  if (got === undefined) return `Missing ${what}. ${expected}`;
  const suggestion = typeof got === "string" ? closest(got, known) : undefined;
  return `Unknown ${what} ${JSON.stringify(got)}${suggestion ? `; did you mean "${suggestion}"?` : "."} ${expected}`;
}

export function opsJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(OpBatchSchema, { target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
  return { $schema, $id: OPS_SCHEMA_ID, ...rest };
}

/** Every reference an op names. */
export function opRefs(op: SceneOp): Ref[] {
  switch (op.op) {
    case "update":
    case "place":
    case "promote":
      return [op.ref];
    case "move":
    case "remove":
      return op.refs;
    default:
      return [];
  }
}

/** Whether a batch names a `~` bulk reference, and so needs `base`. */
export function usesBulkRefs(batch: OpBatch): boolean {
  return batch.ops.some((op) => opRefs(op).some((r) => r.startsWith("~")));
}

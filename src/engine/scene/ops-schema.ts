import { z } from "zod";

import type { Registry } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { closest } from "./did-you-mean";
import { toJsonSchema } from "./json-schema";
import { OVERRIDE_PATH } from "./schema";
import { OP_NAMES, type OpBatch, type Ref, type SceneOp } from "./types";

const SPOT_ANCHORS = ["center", "top", "bottom", "left", "right"] as const;

const int = (description: string) => z.number().int().describe(description);

const IntPtSchema = z
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

const PathsSchema = z.array(z.string());

const opName = <N extends (typeof OP_NAMES)[number]>(name: N) =>
  z.literal(name).describe(`The op: ${name}.`);

const UpdateOp = z
  .strictObject({
    op: opName("update"),
    ref: RefSchema,
    set: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Field path to new value, e.g. `{ "path.speed": 140 }` or `{ "shape": ["box", 0, 0, 40, 6] }`. ' +
          "Paths are dot-separated, with numeric segments for array items (`path.pts.1`); missing objects on the way are created. " +
          "On a bulk reference only its bulk field (`shape`, or `at` for a point bulk key) can be set. " +
          "`id` and `type` can't be set: use rename, or remove and add.",
      ),
    unset: PathsSchema.optional().describe("Field paths to delete. An array item is spliced out."),
  })
  .describe("Change fields of one entity. The result is checked against its type's schema.");

const MoveOp = z
  .strictObject({
    op: opName("move"),
    refs: z.array(RefSchema).min(1).describe("What to move."),
    by: IntPtSchema.describe("The offset [dx, dy] in integer pixels; positive dy moves down."),
  })
  .describe(
    "Translate entities. An entity with a `path` moves its path points (its shape stays local to them); " +
      "a point entity moves `at`; everything else moves its `shape`.",
  );

const PlaceOp = z
  .strictObject({
    op: opName("place"),
    ref: RefSchema,
    at: IntPtSchema.describe("Where the chosen spot of the shape should end up."),
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
    op: opName("remove"),
    refs: z.array(RefSchema).min(1).describe("What to remove."),
  })
  .describe("Remove entities or bulk entries.");

const RenameOp = z
  .strictObject({
    op: opName("rename"),
    from: IdSchema.describe("The current id."),
    to: IdSchema.describe("The new id; must be free."),
  })
  .describe("Change an entity's id and rewrite every reference to it.");

const PromoteOp = z
  .strictObject({
    op: opName("promote"),
    ref: RefSchema.describe("A bulk reference such as `~solid:3`."),
    id: IdSchema.describe("The id the new entity gets; must be free."),
  })
  .describe(
    "Turn a bulk entry into an entity with an id, keeping its type and material, so it can be referenced without `base`.",
  );

const DemoteOp = z
  .strictObject({
    op: opName("demote"),
    id: IdSchema.describe(
      "An entity of a type with a bulk form, with no fields beyond what a bulk entry holds.",
    ),
  })
  .describe("Turn an entity back into an id-less bulk entry, appended to its bulk array.");

const SetSceneOp = z
  .strictObject({
    op: opName("setScene"),
    set: z
      .strictObject({
        name: z.string().min(1).optional().describe("The scene's name."),
        bounds: BoundsSchema.optional(),
      })
      .describe("Scene-level fields to change."),
  })
  .describe("Change the scene's name or bounds.");

const OverridePathSchema = z
  .string()
  .regex(OVERRIDE_PATH)
  .describe(
    "An override key: a child's id in the prefab (or `~<bulkKey>:<index>` for a bulk child), a dot, then a field path, e.g. `door.path.speed`.",
  );

const ReorderOp = z
  .strictObject({
    op: opName("reorder"),
    refs: z
      .array(RefSchema)
      .min(1)
      .describe("Entities, or instances (not both), in the order they should end up."),
    index: z
      .number()
      .int()
      .min(0)
      .describe(
        "Where they go in their list (`entities` or `instances`), counted without them: 0 puts them first. Order is draw order within a layer.",
      ),
  })
  .describe("Move entities or instances to a new place in their list, keeping their order.");

const SetGroupOp = z
  .strictObject({
    op: opName("setGroup"),
    id: IdSchema.describe(
      "The group's id; a new id declares a group (at [0, 0] unless `at` says).",
    ),
    at: IntPtSchema.optional().describe(
      "The group's origin. Members store geometry relative to it, so changing it moves every member.",
    ),
    name: z
      .union([z.string().min(1).max(80), z.null()])
      .optional()
      .describe("Display label; null clears it."),
    remove: z
      .boolean()
      .optional()
      .describe("Delete the group's declaration; refused while an entity or instance is in it."),
  })
  .describe("Declare a group, move its origin, rename it, or delete it.");

const OverrideOp = z
  .strictObject({
    op: opName("override"),
    ref: IdSchema.describe("The instance."),
    set: z
      .record(OverridePathSchema, z.unknown())
      .describe(
        "Override key to value, in the prefab's own frame (before the instance's `at`): `{ \"door.path.speed\": 140 }`. Replaces any override of the same field or inside it.",
      ),
  })
  .describe("Set fields of one instance's children that differ from the prefab.");

const RevertOverrideOp = z
  .strictObject({
    op: opName("revertOverride"),
    ref: IdSchema.describe("The instance."),
    paths: z
      .array(OverridePathSchema)
      .optional()
      .describe("Override keys to drop, with any inside them; omitted drops every override."),
  })
  .describe("Put an instance's children back to the prefab's values.");

const ApplyToPrefabOp = z
  .strictObject({
    op: opName("applyToPrefab"),
    ref: IdSchema.describe("The instance whose overrides become the prefab's."),
    paths: z
      .array(OverridePathSchema)
      .optional()
      .describe("Which overrides to apply; omitted applies all of them."),
  })
  .describe(
    "Write an instance's overrides into its prefab, so every instance of it changes, and drop them from the instance.",
  );

const UnpackOp = z
  .strictObject({
    op: opName("unpack"),
    ref: IdSchema.describe("The instance."),
  })
  .describe(
    "Replace an instance with its children as plain entities and bulk entries where they stand. Ids that clash get a suffix.",
  );

const CreatePrefabOp = z
  .strictObject({
    op: opName("createPrefab"),
    refs: z
      .array(RefSchema)
      .min(1)
      .describe("Entities and bulk entries to move into the prefab; not instances."),
    id: IdSchema.describe("The new prefab's id; it becomes prefabs/<id>.json."),
    at: IntPtSchema.optional().describe(
      "The prefab's origin in world px; omitted, the top-left of the entries' box.",
    ),
    instance: IdSchema.optional().describe(
      "The id of the instance that replaces them; omitted, `<id>-<n>`.",
    ),
  })
  .describe(
    "Turn entries into a prefab: they leave the scene, the prefab holds them around the origin, and one instance puts them back where they were.",
  );

function unknownValueMessage(what: string, got: unknown, known: readonly string[]): string {
  const expected = `Expected one of: ${known.join(", ")}.`;
  if (got === undefined) return `Missing ${what}. ${expected}`;
  const suggestion = typeof got === "string" ? closest(got, known) : undefined;
  return `Unknown ${what} ${JSON.stringify(got)}${suggestion ? `; did you mean "${suggestion}"?` : "."} ${expected}`;
}

const unionError =
  (what: string, field: string, known: readonly string[]) =>
  (iss: { code: string; note?: string; input?: unknown }) =>
    iss.code === "invalid_union" && iss.note
      ? unknownValueMessage(
          what,
          (iss.input as Record<string, unknown> | undefined)?.[field],
          known,
        )
      : undefined;

const nonEmpty = (xs: readonly string[]): [string, ...string[]] | null =>
  xs.length > 0 ? (xs as [string, ...string[]]) : null;

function buildOpSchemas(registry: Registry) {
  const settingsKeys = Object.keys(registry.settings);

  const AddOp = z
    .strictObject({
      op: opName("add"),
      entity: z
        .looseObject({
          type: z
            .enum(registry.typeNames as [string, ...string[]], {
              error: (iss) => unknownValueMessage("type", iss.input, registry.typeNames),
            })
            .describe(
              "The entity's registered type. The remaining fields depend on it, as in the scene schema.",
            ),
          id: IdSchema.optional().describe(
            "Optional. Without one the id is generated as `<type>-<n>` with the lowest free n and returned in `created`. " +
              "Pass your own id to refer to the entity later in the same batch.",
          ),
        })
        .describe(
          "An entity as in the scene file, with `id` optional and `shape` accepting any shape form. " +
            "A type with a `path` has its `shape` local to the path point; every other position is absolute.",
        ),
      index: IndexSchema.optional(),
    })
    .describe("Add one entity to `entities`.");

  const shapeKeys = nonEmpty(registry.bulkKeys.filter((b) => b.form === "shape").map((b) => b.key));
  const pointKeys = nonEmpty(registry.bulkKeys.filter((b) => b.form === "point").map((b) => b.key));
  const addBulkOptions = [
    shapeKeys &&
      z
        .strictObject({
          op: opName("addBulk"),
          key: z.enum(shapeKeys).describe("A bulk key whose entries are shapes."),
          shapes: z
            .array(ShapeInputSchema)
            .min(1)
            .describe("Shapes to append, in order. Absolute world pixels."),
          index: IndexSchema.optional(),
        })
        .describe("Add id-less shapes to a bulk array."),
    pointKeys &&
      z
        .strictObject({
          op: opName("addBulk"),
          key: z.enum(pointKeys).describe("A bulk key whose entries are points."),
          points: z.array(IntPtSchema).min(1).describe("Points to append, in order."),
          index: IndexSchema.optional(),
        })
        .describe("Add id-less points to a bulk array."),
  ].filter((o) => o !== null);
  const AddBulkOp = z.discriminatedUnion(
    "key",
    addBulkOptions as [(typeof addBulkOptions)[number], ...(typeof addBulkOptions)[number][]],
    {
      error: unionError(
        "addBulk key",
        "key",
        registry.bulkKeys.map((b) => b.key),
      ),
    },
  );

  const SetSettingsOp = z
    .strictObject({
      op: opName("setSettings"),
      set: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          `Settings path to new value, e.g. \`{ "gravity": [0, 900] }\`. Dot-separated like update's \`set\`. Settings fields: ${settingsKeys.map((k) => `\`${k}\``).join(", ")}.`,
        ),
      unset: PathsSchema.optional().describe("Settings paths to delete, back to their defaults."),
    })
    .describe("Change the scene's settings. The result is checked against the settings schema.");

  const InstantiateOp = z
    .strictObject({
      op: opName("instantiate"),
      instance: z
        .looseObject({
          prefab: IdSchema.describe("The prefab to place."),
          id: IdSchema.optional().describe("Optional; without one it is `<prefab>-<n>`."),
          at: IntPtSchema.describe("Where the prefab's origin lands."),
        })
        .describe(
          "An instance as in the scene file: `prefab`, `at`, and optionally `id`, `overrides`, `name`, `layer`, `group`, `off`.",
        ),
      index: IndexSchema.optional(),
    })
    .describe("Place a prefab: add one instance to `instances`.");

  const PrefabBodySchema = z
    .looseObject({
      entities: z.array(z.looseObject({})).describe("Entities as in a scene, around the origin."),
      bulk: z
        .record(z.string(), z.array(z.unknown()))
        .optional()
        .describe("Bulk entries by bulk key, around the origin."),
      contract: z.unknown().optional().describe("The game's contract for the prefab."),
    })
    .describe("A prefab's content; checked against the prefab schema when the op applies.");

  const DefinePrefabOp = z
    .strictObject({
      op: opName("definePrefab"),
      id: IdSchema.describe("The prefab's id."),
      prefab: z
        .union([PrefabBodySchema, z.null()])
        .describe("The prefab's new content, or null to delete it."),
    })
    .describe("Set or delete a prefab in the scene's library; instances of it follow.");

  const op = z
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
        SetSceneOp,
        SetSettingsOp,
        ReorderOp,
        InstantiateOp,
        SetGroupOp,
        OverrideOp,
        RevertOverrideOp,
        ApplyToPrefabOp,
        UnpackOp,
        CreatePrefabOp,
        DefinePrefabOp,
      ],
      { error: unionError("op", "op", OP_NAMES) },
    )
    .describe("One edit to a scene document.");

  const batch = z
    .strictObject({
      label: z
        .string()
        .optional()
        .describe('A short human label for history and logs, e.g. "Add 3 ledges".'),
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
      ops: z.array(op).describe("Applied in order, atomically: if one fails, none apply."),
    })
    .describe(
      "A batch of scene edits. Coordinates are integer world pixels with y down, rotations are integer degrees, " +
        "and sizes of boxes and capsules are half-extents.",
    );

  return { op, batch };
}

export type OpSchemas = ReturnType<typeof buildOpSchemas>;

/** Pure in the registry, which never changes once built, so each one's schemas are built once. */
const built = new WeakMap<Registry, OpSchemas>();

function schemasFor(registry: Registry): OpSchemas {
  let schemas = built.get(registry);
  if (!schemas) {
    schemas = buildOpSchemas(registry);
    built.set(registry, schemas);
  }
  return schemas;
}

/** One op, with entity types and bulk keys from `registry`. */
export function sceneOpSchemaFor(registry: Registry): OpSchemas["op"] {
  return schemasFor(registry).op;
}

/** A batch of ops, with entity types and bulk keys from `registry`. */
export function opBatchSchemaFor(registry: Registry): OpSchemas["batch"] {
  return schemasFor(registry).batch;
}

/** `urn:jams-engine:ops:v1`, or `urn:jams-engine:ops:<game>:v1`, beside the registry's scene schema id. */
export function opsSchemaId(registry: Registry): string {
  return registry.schemaId.replace(/^urn:jams-engine:scene:/, "urn:jams-engine:ops:");
}

export function opsJsonSchema(registry: Registry): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(opBatchSchemaFor(registry));
  return {
    $schema,
    $id: opsSchemaId(registry),
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    ...rest,
  };
}

/** Every reference an op names. */
export function opRefs(op: SceneOp): Ref[] {
  switch (op.op) {
    case "update":
    case "place":
    case "promote":
    case "override":
    case "revertOverride":
    case "applyToPrefab":
    case "unpack":
      return [op.ref];
    case "move":
    case "remove":
    case "reorder":
    case "createPrefab":
      return op.refs;
    default:
      return [];
  }
}

/** Whether a batch names a `~` bulk reference, and so needs `base`. */
export function usesBulkRefs(batch: OpBatch): boolean {
  return batch.ops.some((op) => opRefs(op).some((r) => r.startsWith("~")));
}

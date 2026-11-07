import { z } from "zod";

import { SHAPE_TYPES, ShapeTupleSchema, shapeTupleSchemaOf } from "./shapes";
import {
  BEHAVIORS,
  CONSTRUCT_TYPES,
  LAYERS,
  MATERIALS,
  SENSOR_KINDS,
  type Behavior,
  type EntityDef,
  type SceneDefinition,
  type ShapeTuple,
} from "./types";

/** Ids and scene names. `~` can never match, so a bulk reference is never a real id. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

const BoxShapeSchema = shapeTupleSchemaOf(["box"], "BoxShape", "a cloud");
const BodyShapeSchema = shapeTupleSchemaOf(
  SHAPE_TYPES.filter((t) => t !== "chain"),
  "BodyShape",
  "this behavior's",
);

const coord = (description: string) => z.number().describe(description).meta({ unit: "px" });

export const PtSchema = z
  .tuple([coord("x, px."), coord("y, px; y is down.")])
  .describe("A point [x, y] in integer world pixels; y is down.")
  .meta({ id: "Pt", unit: "px" });

const MaterialSchema = z
  .enum(MATERIALS)
  .describe(
    "Surface material. ice: low friction, the player slides. chocolate: slows movement. trampoline: bounces the player up.",
  );

const PathSchema = z
  .strictObject({
    pts: z
      .array(PtSchema)
      .describe(
        "Waypoints in absolute world px. The mover's shape is centred on each point in turn. At least 2, no repeats.",
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
      .describe("How long the mover waits at each waypoint, in milliseconds. Omitted means 0.")
      .meta({ title: "Pause", unit: "ms" }),
  })
  .describe("A waypoint path with linear segments.")
  .meta({ id: "Path" });

const base = {
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
    .enum(LAYERS)
    .optional()
    .describe(
      "Editor layer, for showing, hiding and locking groups of entities. No runtime effect.",
    )
    .meta({ title: "Layer", group: "identity" }),
  group: z
    .string()
    .regex(ID_PATTERN)
    .optional()
    .describe("Editor group name; entities sharing it select and move together. No runtime effect.")
    .meta({ title: "Group", group: "identity" }),
  off: z
    .boolean()
    .optional()
    .describe(
      "When true the entity stays in the file but is not loaded, e.g. to A/B a jump without deleting it.",
    )
    .meta({ title: "Disabled", group: "identity" }),
};

const absoluteShape = "Absolute world px; y is down.";

const SolidSchema = z
  .strictObject({
    ...base,
    b: z
      .literal("solid")
      .describe("Static ground: the player stands on it and collides from every side."),
    shape: ShapeTupleSchema.describe(
      `Collider shape. ${absoluteShape} Any tag, including chain for terrain outlines.`,
    ),
    material: MaterialSchema.optional().meta({ title: "Material", group: "surface" }),
  })
  .describe("solid: static ground, walls and platforms.");

const CloudSchema = z
  .strictObject({
    ...base,
    b: z
      .literal("cloud")
      .describe("One-way platform: the player jumps up through it and lands on top."),
    shape: BoxShapeSchema.describe(`Collider shape, box only. ${absoluteShape}`),
  })
  .describe("cloud: a one-way platform the player passes through from below.");

const MoverSchema = z
  .strictObject({
    ...base,
    b: z
      .literal("mover")
      .describe("Kinematic moving platform that follows `path` and carries the player."),
    shape: BodyShapeSchema.describe(
      'Collider shape LOCAL to the current path point, usually centred on 0, 0 (e.g. ["box", 0, 0, 40, 6]). Not chain.',
    ),
    path: PathSchema,
    material: MaterialSchema.optional().meta({ title: "Material", group: "surface" }),
  })
  .describe("mover: a moving platform.");

const AnchorSchema = z
  .strictObject({
    ...base,
    b: z.literal("anchor").describe("Grapple anchor: a point the player's grapple can attach to."),
    at: PtSchema.describe("Anchor position, absolute world px; y is down."),
  })
  .describe(
    "anchor: a grapple point. Plain anchors can also go in the top-level `anchor` bulk array.",
  );

const SensorSchema = z
  .strictObject({
    ...base,
    b: z
      .literal("sensor")
      .describe(
        "Trigger volume with no collision response; fires an event when the player overlaps it.",
      ),
    kind: z
      .enum(SENSOR_KINDS)
      .describe(
        "goal: collecting it wins the round (the cheese). exit: the hole a player enters after the goal. hazard: kills the player (lava).",
      )
      .meta({ title: "Kind" }),
    shape: ShapeTupleSchema.describe(`Trigger shape. ${absoluteShape}`),
  })
  .describe("sensor: goal, exit or hazard trigger.");

const PropSchema = z
  .strictObject({
    ...base,
    b: z
      .literal("prop")
      .describe(
        "Dynamic physics object the player can push and stand on; collides with ground and other props.",
      ),
    shape: BodyShapeSchema.describe(`Starting collider shape. ${absoluteShape} Not chain.`),
    density: z
      .number()
      .positive()
      .describe("Density, mass per px²; heavier props are harder to push.")
      .meta({ title: "Density" }),
    restitution: z
      .number()
      .min(0)
      .describe("Bounciness: 0 doesn't bounce, 1 keeps all its speed.")
      .meta({ title: "Restitution" }),
    friction: z
      .number()
      .min(0)
      .optional()
      .describe("Surface friction; omitted uses the physics default.")
      .meta({ title: "Friction" }),
  })
  .describe("prop: a dynamic physics object.");

const ConstructSchema = z
  .strictObject({
    ...base,
    b: z
      .literal("construct")
      .describe("A pre-placed Shaper construct, built at load time with its type's default size."),
    type: z
      .enum(CONSTRUCT_TYPES)
      .describe(
        "Which Shaper construct. Pre-placed ones ignore the Shaper's per-round limit and cooldown.",
      )
      .meta({ title: "Type" }),
    at: PtSchema.describe("Construct centre, absolute world px; y is down."),
    rot: z
      .number()
      .int()
      .optional()
      .describe(
        "Rotation in integer degrees, clockwise on screen. Omitted means 0. Wind zones ignore rotation today.",
      )
      .meta({ title: "Rotation", unit: "deg" }),
  })
  .describe("construct: a Shaper construct placed in the level.");

const NoteSchema = z
  .strictObject({
    ...base,
    b: z
      .literal("note")
      .describe("Editor note: text pinned to a point. Never loaded into the game."),
    at: PtSchema.describe("Where the note shows, absolute world px."),
    text: z
      .string()
      .describe("The note, for whoever edits the scene next.")
      .meta({ title: "Text" }),
  })
  .describe("note: a remark for the next editor, human or agent.");

const ENTITY_SCHEMAS = {
  solid: SolidSchema,
  cloud: CloudSchema,
  mover: MoverSchema,
  anchor: AnchorSchema,
  sensor: SensorSchema,
  prop: PropSchema,
  construct: ConstructSchema,
  note: NoteSchema,
} as const satisfies Record<Behavior, z.ZodObject>;

export type EntitySchema = (typeof ENTITY_SCHEMAS)[Behavior];

export function entitySchemaFor<B extends Behavior>(b: B): (typeof ENTITY_SCHEMAS)[B] {
  return ENTITY_SCHEMAS[b];
}

export const EntityDefSchema = z
  .discriminatedUnion(
    "b",
    BEHAVIORS.map((b) => ENTITY_SCHEMAS[b]) as unknown as [typeof SolidSchema, ...EntitySchema[]],
  )
  .describe("An entity with a stable id. `b` picks the behavior and which fields apply.")
  .meta({ id: "Entity" });

const bulkShapes = (description: string, shape: z.ZodType<ShapeTuple> = ShapeTupleSchema) =>
  z
    .array(shape)
    .optional()
    .describe(`${description} Entries have no id; ops refer to them as ~<key>:<index>.`);

export const SceneV1 = z
  .strictObject({
    $schema: z
      .string()
      .optional()
      .describe("Path or URI of this file's JSON Schema, for editors. Ignored by the engine."),
    v: z
      .literal(1)
      .describe(
        "Scene format version. Files are migrated up on load and always saved at the current version.",
      ),
    name: z
      .string()
      .regex(ID_PATTERN)
      .describe("Scene name, same rules as an id; matches the file name without .json.")
      .meta({ title: "Name" }),
    bounds: z
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
        "World rectangle [minX, minY, maxX, maxY] in px; y is down. Limits the camera and where the Shaper can build.",
      )
      .meta({ title: "Bounds", unit: "px" }),
    spawn: z
      .array(PtSchema)
      .describe(
        "Player spawn points: each is the player's FEET, so put it on a floor's top edge. One per player; spawns 60px apart or more.",
      )
      .meta({ title: "Spawns" }),
    solid: bulkShapes("Static ground shapes, absolute px."),
    "solid:ice": bulkShapes("Static ice shapes: low friction, the player slides."),
    "solid:chocolate": bulkShapes("Static chocolate shapes: slow the player."),
    "solid:trampoline": bulkShapes("Static trampoline shapes: bounce the player up."),
    cloud: bulkShapes("One-way cloud platforms, box only, absolute px.", BoxShapeSchema),
    anchor: z
      .array(PtSchema)
      .optional()
      .describe(
        "Grapple anchor points, absolute px. Entries have no id; ops refer to them as ~anchor:<index>.",
      ),
    entities: z
      .array(EntityDefSchema)
      .optional()
      .describe("Entities with stable ids: anything that moves, has parameters, or is referenced."),
  })
  .describe(
    "A jams engine scene. Units are integer pixels with y pointing down. Simple static geometry lives in the bulk arrays; everything else is an entity.",
  );

/** Keys a scene document may have at the top level, in canonical order. */
export const SCENE_KEYS = Object.keys(SceneV1.shape) as readonly (keyof SceneDefinition)[];

type Assignable<A, B> = [A] extends [B] ? true : false;
const sceneTypeMatches: Assignable<z.infer<typeof SceneV1>, SceneDefinition> = true;
const entityTypeMatches: Assignable<z.infer<typeof EntityDefSchema>, EntityDef> = true;
void sceneTypeMatches;
void entityTypeMatches;

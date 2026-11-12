import { z } from "zod";

import {
  attachField,
  bodyShapeField,
  isAttachField,
  PathSchema,
  materialField,
  pointField,
  polygonField,
  shapeField,
  sideField,
  SIDES,
  tagsField,
} from "./fields";
import type { EntityTypeDef, FieldEnv, PrimitiveType, RegisteredType, Side } from "./types";

export { DEFAULT_GRAVITY } from "./defaults";

const absolute = "Absolute world metres; y is down.";

const asSide = (value: unknown): Side | null =>
  typeof value === "string" && (SIDES as readonly string[]).includes(value)
    ? (value as Side)
    : null;

/**
 * The side a one-way solid lands actors on, as the solid system judges it:
 * the entity's own `oneWay` when it names a side, else its type's
 * (`EntityTypeDef.oneWay`) when that names one, else "up" when either is
 * `true`. An entity's `true` or `false` doesn't override a type-wide side.
 * Null when neither makes it one-way.
 */
export function oneWaySideOf(own: unknown, typeWide: unknown): Side | null {
  const side = asSide(own) ?? asSide(typeWide);
  if (side) return side;
  return own === true || typeWide === true ? "up" : null;
}

/**
 * The engine's own entity types, as schema. Their systems are the runtime's
 * (`runtime/primitives.ts`), so this module stays loadable on a server.
 */
export const PRIMITIVES = {
  solid: {
    type: "solid",
    description:
      "Static ground, walls and platforms: collides from every side, or from above only.",
    physics: "optional",
    fields: (env) => ({
      shape: shapeField(`Collider shape. ${absolute} Any tag, including chain for outlines.`),
      material: materialField(env),
      oneWay: sideField(
        'The one side actors collide with: they pass through from every other side and land on this one. `true` is "up": they pass up through it and land on top.',
      )
        .optional()
        .meta({ title: "One-way", group: "surface" }),
      attach: attachField(
        "A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point.",
      ),
    }),
    bulk: {
      form: "shape",
      materials: true,
      description: "Static ground shapes, absolute metres; `solid:<material>` for a material.",
    },
    style: { fill: 0x445566, stroke: 0x8899aa, alpha: 0.8 },
    ascii: "#",
  },
  sensor: {
    type: "sensor",
    description:
      "Trigger volume with no collision response; raises sensor:enter and sensor:exit when something overlaps it.",
    physics: "optional",
    fields: {
      shape: shapeField(`Trigger shape. ${absolute}`),
      tags: tagsField("Labels a game reads off the sensor's events."),
      attach: attachField(
        "A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point.",
      ),
    },
    style: { fill: 0x44cc88, stroke: 0x44cc88, alpha: 0.3 },
    ascii: "s",
  },
  marker: {
    type: "marker",
    description: "A named point with tags; what it means is up to the game.",
    physics: "optional",
    fields: {
      at: pointField(`Marker position. ${absolute}`),
      tags: tagsField("Labels a game reads, e.g. spawn or checkpoint."),
    },
    style: { stroke: 0xffcc44 },
    ascii: "+",
  },
  prop: {
    type: "prop",
    description: "Dynamic physics object that can be pushed and stood on.",
    physics: "required",
    fields: (env) => ({
      shape: bodyShapeField(`Starting collider shape. ${absolute} Not chain.`),
      density: z
        .number()
        .positive()
        .describe("Density in kg/m²; heavier props are harder to push.")
        .meta({ title: "Density", group: "body" }),
      restitution: z
        .number()
        .min(0)
        .describe("Bounciness: 0 doesn't bounce, 1 keeps all its speed.")
        .meta({ title: "Restitution", group: "body" }),
      friction: z
        .number()
        .min(0)
        .optional()
        .describe("Surface friction; omitted uses the material's, else the physics default.")
        .meta({ title: "Friction", group: "body", placeholder: "from material" }),
      material: materialField(env),
      gravityScale: z
        .number()
        .optional()
        .describe("Multiplies the world's gravity on this body: 0 floats, -1 falls up; default 1.")
        .meta({ title: "Gravity scale", group: "body", default: 1 }),
      linearDamping: z
        .number()
        .min(0)
        .optional()
        .describe("Slows the body's motion over time; default 0.")
        .meta({ title: "Linear damping", group: "body", default: 0 }),
      angularDamping: z
        .number()
        .min(0)
        .optional()
        .describe("Slows the body's spin over time; default 0.")
        .meta({ title: "Angular damping", group: "body", default: 0 }),
      fixedRotation: z
        .boolean()
        .optional()
        .describe("When true, the body never turns.")
        .meta({ title: "Fixed rotation", group: "body", default: false }),
      ccd: z
        .boolean()
        .optional()
        .describe(
          "Continuous collision detection: when true, a fast body can't pass through thin colliders between steps.",
        )
        .meta({ title: "CCD", group: "body", default: false }),
    }),
    style: { fill: 0xaa7744, stroke: 0xddaa77, alpha: 0.9 },
    ascii: "p",
  },
  follower: {
    type: "follower",
    description: "Kinematic body that follows a waypoint path.",
    physics: "optional",
    fields: (env) => ({
      shape: bodyShapeField(
        'Collider shape LOCAL to the current path point, usually centred on 0, 0 (e.g. ["box", 0, 0, 0.4, 0.06]). Not chain.',
      ),
      path: PathSchema,
      material: materialField(env),
    }),
    style: { fill: 0x6677aa, stroke: 0xffffff, alpha: 0.8 },
    ascii: "F",
  },
  decor: {
    type: "decor",
    description: "A picture with no body: drawn by its sprite, never collides.",
    physics: "optional",
    fields: {
      at: pointField(`Where the sprite's pose is. ${absolute}`),
    },
    behaviors: { required: { sprite: {} } },
    style: { stroke: 0xcc99ff, alpha: 0.6 },
    ascii: "d",
  },
  nav: {
    type: "nav",
    description: "A walkable area, or a hole in one, for navigation without physics or a grid.",
    physics: "optional",
    fields: {
      shape: polygonField(`A simple polygon, concave allowed. ${absolute}`),
      mode: z
        .enum(["walk", "block"])
        .optional()
        .describe("walk (default) or a hole cut out of the walk area it lies in.")
        .meta({ title: "Mode" }),
      tags: tagsField("Labels a game reads, e.g. a room name."),
    },
    style: { stroke: 0x55aaff, alpha: 0.25 },
    ascii: "n",
  },
  note: {
    type: "note",
    description: "Editor note: text pinned to a point. Never loaded into the game.",
    loads: false,
    fields: {
      at: pointField("Where the note shows, absolute world metres."),
      text: z
        .string()
        .describe("The note, for whoever edits the scene next.")
        .meta({ title: "Text" }),
    },
  },
} satisfies Record<PrimitiveType, EntityTypeDef>;

/**
 * Whether entities of `type` can load in a scene without physics: the
 * type's own `physics`, else its base primitive's, else "optional".
 */
export function typePhysics(type: EntityTypeDef): "required" | "optional" {
  return type.physics ?? (type.base ? PRIMITIVES[type.base].physics : undefined) ?? "optional";
}

/** One reason an entity can't load without physics: its type needs it, or `field` rides another entity. */
export type PhysicsNeed = { field?: string };

/**
 * Why an entity of `type` with these fields can't load in a scene without
 * physics, type first then each set attach field; empty when it can (or
 * when the type doesn't load at all).
 */
export function physicsNeeds(
  type: RegisteredType,
  fields: Readonly<Record<string, unknown>>,
): PhysicsNeed[] {
  if (type.loads === false) return [];
  const out: PhysicsNeed[] = typePhysics(type) === "required" ? [{}] : [];
  for (const [field, schema] of Object.entries(type.shape)) {
    if (fields[field] !== undefined && isAttachField(schema)) out.push({ field });
  }
  return out;
}

type ResolvedFields<D> = D extends { fields: infer F }
  ? F extends (env: FieldEnv) => infer R
    ? R
    : F
  : never;

/** A type's fields, calling `fields(env)` when they depend on the registry. */
export function resolveFields(def: EntityTypeDef, env: FieldEnv): z.ZodRawShape {
  return typeof def.fields === "function" ? def.fields(env) : def.fields;
}

/**
 * A primitive's fields for `env`, for a game type based on it (or wrapping
 * its system) to spread and extend rather than redeclare.
 */
export function primitiveFields<P extends PrimitiveType>(
  name: P,
  env: FieldEnv,
): ResolvedFields<(typeof PRIMITIVES)[P]> {
  return resolveFields(PRIMITIVES[name], env) as ResolvedFields<(typeof PRIMITIVES)[P]>;
}

/** The fields a type based on each primitive must have. */
export const BASE_REQUIRED_FIELDS: Record<Exclude<PrimitiveType, "note">, readonly string[]> = {
  solid: ["shape"],
  sensor: ["shape"],
  marker: ["at"],
  prop: ["shape", "density", "restitution"],
  follower: ["shape", "path"],
  decor: ["at"],
  nav: ["shape"],
};

function metres2(description: string, [a, b]: [string, string] = ["x", "y"]) {
  return z
    .tuple([
      z.number().describe(`${a}, m.`).meta({ unit: "m" }),
      z.number().describe(`${b}, m.`).meta({ unit: "m" }),
    ])
    .describe(description)
    .meta({ unit: "m" });
}

const WHOLE_PX = "each a whole number of px at the game's px per metre";

/** The engine's settings fields; a game's sit beside them. */
export const ENGINE_SETTINGS = {
  gravity: z
    .tuple([
      z.number().describe("x, m/s²; positive pulls right.").meta({ unit: "m/s²" }),
      z.number().describe("y, m/s²; positive pulls down.").meta({ unit: "m/s²" }),
    ])
    .optional()
    .describe(
      "World gravity [x, y] in m/s²; y is down. Omitted: the project's, else the game's default.",
    )
    .meta({ title: "Gravity", unit: "m/s²" }),
  physics: z
    .enum(["rapier", "none"])
    .optional()
    .describe(
      'The physics world: "rapier" simulates bodies, "none" runs without one. Omitted resolves through the project and game defaults to "rapier".',
    )
    .meta({ title: "Physics" }),
  grid: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("square").describe("Square (or rectangular) cells."),
        cell: metres2(`Cell size [w, h], m; positive, ${WHOLE_PX}.`, ["w", "h"]),
        origin: metres2(
          `Where cell 0, 0 starts, world m; ${WHOLE_PX}. Omitted means 0, 0.`,
        ).optional(),
      }),
      z.strictObject({
        kind: z.literal("hex").describe("Hexagonal cells, parameterized like Tiled's."),
        cell: metres2(
          `The hex's bounding box [w, h], m (Tiled's tilewidth, tileheight, over px per metre); positive, ${WHOLE_PX}.`,
          ["w", "h"],
        ),
        side: z
          .number()
          .describe(
            "The length of the flat sides, m (Tiled's hexsidelength over px per metre): from 0 to the cell's size on the stagger axis, a whole number of px at the game's px per metre.",
          )
          .meta({ unit: "m" }),
        stagger: z.enum(["x", "y"]).describe("Which axis is staggered (Tiled's staggeraxis)."),
        index: z
          .enum(["odd", "even"])
          .describe("Whether odd or even rows (or columns) are shifted (Tiled's staggerindex)."),
        origin: metres2(
          `Where cell 0, 0 starts, world m; ${WHOLE_PX}. Omitted means 0, 0.`,
        ).optional(),
      }),
    ])
    .optional()
    .describe(
      "The scene's one cell grid, square or hex; the hex parameters match Tiled's. Omitted: the game's world grid, else none.",
    )
    .meta({ title: "Grid" }),
  view: z
    .strictObject({
      projection: z.literal("orthogonal").describe("The only projection there is so far."),
    })
    .optional()
    .describe("How the scene is projected to the screen; reserved, only orthogonal exists.")
    .meta({ title: "View" }),
} satisfies z.ZodRawShape;

/** The keys `ENGINE_SETTINGS` holds; a game's settings may not redefine them. */
export const ENGINE_SETTING_KEYS = Object.keys(
  ENGINE_SETTINGS,
) as readonly (keyof typeof ENGINE_SETTINGS)[];

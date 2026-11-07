import { z } from "zod";

import {
  attachField,
  bodyShapeField,
  PathSchema,
  materialField,
  pointField,
  shapeField,
  tagsField,
} from "./fields";
import type { EntityTypeDef, FieldEnv, PrimitiveType } from "./types";

const absolute = "Absolute world px; y is down.";

/**
 * The engine's own entity types, as schema. Their systems are the runtime's
 * (`runtime/primitives.ts`), so this module stays loadable on a server.
 */
export const PRIMITIVES = {
  solid: {
    type: "solid",
    description:
      "Static ground, walls and platforms: collides from every side, or from above only.",
    fields: (env) => ({
      shape: shapeField(`Collider shape. ${absolute} Any tag, including chain for outlines.`),
      material: materialField(env),
      oneWay: z
        .boolean()
        .optional()
        .describe("When true, actors pass up through it and land on top.")
        .meta({ title: "One-way", group: "surface" }),
      attach: attachField(
        "A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point.",
      ),
    }),
    bulk: {
      form: "shape",
      materials: true,
      description: "Static ground shapes, absolute px; `solid:<material>` for a material.",
    },
    style: { fill: 0x445566, stroke: 0x8899aa, alpha: 0.8 },
    ascii: "#",
  },
  sensor: {
    type: "sensor",
    description:
      "Trigger volume with no collision response; raises sensor:enter and sensor:exit when something overlaps it.",
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
    fields: (env) => ({
      shape: bodyShapeField(`Starting collider shape. ${absolute} Not chain.`),
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
        .describe("Surface friction; omitted uses the material's, else the physics default.")
        .meta({ title: "Friction" }),
      material: materialField(env),
    }),
    style: { fill: 0xaa7744, stroke: 0xddaa77, alpha: 0.9 },
    ascii: "p",
  },
  follower: {
    type: "follower",
    description: "Kinematic body that follows a waypoint path.",
    fields: (env) => ({
      shape: bodyShapeField(
        'Collider shape LOCAL to the current path point, usually centred on 0, 0 (e.g. ["box", 0, 0, 40, 6]). Not chain.',
      ),
      path: PathSchema,
      material: materialField(env),
    }),
    style: { fill: 0x6677aa, stroke: 0xffffff, alpha: 0.8 },
    ascii: "F",
  },
  note: {
    type: "note",
    description: "Editor note: text pinned to a point. Never loaded into the game.",
    loads: false,
    fields: {
      at: pointField("Where the note shows, absolute world px."),
      text: z
        .string()
        .describe("The note, for whoever edits the scene next.")
        .meta({ title: "Text" }),
    },
  },
} satisfies Record<PrimitiveType, EntityTypeDef>;

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
};

/** The engine's settings fields; a game's sit beside them. */
export const ENGINE_SETTINGS = {
  gravity: z
    .tuple([
      z.number().describe("x, px/s²; positive pulls right."),
      z.number().describe("y, px/s²; positive pulls down."),
    ])
    .optional()
    .describe("World gravity [x, y] in px/s²; y is down. Omitted means [0, 1200].")
    .meta({ title: "Gravity", unit: "px/s²" }),
} satisfies z.ZodRawShape;

export const DEFAULT_GRAVITY: [number, number] = [0, 1200];

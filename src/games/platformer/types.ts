import {
  defineEntityType,
  pointField,
  primitiveFields,
  shapeField,
  type EntityOf,
  type EntityTypeDef,
  type FieldEnv,
} from "@jams/engine/game";
import { z } from "zod";

import { createGrappleAnchorSystem, GRAPPLE_ANCHOR_COLOR } from "./entities/grapple-anchor";
import { PLAYER_TYPE, PLAYER_WIDTH } from "./entities/player";
import { CONSTRUCT_TYPES, createConstructSystem } from "./entities/shaper-constructs";
import { SURFACES } from "./surfaces";
import { CLOUD_LOOK, createCloudSystem } from "./systems/cloud";
import { createMoverSystem } from "./systems/mover";
import { createPlayerSystem } from "./systems/player";
import { TYPE } from "./type-names";

type EntityOfFields<F extends z.ZodRawShape> = EntityOf<EntityTypeDef<F>>;

const absolute = "Absolute world metres; y is down.";

// ─── Fields ──────────────────────────────────────────────

const cloudFields = {
  shape: shapeField(`Collider shape, box only. ${absolute}`, {
    types: ["box"],
    id: "BoxShape",
    owner: "a cloud's",
  }),
};

const moverFields = (env: FieldEnv) => primitiveFields("follower", env);

const anchorFields = { at: pointField(`Anchor position. ${absolute}`) };

const sensorFields = (env: FieldEnv) => primitiveFields("sensor", env);

const constructFields = {
  construct: z
    .enum(CONSTRUCT_TYPES)
    .describe(
      "Which Shaper construct. Pre-placed ones ignore the Shaper's per-round limit and cooldown.",
    )
    .meta({ title: "Construct" }),
  at: pointField(`Construct centre. ${absolute}`),
  rot: z
    .number()
    .int()
    .optional()
    .describe(
      "Rotation in integer degrees, clockwise on screen. Omitted means 0. Wind zones ignore rotation today.",
    )
    .meta({ title: "Rotation", unit: "deg" }),
};

const spawnFields = (env: FieldEnv) => ({
  ...primitiveFields("marker", env),
  at: pointField(
    `The player's FEET, so put it on a floor's top edge. One per player; spawns ${PLAYER_WIDTH} m apart or more.`,
  ),
});

const playerFields = { at: pointField(`The player's feet. ${absolute}`) };

export type CloudEntity = EntityOfFields<typeof cloudFields>;
export type MoverEntity = EntityOfFields<ReturnType<typeof moverFields>>;
export type AnchorEntity = EntityOfFields<typeof anchorFields>;
export type ConstructEntity = EntityOfFields<typeof constructFields>;
export type SpawnEntity = EntityOfFields<ReturnType<typeof spawnFields>>;
export type PlayerTypeEntity = EntityOfFields<typeof playerFields>;

// ─── Types ───────────────────────────────────────────────

export const PLATFORMER_TYPES: readonly EntityTypeDef[] = [
  defineEntityType({
    type: TYPE.cloud,
    description: "One-way platform: the player jumps up through it and lands on top.",
    fields: cloudFields,
    system: createCloudSystem,
    bulk: { form: "shape", description: "One-way cloud platforms, box only, absolute metres." },
    style: { fill: CLOUD_LOOK.color, stroke: CLOUD_LOOK.color, alpha: CLOUD_LOOK.alpha },
    ascii: "=",
  }),
  defineEntityType({
    type: TYPE.mover,
    description: "Kinematic moving platform that follows `path` and carries the player.",
    fields: moverFields,
    system: createMoverSystem,
    style: {
      fill: SURFACES.normal.color,
      stroke: 0xffffff,
      alpha: 0.8,
      strokeAlpha: 0.4,
      strokeWidth: 2,
    },
    ascii: "M",
  }),
  defineEntityType({
    type: TYPE.goal,
    description: "The cheese: collecting it wins the round.",
    fields: sensorFields,
    base: "sensor",
    ascii: "G",
  }),
  defineEntityType({
    type: TYPE.exit,
    description: "The hole a player enters after the goal.",
    fields: sensorFields,
    base: "sensor",
    ascii: "E",
  }),
  defineEntityType({
    type: TYPE.hazard,
    description: "Lava: touching it kills the player.",
    fields: sensorFields,
    base: "sensor",
    style: { fill: 0xff2222, stroke: 0xff2222 },
    ascii: "x",
  }),
  defineEntityType({
    type: TYPE.anchor,
    description: "Grapple anchor: a point the player's grapple can attach to.",
    fields: anchorFields,
    system: createGrappleAnchorSystem,
    bulk: {
      form: "point",
      description: "Grapple anchor points, absolute metres; ops refer to them as ~anchor:<index>.",
    },
    style: { stroke: GRAPPLE_ANCHOR_COLOR },
    ascii: "o",
  }),
  defineEntityType({
    type: TYPE.construct,
    description: "A pre-placed Shaper construct, built at load time with its type's default size.",
    fields: constructFields,
    system: createConstructSystem,
    physics: "required",
    ascii: "c",
  }),
  defineEntityType({
    type: TYPE.spawn,
    description: "Player spawn point: where the player's feet start.",
    fields: spawnFields,
    base: "marker",
    ascii: "S",
    bulk: { form: "point", description: "Player spawn points (feet), absolute metres." },
  }),
  defineEntityType({
    type: PLAYER_TYPE,
    description:
      "The runner the input drives. The game spawns it at the first spawn, or at Play's start.",
    fields: playerFields,
    system: createPlayerSystem,
    spawnOnly: true,
    physics: "required",
  }),
];

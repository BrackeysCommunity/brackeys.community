import { defineGame } from "@jams/engine/game";

import { PLATFORMER_ACTIONS } from "./actions";
import { PLATFORMER_EDIT_KEYS } from "./edit-keys";
import { GRAPPLE_RANGE } from "./entities/grapple-anchor";
import { MOVEMENT_CONFIG, PLAYER_HEIGHT, PLAYER_TYPE, PLAYER_WIDTH } from "./entities/player";
import { PLATFORMER_ISSUES } from "./issues";
import { PLATFORMER_MATERIALS } from "./materials";
import { PLATFORMER_PHYSICAL_CHECKS } from "./physical";
import { PLATFORMER_PLAY } from "./play";
import { createPlatformerRuntime, type PlayerSnapshot } from "./runtime";
import { CLOUD_GROUP } from "./systems/cloud";
import { attachShaper, SHAPER_KEYS } from "./systems/shaper-attach";
import { PLATFORMER_TEMPLATE } from "./template";
import { TYPE } from "./type-names";
import { PLATFORMER_TYPES } from "./types";
import { PLATFORMER_VALIDATORS } from "./validate";

/** A Transformice-style runner: run, jump, wall-jump, dash and grapple to the cheese. */
export const platformerGame = defineGame<PlayerSnapshot>({
  id: "platformer",
  types: PLATFORMER_TYPES,
  spawnOrder: [
    "solid",
    TYPE.cloud,
    ["sensor", TYPE.goal, TYPE.exit, TYPE.hazard],
    "prop",
    [TYPE.mover, "follower"],
    TYPE.anchor,
    TYPE.construct,
    ["marker", TYPE.spawn],
    PLAYER_TYPE,
  ],
  actions: PLATFORMER_ACTIONS,
  materials: PLATFORMER_MATERIALS,
  collisionGroups: {
    [PLAYER_TYPE]: { collidesWith: ["static", "dynamic", "sensor"] },
    [CLOUD_GROUP]: { collidesWith: [PLAYER_TYPE] },
  },
  issues: PLATFORMER_ISSUES,
  validators: PLATFORMER_VALIDATORS,
  physicalChecks: PLATFORMER_PHYSICAL_CHECKS,
  template: PLATFORMER_TEMPLATE,
  configHash: JSON.stringify({
    movement: MOVEMENT_CONFIG,
    grappleRange: GRAPPLE_RANGE,
    player: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
  }),
  createRuntime: createPlatformerRuntime,
  world: { gravity: [0, 1200] },
  time: { kind: "fixed", rate: 60 },
  play: PLATFORMER_PLAY,
  editorKeys: [...SHAPER_KEYS, ...PLATFORMER_EDIT_KEYS],
  // Dev builds only, so a production build emits no editor code at all.
  ...(import.meta.env?.DEV
    ? { editor: { tools: () => import("./editor").then((m) => m.PLATFORMER_EDITOR_TOOLS) } }
    : {}),
  attach: attachShaper,
});

export { PLATFORMER_ACTIONS } from "./actions";
export { PLATFORMER_ISSUES, type PlatformerIssueCode } from "./issues";
export { PLATFORMER_VALIDATORS } from "./validate";
export { PLATFORMER_TEMPLATE } from "./template";
export { PLATFORMER_MATERIALS, type PlatformerMaterial } from "./materials";
export { PLATFORMER_PLAY } from "./play";
export { PLATFORMER_LAYERS } from "./layers";
export { TYPE } from "./type-names";
export { PLATFORMER_TYPES } from "./types";
export type {
  AnchorEntity,
  CloudEntity,
  ConstructEntity,
  MoverEntity,
  PlayerTypeEntity,
  SpawnEntity,
} from "./types";
export {
  createPlatformerRuntime,
  type PlatformerDebugInfo,
  type PlatformerStoreSlice,
  type PlayerSnapshot,
} from "./runtime";
export {
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  MOVEMENT_CONFIG,
  PLAYER_HEIGHT,
  PLAYER_TYPE,
  PLAYER_WIDTH,
  type MovementState,
} from "./entities/player";
export { GRAPPLE_RANGE } from "./entities/grapple-anchor";
export {
  CONSTRUCT_CONFIGS,
  CONSTRUCT_TYPES,
  type ConstructType,
} from "./entities/shaper-constructs";

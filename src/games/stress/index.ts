import { defineGame } from "@jams/engine/game";
import { z } from "zod";

import { ACTIONS } from "./actions";
import { PLAY } from "./play";
import { createRuntime } from "./runtime";
import { TEMPLATE } from "./template";
import {
  agentType,
  GAME_ID,
  MAX_CROWD,
  pelletType,
  PROJECT_SETTINGS,
  SCENE_SETTINGS,
  spawnerType,
  type Snapshot,
} from "./types";

const scale = z.strictObject({ scale: z.number().min(0).max(1000) });

/**
 * Stress: scenes that load one engine subsystem each, and the game code a
 * profile needs beside them: pellets spawned and destroyed, bodies crossing
 * sensors, and a crowd steered every tick.
 */
export const stressGame = defineGame<Snapshot>({
  id: GAME_ID,
  types: [spawnerType, pelletType, agentType],
  actions: ACTIONS,
  // Props and pellets are in the engine's dynamic group, which ignores sensors unless told.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  materials: {
    bouncy: {
      friction: 0.4,
      restitution: 0.9,
      description: "Bouncy rubber.",
      style: { fill: 0xe05a5a },
      tint: 0xffc0c0,
    },
  },
  world: {
    physics: "rapier",
    gravity: [0, 12],
    lengthUnit: 100,
  },
  time: { kind: "fixed", rate: 60 },
  settings: SCENE_SETTINGS,
  projectSettings: PROJECT_SETTINGS,
  commands: {
    crowd: {
      description: "Set how many agents walk the scene's walk areas.",
      args: z.strictObject({ count: z.number().int().min(0).max(MAX_CROWD) }),
    },
    "spawn-rate": {
      description: "Multiply every spawner's rate by this from now on.",
      args: scale,
    },
    "spawn-cap": { description: "Multiply every spawner's cap by this from now on.", args: scale },
    goto: {
      description: "Load another scene of the project's list.",
      args: z.strictObject({ scene: z.string() }),
    },
  },
  play: PLAY,
  template: TEMPLATE,
  createRuntime,
});

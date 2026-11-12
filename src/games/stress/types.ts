import { defineEntityType, pointField, primitiveFields } from "@jams/engine/game";
import { z } from "zod";

export const GAME_ID = "stress";

export const SPAWNER = "spawner";
export const PELLET = "pellet";
export const AGENT = "agent";

/** Raised when a `goto` names a scene the project's list can't go to. */
export const REFUSED = `${GAME_ID}:refused`;

export const PELLET_KINDS = ["ball", "box", "capsule"] as const;
export type PelletKind = (typeof PELLET_KINDS)[number];

/** What a spawner uses for the fields its entity leaves out. */
export const SPAWNER_DEFAULTS = {
  rate: 30,
  cap: 200,
  lifeMs: 3000,
  pellet: "ball" as PelletKind,
  size: 0.16,
  spread: 0.5,
};

/** The most agents a `crowd` command or the settings can ask for. */
export const MAX_CROWD = 20000;

/** The atlas an agent's sprite draws from; a scene with a crowd lists it in `assets`. */
export const AGENT_ART = {
  asset: "stress-hero",
  frames: ["hero-0", "hero-1"],
  size: 0.24,
} as const;

/** Emits short-lived pellets below itself, at `rate` a second while fewer than `cap` are alive. */
export const spawnerType = defineEntityType({
  type: SPAWNER,
  description: "Emits short-lived pellets: `rate` a second, at most `cap` alive at once.",
  base: "marker",
  fields: {
    at: pointField("Where pellets appear."),
    rate: z
      .number()
      .min(0)
      .optional()
      .describe(`Pellets a second; default ${SPAWNER_DEFAULTS.rate}.`)
      .meta({ title: "Rate" }),
    cap: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(`The most of its pellets alive at once; default ${SPAWNER_DEFAULTS.cap}.`)
      .meta({ title: "Cap" }),
    lifeMs: z
      .number()
      .positive()
      .optional()
      .describe(`How long a pellet lives, ms; default ${SPAWNER_DEFAULTS.lifeMs}.`)
      .meta({ title: "Lifetime", unit: "ms" }),
    pellet: z
      .enum(PELLET_KINDS)
      .optional()
      .describe(`The pellet's collider; default ${SPAWNER_DEFAULTS.pellet}.`)
      .meta({ title: "Pellet" }),
    size: z
      .number()
      .positive()
      .optional()
      .describe(`A pellet's width, m; default ${SPAWNER_DEFAULTS.size}.`)
      .meta({ title: "Pellet size", unit: "m" }),
    spread: z
      .number()
      .min(0)
      .optional()
      .describe(
        `Pellets appear up to this far left or right of the spawner, m; default ${SPAWNER_DEFAULTS.spread}.`,
      )
      .meta({ title: "Spread", unit: "m" }),
    ccd: z
      .boolean()
      .optional()
      .describe("Whether its pellets use continuous collision detection.")
      .meta({ title: "CCD" }),
  },
  style: { stroke: 0xff8844 },
  ascii: "^",
});

/** A dynamic body a spawner emits; its `lifetime` destroys it. */
export const pelletType = defineEntityType({
  type: PELLET,
  description: "A short-lived body a spawner emits; game code spawns it, a scene can't place it.",
  base: "prop",
  spawnOnly: true,
  fields: (env) => primitiveFields("prop", env),
  style: { fill: 0xffaa55, stroke: 0xffddaa, alpha: 0.9 },
});

/** One of the crowd: no body, moved by game code along the scene's walk areas. */
export const agentType = defineEntityType({
  type: AGENT,
  description: "One of the crowd, steered by game code; a scene can't place it.",
  base: "decor",
  spawnOnly: true,
  fields: { at: pointField("Where it stands.") },
});

/** The game's fields in a scene's `settings`: one scene's load. */
export const SCENE_SETTINGS = {
  crowd: z
    .number()
    .int()
    .min(0)
    .max(MAX_CROWD)
    .optional()
    .describe("Agents the game walks over the scene's walk areas; default 0."),
  spawnRate: z
    .number()
    .min(0)
    .optional()
    .describe("Multiplies every spawner's rate in this scene; default 1."),
  spawnCap: z
    .number()
    .min(0)
    .optional()
    .describe("Multiplies every spawner's cap in this scene; default 1."),
};

const scale = (what: string) =>
  z.number().min(0).max(64).default(1).describe(`Multiplies ${what} in every scene.`);

/** The game's fields in the project's game-settings: every scene's load at once. */
export const PROJECT_SETTINGS = {
  crowdScale: scale("the crowd"),
  spawnRateScale: scale("every spawner's rate"),
  spawnCapScale: scale("every spawner's cap"),
};

export const COUNTERS = ["agents", "pellets", "spawned", "destroyed", "enters", "exits"] as const;
export type Counter = (typeof COUNTERS)[number];

export type Snapshot = Record<Counter, number> & {
  /** Sensors with something inside. */
  occupied: number;
  /** How far the crowd has walked in all, mm. */
  walked: number;
};

/** What the HUD reads from the store; the same object until something in it changes. */
export type Slice = {
  scene: string | null;
  /** The scenes `goto` takes, in list order. */
  scenes: readonly string[];
  agents: number;
  pellets: number;
  enters: number;
  /** The crowd the game is holding, and the multipliers on every spawner's rate and cap. */
  crowd: number;
  spawnRate: number;
  spawnCap: number;
};

import { z } from "zod";

import { MAX_TICK_RATE, MIN_TICK_RATE, tickRateProblem } from "../../game/time";
import type { GameWorldDef, Registry } from "../../game/types";
import type { ResolutionPolicy } from "../../resolution";
import { makeIssue } from "../../scene/issues";
import type { SceneIssue } from "../../scene/types";
import { schemaRefSites, type RefSite } from "../refs";
import type { AssetEntry, ProjectView } from "../types";
import { byPathThenKey, defineAssetKind, type KindEnv } from "./define";

export const GAME_SETTINGS_KIND = "game-settings";
export const GAME_SETTINGS_VERSION = 1;
export const GAME_SETTINGS_SCHEMA_ID = `urn:jams-engine:game-settings:v${GAME_SETTINGS_VERSION}`;

export type GameSettingsFile = {
  $schema?: string;
  kind: typeof GAME_SETTINGS_KIND;
  v: typeof GAME_SETTINGS_VERSION;
  engine: GameSettingsEngine;
  game: Record<string, unknown>;
};

/** The engine's project-wide settings: each beats the game's default and loses to a scene's own. */
export type GameSettingsEngine = {
  resolution?: Partial<ResolutionPolicy>;
  physics?: GameWorldDef["physics"];
  gravity?: GameWorldDef["gravity"];
  /** Ticks per second for every scene; checked by the kind's `validate`, not the schema. */
  tickRate?: number;
};

const positive = (description: string) => z.number().positive().describe(description);

const VirtualSchema = z
  .union([
    z.strictObject({
      width: positive("World units across."),
      height: positive("World units down."),
    }),
    z.strictObject({ height: positive("World units down; the width follows the canvas.") }),
    z.strictObject({ width: positive("World units across; the height follows the canvas.") }),
  ])
  .describe("World units the camera shows at zoom 1 on the fixed axis or axes.");

const resolutionFields = {
  virtual: VirtualSchema.optional(),
  fit: z
    .enum(["expand", "letterbox", "crop"])
    .optional()
    .describe(
      "expand: the fixed axis fills the canvas and the other shows more; letterbox: the whole virtual area shows, bars fill the rest; crop: the virtual area covers the canvas, the overflow is cut. letterbox and crop need a width and a height.",
    ),
  integer: z
    .boolean()
    .optional()
    .describe("Scale only by whole multiples (pixel art); bars take the remainder."),
  sampling: z
    .enum(["linear", "nearest"])
    .optional()
    .describe("Default texture sampling; a texture's import filter wins."),
  antialias: z.boolean().optional().describe("The renderer's antialiasing."),
  pixelSnap: z
    .boolean()
    .optional()
    .describe("Round camera and visual positions to whole canvas pixels."),
  bars: z
    .number()
    .int()
    .min(0)
    .max(0xffffff)
    .optional()
    .describe("Bar colour, 0xRRGGBB as a number; default the background."),
};

const ResolutionSchema = z
  .strictObject(resolutionFields)
  .describe(
    "How the world maps onto the canvas; each field given wins over the game's and loses to the host's.",
  ) satisfies z.ZodType<Partial<ResolutionPolicy>>;

const engineFields = {
  resolution: ResolutionSchema.optional(),
  physics: z
    .enum(["rapier", "none"])
    .optional()
    .describe(
      'The physics world for every scene that doesn\'t set its own: "rapier" simulates bodies, "none" runs without one. Omitted: the game\'s.',
    ) satisfies z.ZodType<GameSettingsEngine["physics"]>,
  gravity: z
    .tuple([
      z.number().describe("x, px/s²; positive pulls right."),
      z.number().describe("y, px/s²; positive pulls down."),
    ])
    .optional()
    .describe(
      "World gravity [x, y] in px/s² for every scene that doesn't set its own; y is down. Omitted: the game's.",
    ) satisfies z.ZodType<GameSettingsEngine["gravity"]>,
  tickRate: z
    .number()
    .optional()
    .describe(
      `Ticks per second for every scene, an integer from ${MIN_TICK_RATE} to ${MAX_TICK_RATE}; the game's time model keeps its kind. Omitted: the game's rate.`,
    ),
};

/**
 * The resolution policy an `engine` block sets: the whole block when it
 * parses, else each field that does; undefined when it sets none.
 */
export function engineResolution(
  engine: Readonly<Record<string, unknown>>,
): Partial<ResolutionPolicy> | undefined {
  const given = engine.resolution;
  if (given === undefined || given === null || typeof given !== "object") return undefined;
  const whole = ResolutionSchema.safeParse(given);
  const out: Record<string, unknown> = {};
  if (whole.success) Object.assign(out, whole.data);
  else
    for (const [key, schema] of Object.entries(resolutionFields)) {
      const own = (schema as z.ZodType).safeParse((given as Record<string, unknown>)[key]);
      if (own.success && own.data !== undefined) out[key] = own.data;
    }
  return Object.keys(out).length > 0 ? (out as Partial<ResolutionPolicy>) : undefined;
}

function gameSettingsSchema(registry: Registry): z.ZodType<GameSettingsFile> {
  const fields = registry.game?.projectSettings ?? {};
  return z
    .strictObject({
      $schema: z.string().optional().describe("The game-settings JSON Schema this file follows."),
      kind: z.literal(GAME_SETTINGS_KIND).describe('Always "game-settings".'),
      v: z.literal(GAME_SETTINGS_VERSION).describe("Game-settings format version."),
      engine: z.strictObject(engineFields).describe("The engine's project-wide settings."),
      game: z
        .strictObject(fields)
        .describe(
          registry.game
            ? `The ${registry.id} game's project-wide settings; omitted fields take the game's defaults.`
            : "The game's project-wide settings; a project with no game has none.",
        ),
    })
    .describe(
      "Project-wide settings, at most one file per project. Game code reads `game` with defaults applied.",
    ) as unknown as z.ZodType<GameSettingsFile>;
}

/** The project's live game-settings entries, the one in effect (first by path) first. */
export function gameSettingsEntries(view: ProjectView): AssetEntry[] {
  return [...view.byId.values()].filter((e) => e.kind === GAME_SETTINGS_KIND).sort(byPathThenKey);
}

/** `asset-kind` for every live game-settings asset after the first by path: a project has at most one. */
export function gameSettingsIssues(view: ProjectView): SceneIssue[] {
  const [first, ...extra] = gameSettingsEntries(view);
  return extra.map((entry) =>
    makeIssue("asset-kind", {
      message: `"${entry.id}" is a second game-settings asset; "${first!.id}" (${first!.path}) is the project's`,
      entityIds: [entry.key],
      got: entry.path,
      hint: `Move its settings into "${first!.id}" and delete it.`,
    }),
  );
}

/**
 * The game's settings with its `projectSettings` defaults applied: the
 * parsed block, or field by field when the block as a whole doesn't parse
 * (a bad value falls back to its default, else is left out).
 */
export function gameSettingsValues(
  registry: Registry,
  game: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const fields = registry.game?.projectSettings ?? {};
  const given = game ?? {};
  const whole = z.object(fields).safeParse(given);
  if (whole.success) return whole.data;
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(fields)) {
    const own = (schema as z.ZodType).safeParse(given[key]);
    const value = own.success ? own.data : (schema as z.ZodType).safeParse(undefined).data;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** `tick-rate-invalid` for an `engine.tickRate` the clock can't run. */
function engineIssues(engine: GameSettingsEngine): SceneIssue[] {
  if (engine.tickRate === undefined) return [];
  const problem = tickRateProblem(engine.tickRate);
  return problem === null
    ? []
    : [
        makeIssue("tick-rate-invalid", {
          message: `engine.tickRate: ${problem}`,
          path: "/engine/tickRate",
          expected: `integer ${MIN_TICK_RATE}..${MAX_TICK_RATE}`,
          got: String(engine.tickRate),
        }),
      ];
}

/** Project-wide settings: the engine's block (resolution, physics, gravity, tick rate) and the game's `projectSettings`. */
export const gameSettingsKind = defineAssetKind({
  kind: GAME_SETTINGS_KIND,
  title: "Game settings",
  description: "Project-wide settings: the engine's and the game's. At most one per project.",
  match: { jsonKind: GAME_SETTINGS_KIND },
  defaultFolder: () => "",
  storage: "doc",
  version: GAME_SETTINGS_VERSION,
  schemaId: GAME_SETTINGS_SCHEMA_ID,
  schema: (env: KindEnv) => gameSettingsSchema(env.registry),
  layout: {
    as: "map",
    fields: {
      engine: { as: "map", rest: { as: "atomic" } },
      game: { as: "map", rest: { as: "atomic" } },
    },
  },
  validate: (file: GameSettingsFile): SceneIssue[] => engineIssues(file.engine),
  refs: (file: GameSettingsFile, env: KindEnv): RefSite[] =>
    schemaRefSites(env.registry.game?.projectSettings ?? {}, file.game, "/game"),
  empty: (): GameSettingsFile => ({
    kind: GAME_SETTINGS_KIND,
    v: GAME_SETTINGS_VERSION,
    engine: {},
    game: {},
  }),
});

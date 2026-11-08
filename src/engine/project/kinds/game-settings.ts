import { z } from "zod";

import type { Registry } from "../../game/types";
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
  engine: { resolution?: Partial<ResolutionPolicy> };
  game: Record<string, unknown>;
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
      engine: z
        .strictObject({ resolution: ResolutionSchema.optional() })
        .describe("The engine's project-wide settings."),
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

/** Project-wide settings: the engine's block (its resolution policy) and the game's `projectSettings`. */
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
  refs: (file: GameSettingsFile, env: KindEnv): RefSite[] =>
    schemaRefSites(env.registry.game?.projectSettings ?? {}, file.game, "/game"),
  empty: (): GameSettingsFile => ({
    kind: GAME_SETTINGS_KIND,
    v: GAME_SETTINGS_VERSION,
    engine: {},
    game: {},
  }),
});

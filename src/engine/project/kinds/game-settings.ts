import { z } from "zod";

import type { Registry } from "../../game/types";
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
  engine: Record<string, never>;
  game: Record<string, unknown>;
};

function gameSettingsSchema(registry: Registry): z.ZodType<GameSettingsFile> {
  const fields = registry.game?.projectSettings ?? {};
  return z
    .strictObject({
      $schema: z.string().optional().describe("The game-settings JSON Schema this file follows."),
      kind: z.literal(GAME_SETTINGS_KIND).describe('Always "game-settings".'),
      v: z.literal(GAME_SETTINGS_VERSION).describe("Game-settings format version."),
      engine: z.strictObject({}).describe("The engine's project-wide settings; none yet."),
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

/** Project-wide settings: the engine's block (empty for now) and the game's `projectSettings`. */
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

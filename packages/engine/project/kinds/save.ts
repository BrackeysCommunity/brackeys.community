import { z } from "zod";

import { parseSaveFile, type SaveDepth } from "../../game/save-file";
import { guardedInspect, importFailed } from "../inspect/result";
import { utf8Json, utf8Text } from "../inspect/text";
import type { RefSite } from "../refs";
import type { AssetEntry } from "../types";
import { defineAssetKind, folderOf } from "./define";

export const SAVE_KIND = "save";
export const SAVE_SUFFIX = ".save.json";
export const SAVE_FIXTURE_MAX_BYTES = 1_048_576;

/** What a save fixture's envelope gives. */
export type SaveFixtureMeta = {
  game: string;
  gameVersion: number;
  depth: SaveDepth;
  scene: string;
};
export type SaveFixtureSettings = Record<string, never>;

export const saveFixtureSettingsSchema: z.ZodType<SaveFixtureSettings> = z
  .strictObject({})
  .describe("Save fixture import settings; none.");

export const saveFixtureMetaSchema: z.ZodType<SaveFixtureMeta> = z
  .strictObject({
    game: z.string().describe("The game the save is for."),
    gameVersion: z.number().describe("The game's save-data version it was written at."),
    depth: z.enum(["progress", "world"]).describe("What it holds: progress, or the whole world."),
    scene: z.string().describe("The main scene it loads into."),
  })
  .describe("What the save's envelope gives.");

/**
 * A `save:v1` file a playtest can start from. Unlike a recording it can be
 * recaptured: new bytes are a `replaceContent`, last writer wins on the hash.
 */
export const saveKind = defineAssetKind({
  kind: SAVE_KIND,
  title: "Save fixture",
  description: "A save:v1 file a playtest can start from.",
  match: { suffixes: [SAVE_SUFFIX] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "blob",
  contentTypes: ["application/json"],
  maxBytes: SAVE_FIXTURE_MAX_BYTES,
  settings: saveFixtureSettingsSchema,
  meta: saveFixtureMetaSchema,
  inspect: guardedInspect(
    SAVE_KIND,
    { settings: saveFixtureSettingsSchema, meta: saveFixtureMetaSchema },
    (bytes, _settings, env) => {
      // The engine's own sentence for bad JSON, so the issue reads the same under every runtime.
      const json = utf8Json(bytes);
      if (!json.ok) return importFailed(SAVE_KIND, env, json.reason);
      const text = utf8Text(bytes)!;
      // No game here, so the file is read as written: no game check, no migration.
      const parsed = parseSaveFile(text);
      if (!parsed.ok) {
        const first = parsed.issues[0];
        const where = first ? ` (${first.path || "/"}: ${first.message})` : "";
        return importFailed(SAVE_KIND, env, `it isn't a save:v1 file${where}`);
      }
      const { game, gameVersion, depth, scene } = parsed.file;
      return { ok: true, meta: { game, gameVersion, depth, scene: scene.id } };
    },
  ),
  refs: (entry: AssetEntry): RefSite[] =>
    typeof entry.meta?.scene === "string"
      ? [{ pointer: "/meta/scene", id: entry.meta.scene, kinds: ["scene"] }]
      : [],
});

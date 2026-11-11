import { z } from "zod";

import { parseRecording, RECORDING_VERSION } from "../../scene/recording-schema";
import { guardedInspect, importFailed } from "../inspect/result";
import { utf8Json } from "../inspect/text";
import type { RefSite } from "../refs";
import type { AssetEntry } from "../types";
import { defineAssetKind, folderOf } from "./define";

export const RECORDING_KIND = "recording";
export const RECORDING_SUFFIX = ".recording.json";

export type RecordingMeta = {
  scene: string;
  ticks: number;
  sceneHash: string;
  /** The file's format version, before any migration on read. */
  v: 1 | 2;
  /** How many seats played. */
  players: number;
};
export type RecordingSettings = Record<string, never>;

export const recordingSettingsSchema: z.ZodType<RecordingSettings> = z
  .strictObject({})
  .describe("Recording import settings; none.");

export const recordingMetaSchema: z.ZodType<RecordingMeta> = z
  .strictObject({
    scene: z.string().describe("The scene it was recorded on."),
    ticks: z.number().int().min(0).describe("Ticks simulated."),
    sceneHash: z.string().describe("The scene's canonical hash when recorded."),
    v: z
      .union([z.literal(1), z.literal(2)])
      .describe("The file's recording format version; a v1 file is migrated when it's read."),
    players: z.number().int().min(0).describe("How many seats played."),
  })
  .describe("What the recording's header gives.");

/**
 * A recorded run, its bytes a `recording:v2` file or a `recording:v1` one,
 * which is read through the v1 migration. Immutable once imported:
 * a recording pins the scene hash it was made on, so `replaceContent` on one
 * is refused with `asset-kind`; record again and import the new file.
 */
export const recordingKind = defineAssetKind({
  kind: RECORDING_KIND,
  title: "Recording",
  description:
    "A recorded run (recording:v2, or v1 migrated on read) for replays and ghosts; immutable once imported, so its content can't be replaced.",
  match: { suffixes: [RECORDING_SUFFIX] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "blob",
  contentTypes: ["application/json"],
  maxBytes: 4 * 1024 * 1024,
  settings: recordingSettingsSchema,
  meta: recordingMetaSchema,
  inspect: guardedInspect(
    RECORDING_KIND,
    { settings: recordingSettingsSchema, meta: recordingMetaSchema },
    (bytes, _settings, env) => {
      const json = utf8Json(bytes);
      if (!json.ok) return importFailed(RECORDING_KIND, env, json.reason);
      const parsed = parseRecording(json.value);
      if (!parsed.ok) {
        const first = parsed.issues[0];
        const where = first ? ` (${first.path || "/"}: ${first.message})` : "";
        return importFailed(RECORDING_KIND, env, `it isn't a recording:v1 or v2 file${where}`);
      }
      const { scene, ticks, sceneHash, players } = parsed.recording;
      const v: RecordingMeta["v"] = parsed.migratedFrom ?? RECORDING_VERSION;
      return { ok: true, meta: { scene, ticks, sceneHash, v, players: players.length } };
    },
  ),
  refs: (entry: AssetEntry): RefSite[] =>
    typeof entry.meta?.scene === "string"
      ? [{ pointer: "/meta/scene", id: entry.meta.scene, kinds: ["scene"] }]
      : [],
});

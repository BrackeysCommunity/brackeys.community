import { z } from "zod";

import { readAudioFormat, type AudioFormat } from "../inspect/audio";
import { guardedInspect, importFailed } from "../inspect/result";
import { defineAssetKind, folderOf } from "./define";

export const AUDIO_KIND = "audio";

export type AudioMeta = { format: AudioFormat };
export type AudioSettings = Record<string, never>;

export const audioSettingsSchema: z.ZodType<AudioSettings> = z
  .strictObject({})
  .describe("Audio import settings; none yet.");

export const audioMetaSchema: z.ZodType<AudioMeta> = z
  .strictObject({
    format: z.enum(["ogg", "mp3", "wav", "m4a"]).describe("The container the file's header names."),
  })
  .describe("What the sound's header gives; samples are never decoded.");

/** A sound: Ogg, MP3, WAV or M4A, its format read from the header. */
export const audioKind = defineAssetKind({
  kind: AUDIO_KIND,
  title: "Audio",
  description: "A sound or music track: Ogg, MP3, WAV or M4A.",
  match: { suffixes: [".ogg", ".mp3", ".wav", ".m4a"] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "blob",
  contentTypes: ["audio/ogg", "audio/mpeg", "audio/wav", "audio/mp4"],
  maxBytes: 16 * 1024 * 1024,
  settings: audioSettingsSchema,
  meta: audioMetaSchema,
  inspect: guardedInspect(
    AUDIO_KIND,
    { settings: audioSettingsSchema, meta: audioMetaSchema },
    (bytes, _settings, env) => {
      const format = readAudioFormat(bytes);
      return format
        ? { ok: true, meta: { format } }
        : importFailed(AUDIO_KIND, env, "its header isn't an Ogg, MP3, WAV or M4A file");
    },
  ),
});

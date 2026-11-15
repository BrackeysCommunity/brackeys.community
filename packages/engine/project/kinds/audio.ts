import { z } from "zod";

import { readAudioHeader, type AudioFormat } from "../inspect/audio";
import { guardedInspect, importFailed } from "../inspect/result";
import { defineAssetKind, folderOf } from "./define";

export const AUDIO_KIND = "audio";

export type AudioMeta = {
  format: AudioFormat;
  durationMs?: number;
  channels?: number;
  sampleRate?: number;
};
export type AudioSettings = {
  /** Play through a media element instead of decoding whole. */
  stream?: boolean;
  /** Seconds. */
  loopStart?: number;
  /** Seconds. */
  loopEnd?: number;
};

const seconds = (description: string) =>
  z.number().min(0).optional().describe(description).meta({ unit: "s" });

export const audioSettingsSchema: z.ZodType<AudioSettings> = z
  .strictObject({
    stream: z
      .boolean()
      .optional()
      .describe(
        "Play through a media element as it downloads instead of decoding the whole clip first; for long music. Off by default.",
      ),
    loopStart: seconds("Where a loop restarts, in seconds from the start; 0 by default."),
    loopEnd: seconds(
      "Where a loop jumps back, in seconds from the start; the clip's end by default.",
    ),
  })
  .refine(
    (settings) => settings.loopEnd === undefined || settings.loopEnd > (settings.loopStart ?? 0),
    { message: "loopEnd must come after loopStart", path: ["loopEnd"] },
  )
  .describe("Audio import settings; every field is optional.");

export const audioMetaSchema: z.ZodType<AudioMeta> = z
  .strictObject({
    format: z.enum(["ogg", "mp3", "wav", "m4a"]).describe("The container the file's header names."),
    durationMs: z
      .number()
      .min(0)
      .optional()
      .describe("The clip's length, read from its headers.")
      .meta({ unit: "ms" }),
    channels: z.number().int().positive().optional().describe("Channels: 1 is mono, 2 stereo."),
    sampleRate: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Samples per second per channel.")
      .meta({ unit: "Hz" }),
  })
  .describe("What the sound's headers give; samples are never decoded.");

/** A sound: Ogg, MP3, WAV or M4A, its format, length, channels and rate read from its headers. */
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
  metaVersion: 2,
  inspect: guardedInspect(
    AUDIO_KIND,
    { settings: audioSettingsSchema, meta: audioMetaSchema },
    (bytes, _settings, env) => {
      const read = readAudioHeader(bytes);
      if (!read)
        return importFailed(AUDIO_KIND, env, "its header isn't an Ogg, MP3, WAV or M4A file");
      if ("fault" in read) return importFailed(AUDIO_KIND, env, read.fault);
      return { ok: true, meta: { format: read.format, ...read.header } };
    },
  ),
});

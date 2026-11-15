/**
 * The `audio` behavior's schema: a sound that plays while the entity
 * carries it (an ambient loop, a positional source), presentation only.
 * Zod only; the system lives in `runtime/behaviors/audio.ts` and writes
 * presentation requests.
 */
import { z } from "zod";

import { SOUND_KIND } from "../../project/kinds/sound";
import { defineBehavior, handleType } from "../behaviors";
import { assetField } from "../fields";
import type { FieldEnv } from "../types";

const audioFields = (env: FieldEnv) => ({
  sound: assetField(env, [SOUND_KIND], "The sound it plays."),
  playing: z
    .boolean()
    .optional()
    .describe("Plays from attach while true; default true.")
    .meta({ default: true, group: "playback" }),
  volume: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Scales the sound's own volume, 0–1; default 1.")
    .meta({ default: 1, group: "playback" }),
});

/** An `audio` block as an entity carries it. */
export type AudioBlock = z.infer<z.ZodObject<ReturnType<typeof audioFields>>>;

/** Starts and stops one entity's sound. */
export type AudioHandle = {
  play(): void;
  stop(): void;
  readonly playing: boolean;
};

export const AUDIO = defineBehavior({
  name: "audio",
  handle: handleType<AudioHandle>(),
  description:
    "Plays a sound while the entity carries it: an ambient loop or a positional source, presentation only.",
  visualOnly: true,
  fields: audioFields,
  inspector: { category: "visual", label: "Audio", order: ["sound", "playing", "volume"] },
});

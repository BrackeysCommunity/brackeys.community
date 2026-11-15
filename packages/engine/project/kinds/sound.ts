/**
 * The `sound` kind's file: one sound (its bus, volume, pitch range and
 * variants) and the step events that play it. Presentation only. The bus
 * list lives here, so the schema, the audio system and the editor share
 * it. Zod, scene/ and project/ only, so the hosted service reads it.
 */
import { z } from "zod";

import type { BusName } from "../../audio/types";
import { ID_PATTERN } from "../../game/fields";
import type { JsonValue, Registry } from "../../game/types";
import { didYouMean } from "../../scene/did-you-mean";
import { jsonPointer } from "../../scene/issues";
import type { RefSite } from "../refs";
import type { AssetId } from "../types";
import { AUDIO_KIND } from "./audio";
import { defineAssetKind, folderOf, type DocLookup, type KindEnv } from "./define";
import { docStringKeyIssues, STRING_KEY_PATTERN } from "./strings";
import { SYNTH_KIND } from "./synth";

export const SOUND_KIND = "sound";
export const SOUND_VERSION = 1;
export const SOUND_SCHEMA_ID = `urn:jams-engine:sound:v${SOUND_VERSION}`;

/** The engine's buses; each but `master` routes into `master`. */
export const ENGINE_BUSES = ["master", "music", "sfx", "voice", "ui"] as const;

/** What a bus a game declares may be called. */
export const BUS_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** How many voices one sound keeps when its file gives no `maxVoices`. */
export const SOUND_MAX_VOICES_DEFAULT = 8;

/** A step event a sound plays on. */
export type SoundMatcher = {
  /** A step event type: "contact:start", "anim:frame", a game's own. */
  event: string;
  /** The event's entity's type, or a tag of it. */
  type?: string;
  tag?: string;
  /** Every key must equal the event's data at that key (shallow). */
  data?: Readonly<Record<string, JsonValue>>;
};

/** A `sound:v1` file. */
export type SoundFile = {
  $schema?: string;
  kind: typeof SOUND_KIND;
  v: typeof SOUND_VERSION;
  bus: BusName;
  /** 0–1, default 1. */
  volume?: number;
  /** Playback rate range, default [1, 1]. */
  pitch?: [min: number, max: number];
  /** `clip`: an `audio` clip or a `synth` patch. */
  variants: { clip: AssetId; weight?: number }[];
  loop?: boolean;
  cooldownMs?: number;
  /** Default 8. */
  maxVoices?: number;
  positional?: boolean;
  /** World metres a positional sound fades out over; omitted, no falloff. */
  range?: number;
  /** A string key. */
  caption?: string;
  on?: SoundMatcher[];
  /** Load its clips with the scene bundle instead of on first play. */
  preload?: boolean;
};

/** Every bus a game's sounds may name: the engine's five, then the game's own in declared order. */
export function audioBuses(registry: Pick<Registry, "game">): readonly BusName[] {
  const declared = registry.game?.audio?.buses ?? [];
  const out: BusName[] = [...ENGINE_BUSES];
  for (const { name } of declared) if (!out.includes(name)) out.push(name);
  return out;
}

const jsonValue = z.json().describe("Any JSON value.") as z.ZodType<JsonValue>;

const matcherSchema = z
  .strictObject({
    event: z
      .string()
      .min(1)
      .describe('A step event type: "contact:start", "anim:frame", a game\'s own.'),
    type: z.string().optional().describe("Only when the event's entity is of this type."),
    tag: z.string().optional().describe("Only when the event's entity carries this tag."),
    data: z
      .record(z.string(), jsonValue)
      .optional()
      .describe("Only when the event's data equals each of these keys (shallow)."),
  })
  .describe("A step event that plays the sound.");

/** Why a sound can't play through `bus` when `buses` are the ones there are, or null when it can. */
export function soundBusProblem(
  bus: string,
  buses: readonly BusName[],
): { message: string; hint: string } | null {
  if (buses.includes(bus)) return null;
  return {
    message: `no bus "${bus}"${didYouMean(bus, buses)}`,
    hint: `Use one of ${buses.join(", ")}, or declare "${bus}" in GameDefinition.audio.buses.`,
  };
}

/** A bus name, refused as `sound-bus-unknown` unless `buses` has it. */
const busSchema = (buses: readonly BusName[]) =>
  z
    .string()
    .superRefine((bus, ctx) => {
      const problem = soundBusProblem(bus, buses);
      if (!problem) return;
      ctx.addIssue({
        code: "custom",
        message: problem.message,
        params: {
          issue: "sound-bus-unknown",
          expected: buses.join(" | "),
          got: bus,
          hint: problem.hint,
        },
      });
    })
    .describe(
      `The bus it plays through: ${buses.join(", ")}; a game adds its own in GameDefinition.audio.buses.`,
    );

const soundSchema = (buses: readonly BusName[]): z.ZodType<SoundFile> =>
  z
    .strictObject({
      $schema: z.string().optional().describe("The sound JSON Schema this file follows."),
      kind: z.literal(SOUND_KIND).describe('Always "sound".'),
      v: z.literal(SOUND_VERSION).describe("Sound format version."),
      bus: busSchema(buses),
      volume: z.number().min(0).max(1).optional().describe("Loudness, 0–1; default 1."),
      pitch: z
        .tuple([
          z.number().positive().describe("The lowest playback rate."),
          z.number().positive().describe("The highest playback rate."),
        ])
        .refine(([min, max]) => min <= max, { message: "min is more than max", path: [1] })
        .optional()
        .describe(
          "Playback rate picked per play, [min, max]; 1 is the clip's own pitch. Default [1, 1].",
        )
        .meta({ widget: "range", step: 0.05, decimals: 2, default: [1, 1] }),
      variants: z
        .array(
          z
            .strictObject({
              clip: z.string().regex(ID_PATTERN).describe("An audio clip or a synth patch."),
              weight: z
                .number()
                .positive()
                .optional()
                .describe("How often it's picked against the others; default 1."),
            })
            .describe("One clip the sound may play."),
        )
        .describe("The clips it picks from on each play, by weight; none plays nothing."),
      loop: z.boolean().optional().describe("Loop until stopped; default false."),
      cooldownMs: z
        .number()
        .min(0)
        .optional()
        .describe("A second play inside this many ms of wall time is dropped.")
        .meta({ title: "Cooldown", unit: "ms" }),
      maxVoices: z
        .number()
        .int()
        .min(1)
        .max(64)
        .optional()
        .describe(
          `At most this many playing at once, the oldest stopped; default ${SOUND_MAX_VOICES_DEFAULT}.`,
        ),
      positional: z
        .boolean()
        .optional()
        .describe("Pan from where it plays against the main view; default false."),
      range: z
        .number()
        .positive()
        .optional()
        .describe("A positional sound fades out linearly over this distance; omitted, no falloff.")
        .meta({ unit: "m" }),
      caption: z
        .string()
        .regex(STRING_KEY_PATTERN)
        .optional()
        .describe("A string key shown as a caption when it plays.")
        .meta({ widget: "string-key" }),
      on: z.array(matcherSchema).optional().describe("The step events that play it."),
      preload: z
        .boolean()
        .optional()
        .describe("Load its clips with the scene bundle instead of on first play."),
    })
    .describe(
      "One sound: its bus, volume, pitch range and variants, and the step events that play it. Presentation only.",
    ) as unknown as z.ZodType<SoundFile>;

/** Every variant's clip: an audio clip or a synth patch. */
const soundRefs = (file: SoundFile): RefSite[] =>
  file.variants.map((variant, i) => ({
    pointer: jsonPointer(["variants", i, "clip"]),
    id: variant.clip,
    kinds: [AUDIO_KIND, SYNTH_KIND],
  }));

/** Sounds the audio system plays on step events and requests; presentation only. */
export const soundKind = defineAssetKind({
  kind: SOUND_KIND,
  title: "Sound",
  description:
    "One sound: its bus, volume, pitch range, variants (clips or synth patches) and the step events that play it.",
  match: { jsonKind: SOUND_KIND },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  runtime: "view",
  version: SOUND_VERSION,
  schemaId: SOUND_SCHEMA_ID,
  schema: (env: KindEnv) => soundSchema(audioBuses(env.registry)),
  layout: {
    as: "map",
    fields: {
      variants: { as: "keyed", id: "clip", item: { as: "map", rest: { as: "atomic" } } },
      on: { as: "list", item: { as: "atomic" } },
    },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 32_768, maxItems: 64 },
  refs: (file: SoundFile): RefSite[] => soundRefs(file),
  crossValidate: (file: SoundFile, lookup: DocLookup) =>
    docStringKeyIssues(SOUND_KIND, file, lookup),
  /**
   * With `preload`, the audio clips: a scene's first frame waits for them.
   * A patch is a runtime doc rendered on demand, and without `preload`
   * clips load on first play, so neither joins a bundle.
   */
  bundleRefs: (file: SoundFile, env: KindEnv): RefSite[] =>
    file.preload
      ? soundRefs(file).filter((site) => env.project?.byId.get(site.id)?.kind !== SYNTH_KIND)
      : [],
  /** An sfx sound with no clip yet; the author names one. */
  empty: (): SoundFile => ({
    kind: SOUND_KIND,
    v: SOUND_VERSION,
    bus: "sfx",
    variants: [],
  }),
});

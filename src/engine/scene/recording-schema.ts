import { z } from "zod";

import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { jsonPointer } from "./issues";
import { SCHEMA_ID_BASE, toJsonSchema } from "./json-schema";

/** The recording format version, the `v` every recording carries. */
export const RECORDING_VERSION = 1;

/** `urn:jams-engine:recording:v1`. Recordings are game-agnostic, so there is one schema. */
export const RECORDING_SCHEMA_ID = `${SCHEMA_ID_BASE}recording:v${RECORDING_VERSION}`;

/** A recording keeps the focus every this many ticks. */
export const RECORDING_TRAIL_EVERY = 4;

const pt = z
  .tuple([
    z.number().describe("x in world pixels."),
    z.number().describe("y in world pixels; y is down."),
  ])
  .meta({ id: "Pt" });

const tick = (description: string) => z.number().int().min(0).describe(description);

/** The zod schema `recording.schema.json` is generated from; `parseRecording` checks with it. */
export const runRecordingSchema = z
  .strictObject({
    $schema: z.string().optional().describe("The recording JSON Schema this file follows."),
    v: z.literal(RECORDING_VERSION).describe("Recording format version."),
    engine: z
      .strictObject({
        version: z.string().describe("The engine version that recorded it."),
        physics: z.string().describe("The physics build, e.g. `rapier 0.19.3`."),
      })
      .describe("What recorded it; a replay on another version or build warns."),
    scene: z.string().describe("The scene's `name`."),
    sceneHash: z
      .string()
      .describe(
        "The scene's canonical hash when recorded; a replay of a changed scene warns that it's stale.",
      ),
    game: z.string().nullable().describe("The game's id; null for an engine-only registry."),
    configHash: z
      .string()
      .describe(
        "What the run depends on besides the scene: engine version, tick rate, the game and its tuning.",
      ),
    tickRate: z.literal(60).describe("Ticks per second."),
    start: z
      .strictObject({
        at: pt
          .optional()
          .describe(
            "Where play was asked to start, before the cast onto the ground; omitted for the game's spawn.",
          ),
        timeOffsetMs: z
          .number()
          .min(0)
          .optional()
          .describe("Time-driven entities (followers) were advanced by this much before tick 0."),
        game: z
          .unknown()
          .optional()
          .describe("The game's play options, as its `play.options` schema defines them."),
      })
      .describe("How the play world started."),
    actions: z
      .array(z.string())
      .describe("The action names `inputs` index into, in the order they were first used."),
    inputs: z
      .array(
        z
          .tuple([
            tick("The tick the edge is stepped on."),
            z.number().int().min(0).describe("Index into `actions`."),
            z.union([z.literal(0), z.literal(1)]).describe("1 for down, 0 for up."),
          ])
          .describe("One input edge, in the order the runtime stepped it."),
      )
      .describe("Every input edge played, oldest first."),
    ticks: tick("Ticks simulated."),
    outcome: z
      .strictObject({
        result: z
          .string()
          .describe(
            "An engine result (`timeout`, `script-end`, `stuck`, `quit`) or one the game declares.",
          ),
        tick: z.number().int().min(-1).describe("The last tick simulated."),
        at: pt.nullable().describe("The game's focus then; null without one."),
        cause: z.string().optional().describe("Why, in a sentence."),
        entityId: z.string().optional().describe("The entity the outcome names."),
      })
      .describe("How the run ended."),
    markers: z
      .array(
        z
          .strictObject({
            tick: tick("The tick that raised it."),
            type: z.string().describe("The event type."),
            at: pt.describe("Where."),
            entityId: z.string().optional().describe("The entity it names."),
            other: z.string().optional().describe("The other entity it names."),
          })
          .describe("An event worth showing on the ghost."),
      )
      .describe("Events the game marks (`play.markers`; every event when it names none), capped."),
    trail: z
      .strictObject({
        every: z.literal(RECORDING_TRAIL_EVERY).describe("Ticks between samples."),
        pts: z
          .array(pt)
          .describe("The focus after ticks 0, 4, 8, …; a tick without a focus is left out."),
        truncated: z.boolean().describe("True when the cap cut the trail short."),
      })
      .optional()
      .describe("The game's focus over the run, for the ghost."),
    end: z
      .string()
      .describe(
        "A digest of the game's snapshot after the last tick, which a replay must reproduce.",
      ),
  })
  .describe(
    "A recorded run: how it started and every input edge, enough to replay it tick for tick, " +
      "plus what the ghost draws (trail and markers) and how it ended.",
  );

export type RunRecording = z.infer<typeof runRecordingSchema>;
export type RecordingMarker = RunRecording["markers"][number];

/** A recording that didn't parse: a JSON Pointer into it and one sentence per problem. */
export type RecordingIssue = { path: string; message: string };

export type ParseRecordingResult =
  | { ok: true; recording: RunRecording }
  | { ok: false; issues: RecordingIssue[] };

/** Parses a recording from JSON text or a parsed value. Never throws. */
export function parseRecording(input: unknown): ParseRecordingResult {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, issues: [{ path: "", message: `the text isn't valid JSON: ${detail}` }] };
    }
  }
  const parsed = runRecordingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: jsonPointer(i.path.filter((p): p is string | number => typeof p !== "symbol")),
        message: i.message,
      })),
    };
  }
  const { actions, inputs } = parsed.data;
  const bad = inputs.findIndex(([, a]) => a >= actions.length);
  if (bad >= 0) {
    return {
      ok: false,
      issues: [
        {
          path: jsonPointer(["inputs", bad, 1]),
          message: `action index ${inputs[bad]![1]} is outside \`actions\` (${actions.length} names)`,
        },
      ],
    };
  }
  return { ok: true, recording: parsed.data };
}

/** The draft 2020-12 JSON Schema of recordings. */
export function recordingJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(runRecordingSchema);
  return {
    $schema,
    $id: RECORDING_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine run recording, format v${RECORDING_VERSION}`,
    ...rest,
  };
}

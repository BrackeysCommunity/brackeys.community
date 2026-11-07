import { z } from "zod";

import { ENGINE_PREDICATES, type Registry } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { schemaIdFor, toJsonSchema } from "./json-schema";

/** The input-script format version, the `v` every script carries. */
export const INPUT_SCRIPT_VERSION = 1;

/** A run ends as `timeout` after this many ticks unless the script sets `maxTicks`: 30 s. */
export const DEFAULT_SCRIPT_MAX_TICKS = 1800;
/** The longest run a script may ask for: 10 minutes at 60 Hz. */
export const MAX_SCRIPT_TICKS = 36_000;
/** An `until` step gives up after this many ticks unless it sets `max`. */
export const DEFAULT_UNTIL_MAX = 600;

const ticks = (description: string) =>
  z.number().int().min(1).max(MAX_SCRIPT_TICKS).describe(description);

function buildInputScriptSchemas(registry: Registry) {
  const names = registry.actionNames;
  const action = (names.length > 0 ? z.enum(names as [string, ...string[]]) : z.never())
    .describe(
      names.length > 0
        ? `An action the game declares: ${names.join(", ")}.`
        : "An action name; this registry has no game, so it declares none.",
    )
    .meta({ id: "Action" });
  const held = z
    .array(action)
    .describe(
      "Every action held during the step; what the step before held and this one doesn't is released when it starts. Empty holds nothing.",
    );

  const eventMatch = z
    .union([
      z.string().min(1).describe("An event type, e.g. `sensor:enter`."),
      z
        .strictObject({
          type: z.string().min(1).describe("The event type."),
          entityId: z
            .string()
            .optional()
            .describe("The entity the event must name, e.g. the sensor for `sensor:enter`."),
          other: z
            .string()
            .optional()
            .describe("The other entity it must name, e.g. what entered the sensor."),
        })
        .describe("An event type with the entity ids it must name."),
    ])
    .describe("Holds on a tick that raised a matching event.")
    .meta({ id: "EventMatch" });

  const predicates = registry.game?.play?.predicates ?? {};
  const until = z
    .strictObject({
      event: eventMatch.optional(),
      tick: z
        .number()
        .int()
        .min(0)
        .max(MAX_SCRIPT_TICKS)
        .optional()
        .describe("Holds once this absolute tick (from 0) is reached or passed."),
      ...Object.fromEntries(
        Object.entries(predicates).map(([name, p]) => [
          name,
          p.arg.optional().describe(p.description),
        ]),
      ),
    })
    .refine((u) => Object.values(u).some((v) => v !== undefined), {
      message: "an until clause needs at least one predicate",
    })
    .meta({ minProperties: 1 })
    .describe(
      `Ends the step on the first tick where every key holds (AND), checked after each tick, so the step runs at least one tick. Predicates: ${[...ENGINE_PREDICATES, ...Object.keys(predicates)].join(", ")}.`,
    )
    .meta({ id: "Until" });

  const holdFor = z
    .strictObject({ hold: held, for: ticks("Hold for this many ticks (60 a second).") })
    .describe("Hold actions for a fixed number of ticks.");
  const holdForMs = z
    .strictObject({
      hold: held,
      forMs: z
        .number()
        .positive()
        .max((MAX_SCRIPT_TICKS * 1000) / 60)
        .describe("Hold for this many milliseconds, rounded to whole 60 Hz ticks (at least one)."),
    })
    .describe("Hold actions for a duration in milliseconds.");
  const holdUntil = z
    .strictObject({
      hold: held,
      until,
      max: ticks(
        `Give up waiting after this many ticks and go on to the next step (default ${DEFAULT_UNTIL_MAX}).`,
      ).optional(),
    })
    .describe("Hold actions until a condition holds, capped by `max` ticks.");
  const press = z
    .strictObject({
      press: z.union([action, z.array(action).min(1)]).describe("The action or actions to press."),
    })
    .describe(
      "Press for one tick: the actions go down at the step's tick and up at the next. Nothing else is held.",
    );
  const wait = z
    .strictObject({ wait: ticks("Hold nothing for this many ticks.") })
    .describe("Release everything for a number of ticks.");

  const step = z
    .union([holdFor, holdForMs, holdUntil, press, wait])
    .describe("One step: `hold` with exactly one of `for`, `forMs` or `until`; `press`; or `wait`.")
    .meta({ id: "Step" });

  const options = registry.game?.play?.options;
  const header = {
    $schema: z.string().optional().describe("The input-script JSON Schema this file follows."),
    v: z.literal(INPUT_SCRIPT_VERSION).describe("Input-script format version."),
    scene: z
      .string()
      .optional()
      .describe("The scene this script was written for; a run against another scene is refused."),
    at: z
      .tuple([
        z.number().describe("x in world pixels."),
        z.number().describe("y in world pixels; y is down."),
      ])
      .optional()
      .describe(
        "Play from here instead of the game's spawn, cast down onto the first surface below; refused inside a solid.",
      ),
    timeOffsetMs: z
      .number()
      .min(0)
      .optional()
      .describe("Advance time-driven entities (followers) by this much before tick 0."),
    ...(options
      ? {
          game: options
            .optional()
            .describe("The game's play options, as its `play.options` schema defines them."),
        }
      : {}),
    maxTicks: ticks(
      `The run ends as \`timeout\` after this many ticks (default ${DEFAULT_SCRIPT_MAX_TICKS}, 30 s).`,
    ).optional(),
  };

  const script = z
    .strictObject({
      ...header,
      steps: z.array(step).min(1).describe("The steps, played in order from tick 0."),
    })
    .describe(
      "A headless playtest: steps of held actions at 60 ticks a second. The run ends when the game's outcome hook decides, " +
        "when the steps run out (`script-end`), at `maxTicks` (`timeout`), or `stuck` (a movement action held with the focus " +
        "moving under 4 px in 120 ticks).",
    );

  /** The script with its steps unchecked, so each step can be checked by its own shape. */
  const head = z.strictObject({ ...header, steps: z.array(z.unknown()).min(1) });

  return { script, head, steps: { holdFor, holdForMs, holdUntil, press, wait }, until };
}

export type InputScriptSchemas = ReturnType<typeof buildInputScriptSchemas>;

const built = new WeakMap<Registry, InputScriptSchemas>();

/** The input-script schemas for `registry`, built once per registry. */
export function inputScriptSchemasFor(registry: Registry): InputScriptSchemas {
  let schemas = built.get(registry);
  if (!schemas) {
    schemas = buildInputScriptSchemas(registry);
    built.set(registry, schemas);
  }
  return schemas;
}

/** An input script for `registry`'s game: its actions, `until` predicates and play options. */
export function inputScriptSchemaFor(registry: Registry): InputScriptSchemas["script"] {
  return inputScriptSchemasFor(registry).script;
}

/** `urn:jams-engine:input-script:v1`, or `urn:jams-engine:input-script:<game>:v1`. */
export function inputScriptSchemaId(registry: Registry): string {
  return schemaIdFor(registry, "input-script", INPUT_SCRIPT_VERSION);
}

/** The draft 2020-12 JSON Schema of input scripts for `registry`. */
export function inputScriptJsonSchema(registry: Registry): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(inputScriptSchemaFor(registry));
  const of = registry.game ? ` for ${registry.id}` : "";
  return {
    $schema,
    $id: inputScriptSchemaId(registry),
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine input script${of}, format v${INPUT_SCRIPT_VERSION}`,
    ...rest,
  };
}

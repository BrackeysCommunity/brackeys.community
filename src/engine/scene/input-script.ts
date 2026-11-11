import { z } from "zod";

import { resolveTime } from "../game/time";
import {
  ENGINE_PREDICATES,
  type EntitySelector,
  type GameCommand,
  type Registry,
} from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { closest } from "./did-you-mean";
import { schemaIdFor, toJsonSchema } from "./json-schema";

/** The input-script format version, the `v` every script carries. */
export const INPUT_SCRIPT_VERSION = 1;

/** A run ends as `timeout` after this many simulated ticks unless the script sets `maxTicks`. */
export const DEFAULT_SCRIPT_MAX_TICKS = 1800;
/** The longest run, and the longest step, a script may ask for, in ticks. */
export const MAX_SCRIPT_TICKS = 36_000;
/** An `until` step gives up after this many ticks unless it sets `max`. */
export const DEFAULT_UNTIL_MAX = 600;

const ticks = (description: string) =>
  z.number().int().min(1).max(MAX_SCRIPT_TICKS).describe(description);

/** `ticks` at `rate` as seconds, e.g. `30 s`. */
const seconds = (ticks: number, rate: number) => `${Math.round((ticks / rate) * 100) / 100} s`;

/** The `@elapsed` command for `ms` away, clamped to the game's `catchUp.maxMs`. */
export function elapsedCommand(ms: number, catchUp: { maxMs: number }): GameCommand {
  return { name: "@elapsed", args: { ms: Math.floor(Math.min(ms, catchUp.maxMs)) } };
}

/** The `exists` predicate: an id, holding while it exists and is enabled; `enabled: false` holds for a disabled one too. */
export type ExistsMatch = string | { id: string; enabled?: false };

/** The `count` predicate: an entity selector, and the bounds the number it matches must keep. */
export type CountMatch = EntitySelector & { min?: number; max?: number; eq?: number };

export type CheckedCommand =
  | { ok: true; command: GameCommand }
  | { ok: false; at: "name" | "args"; message: string };

/**
 * Checks a command against `registry`: a known name (an unknown one gets a
 * "did you mean"), and `args` its schema parses. The checked command carries
 * the parsed args, and no `args` key for a command that takes none.
 */
export function checkCommand(
  registry: Registry,
  command: GameCommand,
  names: readonly string[] = registry.commandNames,
): CheckedCommand {
  const { name, args } = command;
  const def = names.includes(name) ? registry.commands.get(name) : undefined;
  if (!def) {
    const guess = closest(name, names);
    const known = names.length > 0 ? names.join(", ") : "none";
    return {
      ok: false,
      at: "name",
      message: `unknown command ${JSON.stringify(name)}${guess ? `; did you mean "${guess}"?` : ""} (commands: ${known})`,
    };
  }
  if (!def.args) {
    return args === undefined
      ? { ok: true, command: { name } }
      : { ok: false, at: "args", message: `${name} takes no args` };
  }
  const parsed = def.args.safeParse(args);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) =>
      i.path.length > 0 ? `${i.path.map(String).join(".")}: ${i.message}` : i.message,
    );
    return { ok: false, at: "args", message: `bad args for ${name}: ${problems.join("; ")}` };
  }
  return {
    ok: true,
    command: parsed.data === undefined ? { name } : { name, args: parsed.data },
  };
}

const NO_CATCH_UP = "elapse needs the game's time.catchUp, and this game has none";

/** The commands a script's `command` step may send: the game's own, not the engine's `@` ones. */
export function scriptCommandNames(registry: Registry): string[] {
  return registry.commandNames.filter((n) => !n.startsWith("@"));
}

const COUNT_BOUNDS = ["min", "max", "eq"] as const;

/** The engine's `exists` and `count` predicates, over `registry`'s entity types. */
function worldPredicates(registry: Registry) {
  const names = registry.typeNames;
  const typeName = (names.length > 0 ? z.enum(names as [string, ...string[]]) : z.never())
    .describe(
      names.length > 0
        ? `An entity type: ${names.join(", ")}.`
        : "An entity type; this registry has none.",
    )
    .meta({ id: "EntityType" });
  /** "unknown entity type" with a guess, for the first name in `input` the registry lacks. */
  const unknownType = (input: unknown): string | undefined => {
    const list = Array.isArray(input) ? (input as unknown[]) : [input];
    const bad = list.find((t) => typeof t === "string" && !names.includes(t));
    if (typeof bad !== "string") return undefined;
    const guess = closest(bad, names);
    return `unknown entity type ${JSON.stringify(bad)}${guess ? `; did you mean "${guess}"?` : ""}`;
  };
  const bound = (description: string) => z.number().int().min(0).optional().describe(description);

  const exists: z.ZodType<ExistsMatch> = z
    .union([
      z.string().min(1).describe("An entity id; holds while it exists and is enabled."),
      z
        .strictObject({
          id: z.string().min(1).describe("The entity id, e.g. `boss#1`."),
          enabled: z
            .literal(false)
            .optional()
            .describe("False holds while the entity exists, enabled or not."),
        })
        .describe("An entity id, and whether a disabled entity counts."),
    ])
    .describe(
      "Holds while an entity exists and is enabled, spawned ids (`boss#1`) included; it fails once the entity is destroyed.",
    )
    .meta({ id: "ExistsMatch" });

  const count = z
    .strictObject({
      type: z
        .union([typeName, z.array(typeName).min(1)], { error: (iss) => unknownType(iss.input) })
        .optional()
        .describe("Only entities of this type, or of any of these."),
      tag: z.string().min(1).optional().describe("Only entities with this tag."),
      enabled: z
        .boolean()
        .optional()
        .describe("Default true: only enabled entities; false counts disabled ones too."),
      min: bound("Holds when at least this many match."),
      max: bound("Holds when at most this many match."),
      eq: bound("Holds when exactly this many match."),
    })
    .superRefine((c, ctx) => {
      if (COUNT_BOUNDS.every((k) => c[k] === undefined)) {
        ctx.addIssue({ code: "custom", message: "a count needs min, max or eq" });
      } else if (c.eq !== undefined && (c.min !== undefined || c.max !== undefined)) {
        ctx.addIssue({
          code: "custom",
          path: ["eq"],
          message: "eq goes alone, without min or max",
        });
      } else if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
        ctx.addIssue({
          code: "custom",
          path: ["min"],
          message: `min ${c.min} is over max ${c.max}`,
        });
      }
    })
    .meta({ anyOf: COUNT_BOUNDS.map((k) => ({ required: [k] })) })
    .describe(
      "Holds while the number of entities matching the selector (type, tag, enabled) keeps the bounds: `min`, `max` (both for a range) or `eq`.",
    )
    .meta({ id: "CountMatch" });
  const checked: z.ZodType<CountMatch> = count;

  return { exists, count: checked, countKeys: Object.keys(count.shape) };
}

function buildInputScriptSchemas(registry: Registry) {
  const names = registry.actionNames;
  const { rate, kind, catchUp } = resolveTime({ game: registry.time });
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

  const { exists, count, countKeys } = worldPredicates(registry);

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
      exists: exists.optional(),
      count: count.optional(),
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
    .strictObject({ hold: held, for: ticks(`Hold for this many ticks (${rate} a second).`) })
    .describe("Hold actions for a fixed number of ticks.");
  const holdForMs = z
    .strictObject({
      hold: held,
      forMs: z
        .number()
        .positive()
        .max((MAX_SCRIPT_TICKS * 1000) / rate)
        .describe(
          `Hold for this many milliseconds, rounded to whole ${rate} Hz ticks (at least one).`,
        ),
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

  const commandNames = scriptCommandNames(registry);
  const command = z
    .strictObject({
      command: (commandNames.length > 0
        ? z.enum(commandNames as [string, ...string[]])
        : z.never()
      ).describe(
        commandNames.length > 0
          ? `A command the game declares: ${commandNames
              .map((n) => `${n} (${registry.commands.get(n)!.description})`)
              .join("; ")}.`
          : "A command name; this registry's game declares none.",
      ),
      args: z
        .unknown()
        .optional()
        .describe("The command's arguments, checked by its `args` schema; omit for none."),
    })
    .superRefine((step, ctx) => {
      const checked = checkCommand(registry, { name: step.command, args: step.args }, commandNames);
      if (!checked.ok)
        ctx.addIssue({
          code: "custom",
          path: [checked.at === "name" ? "command" : "args"],
          message: checked.message,
        });
    })
    .describe(
      "Send a command for one slot, still holding what the hold step before it held (nothing after a press or wait). It wakes a turns or event game.",
    );
  const elapse = z
    .strictObject({
      elapse: z
        .number()
        .positive()
        .describe(
          catchUp
            ? `Milliseconds away, sent as \`@elapsed\` and clamped to ${catchUp.maxMs}.`
            : "Milliseconds away, sent as `@elapsed`; this game has no `time.catchUp`, so it refuses the step.",
        ),
    })
    .superRefine((_step, ctx) => {
      if (!catchUp) ctx.addIssue({ code: "custom", path: ["elapse"], message: NO_CATCH_UP });
    })
    .describe(
      "Report wall time away for one slot, as `@elapsed`, still holding what the hold step before it held (nothing after a press or wait). It wakes every game.",
    );

  const step = z
    .union([holdFor, holdForMs, holdUntil, press, wait, command, elapse])
    .describe(
      "One step: `hold` with exactly one of `for`, `forMs` or `until`; `press`; `wait`; `command`; or `elapse`.",
    )
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
        "Play from here instead of the game's spawn, cast along the game's spawn direction (gravity by default) onto the first surface it meets; refused inside a solid.",
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
    seed: z
      .union([z.number(), z.string()])
      .optional()
      .describe(
        "Seeds the game's `ctx.random` for the run; omitted, the default for the game and scene, the same every run.",
      ),
    maxTicks: ticks(
      `The run ends as \`timeout\` after this many ticks (default ${DEFAULT_SCRIPT_MAX_TICKS}, ${seconds(DEFAULT_SCRIPT_MAX_TICKS, rate)}).`,
    ).optional(),
  };

  const script = z
    .strictObject({
      ...header,
      steps: z.array(step).min(1).describe("The steps, played in order from tick 0."),
    })
    .describe(
      `A headless playtest: steps of held actions at ${rate} ticks a second. The run ends when the game's outcome hook decides, ` +
        "when the steps run out (`script-end`), at `maxTicks` (`timeout`), or `stuck` (a movement action held with the focus " +
        "moving under 4 px in 120 ticks)." +
        (kind === "fixed"
          ? ""
          : ` Step lengths count slots: in this ${kind} game a slot nothing wakes while it isn't busy simulates no tick.`),
    );

  /** The script with its steps unchecked, so each step can be checked by its own shape. */
  const head = z.strictObject({ ...header, steps: z.array(z.unknown()).min(1) });

  return {
    script,
    head,
    steps: { holdFor, holdForMs, holdUntil, press, wait, command, elapse },
    until,
    exists,
    count,
    /** The keys a `count` predicate takes, for "did you mean". */
    countKeys,
  };
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

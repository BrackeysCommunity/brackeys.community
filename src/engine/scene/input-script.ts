import { z } from "zod";

import {
  bindingProblems,
  isUiAction,
  playersProblems,
  resolvePlayers,
  seatLimitOf,
  UI_ACTION_KEYWORD,
} from "../game/input-bindings";
import { POINTER_BUTTONS, type PointerButton } from "../game/input-codes";
import { resolveTime } from "../game/time";
import {
  ENGINE_PREDICATES,
  type EntitySelector,
  type GameCommand,
  type PlayersDef,
  type Registry,
} from "../game/types";
import { pxPerMetreOf, scaleLengths } from "../game/units";
import type { InputScriptV2, ScriptIssue } from "../headless/playtest-types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { deviceIdSchema } from "./device-id";
import { closest } from "./did-you-mean";
import { jsonPointer, lineAt, pointerSegments, unitsRefusal } from "./issues";
import { schemaIdFor, toJsonSchema } from "./json-schema";
import { migrate, type MigrateEnv, type Migration } from "./migrate";
import { pointerLines } from "./parse";
import type { Pt } from "./types";

/** The input-script format version, the `v` every script carries. */
export const INPUT_SCRIPT_VERSION = 2;

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

/** Axis values and vector pairs held for a step, by action name. */
export type AnalogSet = Readonly<Record<string, number | Pt>>;

/** A pointer step: at `at`, pressing or releasing a button, and with `drag`, moving linearly to it over the step. */
export type ScriptPointer = {
  at: Pt;
  press?: PointerButton;
  release?: PointerButton;
  drag?: Pt;
};

/**
 * Why a pointer step can't play as written: `drag` and `release` land over a
 * fixed length, so an `until` step refuses them, and a button pressed and
 * released on a step's only slot shows neither. `slots` is the step's length,
 * or "until". The schema judges the lengths it can see (`for`, one slot,
 * `until`); the compiler judges `forMs` once it has the run's rate.
 */
export function pointerStepProblem(
  pointer: { press?: PointerButton; release?: PointerButton; drag?: unknown },
  slots: number | "until",
): { key?: "drag" | "release"; message: string } | null {
  if (slots === "until") {
    const key = (["drag", "release"] as const).find((k) => pointer[k] !== undefined);
    if (!key) return null;
    return {
      key,
      message: `${key === "drag" ? "a drag moves" : "a release lands"} over a fixed length; give the step for or forMs instead of until`,
    };
  }
  if (pointer.press !== undefined && pointer.press === pointer.release && slots === 1)
    return {
      message: `pressing and releasing ${pointer.press} on one slot shows neither; give the step for: 2 or more`,
    };
  return null;
}

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

/** Why a script can't hold, press or set a UI-only action. */
export const UI_ACTION_HINT = "UI actions don't reach the simulation; send a command";

/**
 * A script naming `name` in a hold, press or set, refused when it is a
 * UI-only action (`isUiAction`): `binding-unknown`, with the hint. Null for
 * any other name, which the action enum judges.
 */
export function uiActionScriptProblem(
  registry: Registry,
  name: string,
): { message: string; hint: string } | null {
  if (!isUiAction(registry, name)) return null;
  return {
    message: `${JSON.stringify(name)} is a UI-only action, which a script can't drive (binding-unknown)`,
    hint: UI_ACTION_HINT,
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

/** A point in world metres, `[x, y]`, y down. */
export function worldPointSchema() {
  return z
    .tuple([
      z.number().describe("x in world metres.").meta({ unit: "m" }),
      z.number().describe("y in world metres; y is down.").meta({ unit: "m" }),
    ])
    .meta({ unit: "m" });
}

const deviceSchema = deviceIdSchema.meta({ id: "Device" });

/**
 * The seats a run has, and so the seats a script drives unless it sets
 * `players`: the project input map's `players` when it has them, else the
 * game's `input.players`, else one. The one rule every script reader
 * (schema, compiler, playtest, checks, the CLI) and the runtime agree on.
 */
export function scriptSeatLimit(registry: Registry, players?: PlayersDef | null): number {
  return seatLimitOf(resolvePlayers(players ? { players } : null, registry.game));
}

/**
 * A script's step lists and seats: one of `steps` or `tracks`; seats within
 * the script's `players`, else `scriptSeatLimit` of the map's `players` and
 * the game; one track per seat.
 */
export function scriptShapeIssues(
  script: { players?: unknown; steps?: unknown; tracks?: unknown },
  registry: Registry,
  players?: PlayersDef | null,
): ScriptIssue[] {
  return shapeIssues(script, scriptSeatLimit(registry, players));
}

function shapeIssues(
  script: { players?: unknown; steps?: unknown; tracks?: unknown },
  runSeats: number,
): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const hasSteps = script.steps !== undefined;
  const hasTracks = script.tracks !== undefined;
  if (hasSteps === hasTracks)
    issues.push({
      path: hasSteps ? "/tracks" : "",
      message: hasSteps
        ? "a script has `steps` or `tracks`, not both"
        : "a script needs `steps` (seat 0's) or `tracks` (one per seat)",
    });
  let seats = runSeats;
  if (script.players !== undefined) {
    const problem = playersProblems({ max: script.players as number, join: "auto" }).at(0);
    if (problem)
      issues.push({
        path: "/players",
        message: problem.message.replace("players.max", "players"),
        ...(problem.expected !== undefined && { expected: problem.expected }),
        ...(problem.got !== undefined && { got: problem.got }),
      });
    else seats = script.players as number;
  }
  if (!Array.isArray(script.tracks)) return issues;
  const seen = new Map<number, number>();
  script.tracks.forEach((track, i) => {
    const player = (track as { player?: unknown } | null)?.player;
    if (typeof player !== "number" || !Number.isInteger(player) || player < 0) return;
    const problem = bindingProblems(
      { device: "key", code: "Space", player },
      { kind: "button", max: seats },
    ).find((p) => p.code === "player-unknown");
    if (problem)
      issues.push({
        path: jsonPointer(["tracks", i, "player"]),
        message: problem.message,
        ...(problem.expected !== undefined && { expected: problem.expected }),
        ...(problem.got !== undefined && { got: problem.got }),
        hint: "Raise the script's `players` (or the input map's), or drive a seat the run has.",
      });
    const first = seen.get(player);
    if (first !== undefined)
      issues.push({
        path: jsonPointer(["tracks", i, "player"]),
        message: `tracks ${first} and ${i} both drive seat ${player}; a seat has one track`,
        hint: `Move the steps of track ${i} into track ${first}.`,
      });
    else seen.set(player, i);
  });
  return issues;
}

function addIssues(ctx: z.RefinementCtx, issues: readonly ScriptIssue[]): void {
  for (const issue of issues)
    ctx.addIssue({ code: "custom", path: pointerSegments(issue.path), message: issue.message });
}

/** Refuses a UI-only action where a script names one, with `uiActionScriptProblem`'s message and hint. */
function refuseUiAction(registry: Registry) {
  return (name: string, ctx: z.RefinementCtx) => {
    const problem = uiActionScriptProblem(registry, name);
    if (problem)
      ctx.addIssue({
        code: "custom",
        message: problem.message,
        params: { hint: problem.hint },
        input: name,
      });
  };
}

/**
 * The script's action enum. With UI-only actions, they form their own
 * branch marked `x-ui: true` so the schema shows them, and parsing refuses
 * them.
 */
function actionSchema(registry: Registry): z.ZodType<string> {
  const names = registry.actionNames;
  if (names.length === 0)
    return z.never().describe("An action name; this registry has no game, so it declares none.");
  const enumOf = (list: readonly string[]) => z.enum(list as [string, ...string[]]);
  const ui = names.filter((n) => isUiAction(registry, n));
  if (ui.length === 0)
    return enumOf(names).describe(`An action the game declares: ${names.join(", ")}.`);
  const sim = names.filter((n) => !isUiAction(registry, n));
  const uiEnum = enumOf(ui)
    .meta({ [UI_ACTION_KEYWORD]: true })
    .describe(`UI-only actions, refused in a script: ${UI_ACTION_HINT}.`);
  const named =
    sim.length > 0 ? z.union([enumOf(sim).describe("The simulation's actions."), uiEnum]) : uiEnum;
  return named
    .superRefine(refuseUiAction(registry))
    .describe(
      `An action the game declares: ${sim.length > 0 ? sim.join(", ") : "none the simulation reads"}; ${ui.join(", ")} ${ui.length === 1 ? "is" : "are"} UI-only (x-ui), which a script can't drive.`,
    );
}

function buildInputScriptSchemas(registry: Registry, seats: number) {
  const { rate, kind, catchUp } = resolveTime({ game: registry.time });
  const action = actionSchema(registry).meta({ id: "Action" });
  const held = z
    .array(action)
    .describe(
      "Every action held during the step; what the step before held and this one doesn't is released when it starts. Empty holds nothing.",
    );

  const unitValue = (description: string) => z.number().min(-1).max(1).describe(description);
  const analogActions = registry.actions.filter((a) => a.kind === "axis" || a.kind === "vector");
  const analogValue = (a: (typeof analogActions)[number]) => {
    const value =
      a.kind === "axis"
        ? unitValue(`${a.description} An axis value, −1…1.`)
        : z
            .tuple([unitValue("x, −1…1."), unitValue("y, −1…1; y is down.")])
            .refine(([x, y]) => Math.sqrt(x * x + y * y) <= 1 + 1e-9, {
              message: "a vector lies in the unit disc: x² + y² is at most 1",
            })
            .describe(`${a.description} A vector \`[x, y]\` in the unit disc.`);
    if (!isUiAction(registry, a.action)) return value.optional();
    const refuse = refuseUiAction(registry);
    return value
      .superRefine((_v, ctx) => refuse(a.action, ctx))
      .meta({ [UI_ACTION_KEYWORD]: true })
      .describe(`${a.description} UI-only, refused in a script: ${UI_ACTION_HINT}.`)
      .optional();
  };
  const analog = z
    .strictObject(Object.fromEntries(analogActions.map((a) => [a.action, analogValue(a)])))
    .refine((s) => Object.values(s).some((v) => v !== undefined), {
      message: "set names at least one axis or vector action",
    })
    .meta({ minProperties: 1 })
    .describe(
      analogActions.length > 0
        ? `Axis values and vector pairs held for the step, by action: ${analogActions.map((a) => `${a.action} (${a.kind})`).join(", ")}. An action the step leaves out rests at 0.`
        : "Axis values and vector pairs held for the step, by action; this game declares no axis or vector actions.",
    )
    .meta({ id: "AnalogSet" });

  const pointerButton = z
    .enum(POINTER_BUTTONS)
    .describe(`A pointer button: ${POINTER_BUTTONS.join(", ")}.`);
  const pointerSpec = z
    .strictObject({
      at: worldPointSchema().describe(
        "Where the pointer is when the step starts, in world metres.",
      ),
      press: pointerButton
        .optional()
        .describe("A button that goes down when the step starts and stays down until a release."),
      release: pointerButton.optional().describe("A button that lets go when the step ends."),
      drag: worldPointSchema()
        .optional()
        .describe(
          "Moves the pointer linearly from `at` to here over the step's length, reaching it on the step's last slot.",
        ),
    })
    .describe("The seat's pointer: its position, a button pressed or released, and a drag.")
    .meta({ id: "ScriptPointer" });

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

  const forTicks = ticks(`Run for this many ticks (${rate} a second).`);
  const forMs = z
    .number()
    .positive()
    .max((MAX_SCRIPT_TICKS * 1000) / rate)
    .describe(`Run for this many milliseconds, rounded to whole ${rate} Hz ticks (at least one).`);
  const untilMax = ticks(
    `Give up waiting after this many ticks and go on to the next step (default ${DEFAULT_UNTIL_MAX}).`,
  ).optional();
  /** A step's three timed forms: `for` ticks, `forMs` milliseconds, or `until` capped by `max`. */
  const timed = <S extends z.ZodRawShape>(base: S, what: string) => ({
    for: z
      .strictObject({ ...base, for: forTicks })
      .describe(`${what} for a fixed number of ticks.`),
    forMs: z.strictObject({ ...base, forMs }).describe(`${what} for a duration in milliseconds.`),
    until: z
      .strictObject({ ...base, until, max: untilMax })
      .describe(`${what} until a condition holds, capped by \`max\` ticks.`),
  });

  const hold = timed(
    {
      hold: held,
      set: analog.optional().describe("Axis values and vector pairs held beside the actions."),
    },
    "Hold actions, and with `set` analog values,",
  );
  const set = timed({ set: analog }, "Hold analog values");
  const pointerTimed = timed({ pointer: pointerSpec }, "Drive the pointer");
  const pointerRefine =
    (slots: (step: Record<string, unknown>) => number | "until") =>
    (step: { pointer: ScriptPointer } & Record<string, unknown>, ctx: z.RefinementCtx) => {
      const problem = pointerStepProblem(step.pointer, slots(step));
      if (problem)
        ctx.addIssue({
          code: "custom",
          path: problem.key ? ["pointer", problem.key] : ["pointer"],
          message: problem.message,
        });
    };
  const pointer = {
    for: pointerTimed.for.superRefine(pointerRefine((step) => step.for as number)),
    forMs: pointerTimed.forMs,
    until: pointerTimed.until.superRefine(pointerRefine(() => "until")),
  };
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
  const pointerOnce = z
    .strictObject({ pointer: pointerSpec })
    .superRefine(pointerRefine(() => 1))
    .describe("Drive the pointer for one slot.");

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
      "Send a command from the track's seat for one slot, still holding what the hold step before it held (nothing after a press or wait). It wakes a turns or event game.",
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
  const join = z
    .strictObject({ join: deviceSchema.describe("The device that takes the track's seat.") })
    .describe("A device joins the track's seat, for one slot; it leaves the seat it held before.");
  const leave = z
    .strictObject({ leave: deviceSchema.describe("The device the track's seat gives up.") })
    .describe("The track's seat gives up a device, for one slot.");

  const steps = {
    holdFor: hold.for,
    holdForMs: hold.forMs,
    holdUntil: hold.until,
    setFor: set.for,
    setForMs: set.forMs,
    setUntil: set.until,
    pointer: pointerOnce,
    pointerFor: pointer.for,
    pointerForMs: pointer.forMs,
    pointerUntil: pointer.until,
    press,
    wait,
    command,
    elapse,
    join,
    leave,
  };
  const step = z
    .union([
      hold.for,
      hold.forMs,
      hold.until,
      set.for,
      set.forMs,
      set.until,
      pointerOnce,
      pointer.for,
      pointer.forMs,
      pointer.until,
      press,
      wait,
      command,
      elapse,
      join,
      leave,
    ])
    .describe(
      "One step: `hold` (with `set` beside it or not) or `set`, with exactly one of `for`, `forMs` or `until`; `pointer`, alone for one slot or with one of them; `press`; `wait`; `command`; `elapse`; `join`; or `leave`.",
    )
    .meta({ id: "Step" });

  const track = z
    .strictObject({
      player: z.number().int().min(0).describe("The seat these steps drive, from 0."),
      steps: z.array(step).min(1).describe("The seat's steps, played in order from tick 0."),
    })
    .describe("One seat's steps; every track runs at once from tick 0, each with its own `until`s.")
    .meta({ id: "Track" });
  const trackHead = z.strictObject({
    player: track.shape.player,
    steps: z.array(z.unknown()).min(1),
  });

  const options = registry.game?.play?.options;
  const header = {
    $schema: z.string().optional().describe("The input-script JSON Schema this file follows."),
    v: z.literal(INPUT_SCRIPT_VERSION).describe("Input-script format version."),
    scene: z
      .string()
      .optional()
      .describe("The scene this script was written for; a run against another scene is refused."),
    at: worldPointSchema()
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
    players: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "The seats the script drives, 1 to 8; default the run's: the project input map's `players.max`, else the game's `input.players.max`, else 1.",
      ),
    maxTicks: ticks(
      `The run ends as \`timeout\` after this many ticks (default ${DEFAULT_SCRIPT_MAX_TICKS}, ${seconds(DEFAULT_SCRIPT_MAX_TICKS, rate)}).`,
    ).optional(),
  };
  const oneOfLists = { oneOf: [{ required: ["steps"] }, { required: ["tracks"] }] };
  const shapeRefine = (s: Record<string, unknown>, ctx: z.RefinementCtx) =>
    addIssues(ctx, shapeIssues(s, seats));

  const script = z
    .strictObject({
      ...header,
      steps: z
        .array(step)
        .min(1)
        .optional()
        .describe("Seat 0's steps, played in order from tick 0; a script has these or `tracks`."),
      tracks: z
        .array(track)
        .min(1)
        .optional()
        .describe("One track of steps per seat, all run at once from tick 0; or `steps`."),
    })
    .superRefine(shapeRefine)
    .meta(oneOfLists)
    .describe(
      `A headless playtest: steps of held actions, analog values, pointer moves and seat changes at ${rate} ticks a second, ` +
        "as `steps` for seat 0 or as `tracks`, one per seat, run at once. The run ends when the game's outcome hook decides, " +
        "when every track's steps ran out (`script-end`), at `maxTicks` (`timeout`), or `stuck` (a movement action held with the focus " +
        "moving under 0.04 m in 120 ticks)." +
        (kind === "fixed"
          ? ""
          : ` Step lengths count slots: in this ${kind} game a slot nothing wakes while it isn't busy simulates no tick.`),
    );

  /** The script with its steps unchecked, so each step can be checked by its own shape. */
  const head = z
    .strictObject({
      ...header,
      steps: z.array(z.unknown()).min(1).optional(),
      tracks: z.array(z.unknown()).min(1).optional(),
    })
    .superRefine(shapeRefine);

  return {
    script,
    head,
    /** A track with its steps unchecked. */
    trackHead,
    track,
    steps,
    analog,
    pointer: pointerSpec,
    until,
    exists,
    count,
    /** The keys a `count` predicate takes, for "did you mean". */
    countKeys,
  };
}

export type InputScriptSchemas = ReturnType<typeof buildInputScriptSchemas>;

const built = new WeakMap<Registry, Map<number, InputScriptSchemas>>();

/**
 * The input-script schemas for `registry`, built once per registry and seat
 * limit; `players` is the project input map's, which sets the seats tracks
 * may drive over the game's (`scriptSeatLimit`).
 */
export function inputScriptSchemasFor(
  registry: Registry,
  players?: PlayersDef | null,
): InputScriptSchemas {
  const seats = scriptSeatLimit(registry, players);
  let bySeats = built.get(registry);
  if (!bySeats) {
    bySeats = new Map();
    built.set(registry, bySeats);
  }
  let schemas = bySeats.get(seats);
  if (!schemas) {
    schemas = buildInputScriptSchemas(registry, seats);
    bySeats.set(seats, schemas);
  }
  return schemas;
}

/** An input script for `registry`'s game: its actions, `until` predicates, play options and seats. */
export function inputScriptSchemaFor(
  registry: Registry,
  players?: PlayersDef | null,
): InputScriptSchemas["script"] {
  return inputScriptSchemasFor(registry, players).script;
}

/** `urn:jams-engine:input-script:v2`, or `urn:jams-engine:input-script:<game>:v2`. */
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * v1 → v2: `v` becomes 2 and lengths become metres. The header's `at`, the
 * game's play options, every `until` predicate and every command's args are
 * divided by the game's px per metre wherever their schema declares a length
 * unit; steps keep their v1 form, seat 0's track.
 */
function inputScriptV1ToV2(raw: unknown, env: MigrateEnv): unknown {
  const registry = env.registry;
  if (!registry) return unitsRefusal("input script");
  const ppm = pxPerMetreOf(registry);
  const doc = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...doc, v: 2 };
  if (doc.at !== undefined) out.at = scaleLengths(doc.at, worldPointSchema(), ppm);
  const options = registry.game?.play?.options;
  if (options && doc.game !== undefined) out.game = scaleLengths(doc.game, options, ppm);
  if (Array.isArray(doc.steps)) {
    const { until } = inputScriptSchemasFor(registry);
    out.steps = doc.steps.map((step) => {
      if (!isRecord(step)) return step;
      const lifted = { ...step };
      if (step.until !== undefined) lifted.until = scaleLengths(step.until, until, ppm);
      const args =
        typeof step.command === "string" ? registry.commands.get(step.command)?.args : undefined;
      if (args && step.args !== undefined) lifted.args = scaleLengths(step.args, args, ppm);
      return lifted;
    });
  }
  return out;
}

/** `INPUT_SCRIPT_MIGRATIONS[n]` lifts a v`n` input script to v`n + 1`; every reader goes through them. */
export const INPUT_SCRIPT_MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  1: inputScriptV1ToV2,
});

export type MigrateInputScriptResult =
  | { ok: true; script: unknown; from: number }
  | { ok: false; issue: ScriptIssue };

/**
 * Lifts an older input script to the current format for `registry`'s game
 * (its px per metre and field units). A value with no usable `v`, or one at
 * or past the current version, comes back unchanged for the schema to judge.
 */
export function migrateInputScript(raw: unknown, registry: Registry): MigrateInputScriptResult {
  const v = isRecord(raw) ? raw.v : undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v >= INPUT_SCRIPT_VERSION)
    return { ok: true, script: raw, from: typeof v === "number" ? v : INPUT_SCRIPT_VERSION };
  const lifted = migrate(raw, INPUT_SCRIPT_MIGRATIONS, INPUT_SCRIPT_VERSION, { registry });
  if (lifted.ok) return { ok: true, script: lifted.raw, from: lifted.from };
  const { path = "", message, expected, got, hint } = lifted.issue;
  return {
    ok: false,
    issue: {
      path,
      message,
      ...(expected !== undefined && { expected }),
      ...(got !== undefined && { got }),
      ...(hint !== undefined && { hint }),
    },
  };
}

/**
 * The message and hint of a refinement that carries one (`params.hint`), in
 * `issue` or, for a union no branch of which took the value, in a branch's
 * own issues; null when there is none.
 */
export function hintedIssue(issue: z.core.$ZodIssue): { message: string; hint: string } | null {
  const params = (issue as { params?: { hint?: unknown } }).params;
  if (typeof params?.hint === "string") return { message: issue.message, hint: params.hint };
  if (issue.code !== "invalid_union") return null;
  for (const branch of issue.errors)
    for (const inner of branch) {
      const found = hintedIssue(inner);
      if (found) return found;
    }
  return null;
}

export type ParseInputScriptResult<G = unknown> =
  | { ok: true; script: InputScriptV2<G>; migratedFrom?: number }
  | { ok: false; issues: (ScriptIssue & { line?: number })[] };

/**
 * Reads an input script, as text or a parsed value, for `registry`'s game:
 * migrated to the current format, then judged by its schema, its seats by
 * `players` (the project input map's) over the game's. Issues carry JSON
 * Pointers into the script as written, and lines when read from text.
 */
export function parseInputScript<G = unknown>(
  input: unknown,
  registry: Registry,
  players?: PlayersDef | null,
): ParseInputScriptResult<G> {
  let raw = input;
  let lines: Map<string, number> | undefined;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
      lines = pointerLines(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, issues: [{ path: "", message: `the script is not JSON: ${message}` }] };
    }
  }
  const withLine = (issue: ScriptIssue) => {
    const line = lines && lineAt(lines, issue.path);
    return line === undefined ? issue : { ...issue, line };
  };
  const lifted = migrateInputScript(raw, registry);
  if (!lifted.ok) return { ok: false, issues: [withLine(lifted.issue)] };
  const parsed = inputScriptSchemaFor(registry, players).safeParse(lifted.script);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.flatMap((issue) => {
        const path = issue.path as (string | number)[];
        if (issue.code === "unrecognized_keys")
          return issue.keys.map((key) =>
            withLine({
              path: jsonPointer([...path, key]),
              message: `unknown key ${JSON.stringify(key)}`,
              got: JSON.stringify(key),
            }),
          );
        const hinted = hintedIssue(issue);
        return [withLine({ path: jsonPointer(path), message: issue.message, ...hinted })];
      }),
    };
  const script = parsed.data as InputScriptV2<G>;
  return lifted.from < INPUT_SCRIPT_VERSION
    ? { ok: true, script, migratedFrom: lifted.from }
    : { ok: true, script };
}

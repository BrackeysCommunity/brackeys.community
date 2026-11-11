import type { z } from "zod";

import { resolveTime, ticksFor, type ResolvedTime } from "../game/time";
import type { Registry } from "../game/types";
import { closest } from "../scene/did-you-mean";
import {
  checkCommand,
  DEFAULT_SCRIPT_MAX_TICKS,
  DEFAULT_UNTIL_MAX,
  elapsedCommand,
  inputScriptSchemasFor,
  scriptCommandNames,
  type InputScriptSchemas,
} from "../scene/input-script";
import { jsonPointer } from "../scene/issues";
import { unknownActionError } from "./headless";
import type {
  CompiledInputScript,
  CompiledStep,
  CompileResult,
  InputEdge,
  PlayOptions,
  ScriptIssue,
  UntilClause,
} from "./playtest-types";

type Path = (string | number)[];

const STEP_KINDS = ["hold", "press", "wait", "command", "elapse"] as const;
const DURATIONS = ["for", "forMs", "until"] as const;
const STEP_KEYS = [...STEP_KINDS, ...DURATIONS, "max", "args"];
const KIND_LIST = "hold, press, wait, command or elapse";
const EXISTS_KEYS = ["id", "enabled"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let at = value;
  for (const key of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<PropertyKey, unknown>)[key];
  }
  return at;
}

const guessed = (word: string, candidates: readonly string[]) => {
  const guess = closest(
    word,
    candidates.filter((c) => c !== word),
  );
  return guess ? `; did you mean "${guess}"?` : "";
};

function unknownKey(path: Path, key: string, candidates: readonly string[]): ScriptIssue {
  return {
    path: jsonPointer([...path, key]),
    message: `unknown key ${JSON.stringify(key)}${guessed(key, candidates)}`,
    expected: candidates.join(" | "),
    got: JSON.stringify(key),
  };
}

function unknownAction(path: Path, action: string, registry: Registry): ScriptIssue {
  return {
    path: jsonPointer(path),
    message: unknownActionError(action, registry.actionNames)!,
    expected: registry.actionNames.map((a) => JSON.stringify(a)).join(" | "),
    got: JSON.stringify(action),
  };
}

/** The keys an object at `path` (relative to what was parsed) may have, for "did you mean". */
type KeysAt = (path: readonly PropertyKey[]) => readonly string[];

/** Zod's issues as script issues, with action names and unknown keys spelled out. */
function fromZod(
  error: z.ZodError,
  input: unknown,
  base: Path,
  registry: Registry,
  keysAt: KeysAt,
): ScriptIssue[] {
  const out: ScriptIssue[] = [];
  const actions = registry.actionNames;
  for (const issue of error.issues) {
    const rel = issue.path as (string | number)[];
    const path = [...base, ...rel];
    const value = valueAt(input, rel);
    const actionSlot = rel.includes("hold") || rel.includes("press");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) out.push(unknownKey(path, key, keysAt(rel)));
    } else if (actionSlot && typeof value === "string" && !actions.includes(value)) {
      out.push(unknownAction(path, value, registry));
    } else if (actionSlot && Array.isArray(value) && issue.code === "invalid_union") {
      const bad = value.flatMap((a, i) =>
        typeof a === "string" && !actions.includes(a)
          ? [unknownAction([...path, i], a, registry)]
          : [],
      );
      out.push(...(bad.length > 0 ? bad : [{ path: jsonPointer(path), message: issue.message }]));
    } else {
      out.push({ path: jsonPointer(path), message: issue.message });
    }
  }
  return out;
}

type ParsedStep = z.output<InputScriptSchemas["script"]>["steps"][number];

/** Picks a step's shape by its keys, so a mistake is reported against the step it was meant to be. */
function parseStep(
  raw: unknown,
  index: number,
  schemas: InputScriptSchemas,
  registry: Registry,
): { ok: true; step: ParsedStep } | { ok: false; issues: ScriptIssue[] } {
  const path: Path = ["steps", index];
  const fail = (message: string, extra: Partial<ScriptIssue> = {}) => ({
    ok: false as const,
    issues: [{ path: jsonPointer(path), message, ...extra }],
  });
  if (!isRecord(raw))
    return fail(
      "a step is an object: { hold, for | forMs | until }, { press }, { wait }, { command, args? } or { elapse }",
    );

  const unknown = Object.keys(raw).filter((k) => !STEP_KEYS.includes(k));
  if (unknown.length > 0) {
    return { ok: false, issues: unknown.map((k) => unknownKey(path, k, STEP_KEYS)) };
  }
  const kinds = STEP_KINDS.filter((k) => k in raw);
  if (kinds.length !== 1) {
    return fail(
      kinds.length === 0
        ? `a step needs one of ${KIND_LIST}`
        : `a step is one of ${KIND_LIST}, not ${kinds.join(" and ")}`,
    );
  }
  if ("args" in raw && kinds[0] !== "command") {
    return {
      ok: false,
      issues: [
        {
          path: jsonPointer([...path, "args"]),
          message: "args goes with a command step",
        },
      ],
    };
  }
  const misplaced = [...DURATIONS, "max"].find((k) => k in raw);
  if (misplaced && kinds[0] !== "hold") {
    return {
      ok: false,
      issues: [
        {
          path: jsonPointer([...path, misplaced]),
          message: `${misplaced} goes with a hold step; { "hold": [], "${misplaced === "max" ? "until" : misplaced}": … } waits holding nothing`,
        },
      ],
    };
  }
  if (kinds[0] === "command") {
    const problem = commandStepIssue(raw, path, registry);
    if (problem) return { ok: false, issues: [problem] };
  }
  let shape: z.ZodType;
  if (kinds[0] === "hold") {
    const durations = DURATIONS.filter((k) => k in raw);
    if (durations.length !== 1) {
      return fail(
        durations.length === 0
          ? "a hold step needs one of for, forMs or until"
          : `a hold step takes one of for, forMs or until, not ${durations.join(" and ")}`,
      );
    }
    if ("max" in raw && durations[0] !== "until") {
      return {
        ok: false,
        issues: [
          {
            path: jsonPointer([...path, "max"]),
            message: "max caps an until step; this step has a fixed length",
          },
        ],
      };
    }
    const { holdFor, holdForMs, holdUntil } = schemas.steps;
    shape = { for: holdFor, forMs: holdForMs, until: holdUntil }[durations[0]!];
  } else {
    shape = schemas.steps[kinds[0]!];
  }
  const parsed = shape.safeParse(raw);
  if (parsed.success) return { ok: true, step: parsed.data as ParsedStep };
  const keysAt: KeysAt = (rel) => {
    if (rel.at(-1) === "until") return registry.predicateNames;
    if (rel.at(-2) === "until" && rel.at(-1) === "count") return schemas.countKeys;
    if (rel.at(-2) === "until" && rel.at(-1) === "exists") return EXISTS_KEYS;
    return STEP_KEYS;
  };
  return { ok: false, issues: fromZod(parsed.error, raw, path, registry, keysAt) };
}

/** An unknown command (with a guess) or args its schema refuses, as one issue. */
function commandStepIssue(
  raw: Record<string, unknown>,
  path: Path,
  registry: Registry,
): ScriptIssue | null {
  const name = raw.command;
  if (typeof name !== "string") return null;
  const names = scriptCommandNames(registry);
  if (name.startsWith("@") && registry.commands.has(name)) {
    return {
      path: jsonPointer([...path, "command"]),
      message:
        name === "@elapsed"
          ? "@elapsed is the engine's; send it with an elapse step"
          : `${name} is the engine's; a command step sends the game's`,
      got: JSON.stringify(name),
    };
  }
  const checked = checkCommand(registry, { name, args: raw.args }, names);
  if (checked.ok) return null;
  const issue: ScriptIssue = {
    path: jsonPointer([...path, checked.at === "name" ? "command" : "args"]),
    message: checked.message,
  };
  if (checked.at === "name") {
    issue.expected = names.map((n) => JSON.stringify(n)).join(" | ");
    issue.got = JSON.stringify(name);
  }
  return issue;
}

const unique = (actions: readonly string[]) => [...new Set(actions)];

function compileStep(
  step: ParsedStep,
  index: number,
  time: Pick<ResolvedTime, "rate">,
  registry: Registry,
  held: readonly string[],
): CompiledStep {
  if ("wait" in step) return { index, hold: [], ticks: step.wait };
  if ("command" in step) {
    const checked = checkCommand(registry, { name: step.command, args: step.args });
    if (!checked.ok) throw new Error(checked.message);
    return { index, hold: [...held], ticks: 1, commands: [checked.command] };
  }
  if ("elapse" in step) {
    const { catchUp } = resolveTime({ game: registry.time });
    if (!catchUp) throw new Error("elapse needs the game's time.catchUp");
    return { index, hold: [...held], ticks: 1, commands: [elapsedCommand(step.elapse, catchUp)] };
  }
  if ("press" in step) {
    return {
      index,
      hold: unique(typeof step.press === "string" ? [step.press] : step.press),
      ticks: 1,
    };
  }
  const hold = unique(step.hold);
  if ("for" in step) return { index, hold, ticks: step.for };
  if ("forMs" in step) {
    return { index, hold, ticks: ticksFor(step.forMs, time) };
  }
  const until = Object.fromEntries(
    Object.entries(step.until).filter(([, v]) => v !== undefined),
  ) as UntilClause;
  return { index, hold, until, max: step.max ?? DEFAULT_UNTIL_MAX };
}

/**
 * The edges that turn held set `prev` into `next` at `tick`: releases first,
 * in `prev`'s order, then presses in `next`'s.
 */
export function heldEdges(
  prev: readonly string[],
  next: readonly string[],
  tick: number,
): InputEdge[] {
  const edges: InputEdge[] = [];
  for (const a of prev) if (!next.includes(a)) edges.push([tick, a, 0]);
  for (const a of next) if (!prev.includes(a)) edges.push([tick, a, 1]);
  return edges;
}

/** Every edge of a script whose steps all have fixed lengths, up to `maxTicks`; null when one waits on `until`. */
function staticEdges(steps: readonly CompiledStep[], maxTicks: number): InputEdge[] | null {
  if (steps.some((s) => s.ticks === undefined)) return null;
  const edges: InputEdge[] = [];
  let held: readonly string[] = [];
  let tick = 0;
  for (const step of steps) {
    if (tick >= maxTicks) break;
    edges.push(...heldEdges(held, step.hold, tick));
    held = step.hold;
    tick += step.ticks!;
  }
  return edges;
}

/**
 * Checks an input script against `registry`'s game (its actions, commands,
 * `until` predicates and play options) and resolves every step to ticks at
 * `time`'s rate, by default the game's own. Issues carry JSON Pointers into
 * the script; an unknown action, command or key gets a "did you mean".
 */
export function compileInputScript(
  script: unknown,
  registry: Registry,
  time: Pick<ResolvedTime, "rate"> = resolveTime({ game: registry.time }),
): CompileResult {
  const schemas = inputScriptSchemasFor(registry);
  const issues: ScriptIssue[] = [];
  const head = schemas.head.safeParse(script);
  if (!head.success) {
    const topKeys = Object.keys(schemas.script.shape);
    issues.push(...fromZod(head.error, script, [], registry, () => topKeys));
  }
  const rawSteps = isRecord(script) && Array.isArray(script.steps) ? script.steps : [];
  const steps: CompiledStep[] = [];
  /** What a command or elapse step goes on holding: a hold step's set; nothing after a press or wait. */
  let carried: readonly string[] = [];
  rawSteps.forEach((raw, index) => {
    const parsed = parseStep(raw, index, schemas, registry);
    if (!parsed.ok) return void issues.push(...parsed.issues);
    const step = compileStep(parsed.step, index, time, registry, carried);
    if ("hold" in parsed.step) carried = step.hold;
    else if ("press" in parsed.step || "wait" in parsed.step) carried = [];
    steps.push(step);
  });
  if (!head.success || issues.length > 0) return { ok: false, issues };

  const { at, timeOffsetMs, scene, maxTicks = DEFAULT_SCRIPT_MAX_TICKS } = head.data;
  const play: PlayOptions = {};
  if (at) play.at = { x: at[0], y: at[1] };
  if (timeOffsetMs !== undefined) play.timeOffsetMs = timeOffsetMs;
  const game = (head.data as { game?: unknown }).game;
  if (game !== undefined) play.game = game;
  if (head.data.seed !== undefined) play.seed = head.data.seed;
  const compiled: CompiledInputScript = {
    steps,
    maxTicks,
    play,
    edges: staticEdges(steps, maxTicks),
  };
  if (scene !== undefined) compiled.scene = scene;
  return { ok: true, script: compiled };
}

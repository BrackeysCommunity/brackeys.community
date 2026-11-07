import type { z } from "zod";

import type { Registry } from "../game/types";
import { TICK_RATE } from "../physics";
import { closest } from "../scene/did-you-mean";
import {
  DEFAULT_SCRIPT_MAX_TICKS,
  DEFAULT_UNTIL_MAX,
  inputScriptSchemasFor,
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

const STEP_KINDS = ["hold", "press", "wait"] as const;
const DURATIONS = ["for", "forMs", "until"] as const;
const STEP_KEYS = [...STEP_KINDS, ...DURATIONS, "max"];

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
  const guess = closest(word, candidates);
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
    return fail("a step is an object: { hold, for | forMs | until }, { press } or { wait }");

  const unknown = Object.keys(raw).filter((k) => !STEP_KEYS.includes(k));
  if (unknown.length > 0) {
    return { ok: false, issues: unknown.map((k) => unknownKey(path, k, STEP_KEYS)) };
  }
  const kinds = STEP_KINDS.filter((k) => k in raw);
  if (kinds.length !== 1) {
    return fail(
      kinds.length === 0
        ? "a step needs one of hold, press or wait"
        : `a step is one of hold, press or wait, not ${kinds.join(" and ")}`,
    );
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
  const keysAt: KeysAt = (rel) => (rel.at(-1) === "until" ? registry.predicateNames : STEP_KEYS);
  return { ok: false, issues: fromZod(parsed.error, raw, path, registry, keysAt) };
}

const unique = (actions: readonly string[]) => [...new Set(actions)];

function compileStep(step: ParsedStep, index: number): CompiledStep {
  if ("wait" in step) return { index, hold: [], ticks: step.wait };
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
    return { index, hold, ticks: Math.max(1, Math.round((step.forMs * TICK_RATE) / 1000)) };
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
 * Checks an input script against `registry`'s game (its actions, `until`
 * predicates and play options) and resolves every step to ticks at 60 Hz.
 * Issues carry JSON Pointers into the script; an unknown action or key gets
 * a "did you mean".
 */
export function compileInputScript(script: unknown, registry: Registry): CompileResult {
  const schemas = inputScriptSchemasFor(registry);
  const issues: ScriptIssue[] = [];
  const head = schemas.head.safeParse(script);
  if (!head.success) {
    const topKeys = Object.keys(schemas.script.shape);
    issues.push(...fromZod(head.error, script, [], registry, () => topKeys));
  }
  const rawSteps = isRecord(script) && Array.isArray(script.steps) ? script.steps : [];
  const steps: CompiledStep[] = [];
  rawSteps.forEach((raw, index) => {
    const parsed = parseStep(raw, index, schemas, registry);
    if (parsed.ok) steps.push(compileStep(parsed.step, index));
    else issues.push(...parsed.issues);
  });
  if (!head.success || issues.length > 0) return { ok: false, issues };

  const { at, timeOffsetMs, scene, maxTicks = DEFAULT_SCRIPT_MAX_TICKS } = head.data;
  const play: PlayOptions = {};
  if (at) play.at = { x: at[0], y: at[1] };
  if (timeOffsetMs !== undefined) play.timeOffsetMs = timeOffsetMs;
  const game = (head.data as { game?: unknown }).game;
  if (game !== undefined) play.game = game;
  const compiled: CompiledInputScript = {
    steps,
    maxTicks,
    play,
    edges: staticEdges(steps, maxTicks),
  };
  if (scene !== undefined) compiled.scene = scene;
  return { ok: true, script: compiled };
}

import type { z } from "zod";

import { NAV_COMMAND, type NavDestination } from "../game/commands";
import { simBindings } from "../game/input-bindings";
import { pointerBit, POINTER_BUTTONS, type PointerButton } from "../game/input-codes";
import { capitalise } from "../game/live";
import { resolveTime, ticksFor, type ResolvedTime } from "../game/time";
import type {
  Binding,
  DeviceId,
  GameCommand,
  PlayersDef,
  PlayState,
  Registry,
} from "../game/types";
import { combineAction, resolveBindings, type BindingReading } from "../input/bindings";
import { qAxis, qVector } from "../input/quantize";
import type { PointerState } from "../input/state";
import type { SeatChange, TickInput } from "../input/stream";
import type { InputMapFile } from "../project/kinds/input-map";
import { inputAction } from "../runtime/recorder";
import { didYouMean } from "../scene/did-you-mean";
import {
  checkCommand,
  DEFAULT_SCRIPT_MAX_TICKS,
  DEFAULT_UNTIL_MAX,
  elapsedCommand,
  hintedIssue,
  INPUT_SCRIPT_VERSION,
  inputScriptSchemasFor,
  navCommand,
  pointerStepProblem,
  scriptCommandNames,
  uiActionScriptProblem,
  type AnalogSet,
  type InputScriptSchemas,
  type ScriptPointer,
} from "../scene/input-script";
import { jsonPointer } from "../scene/issues";
import type { InputAction, Vec2 } from "../types";
import { unknownActionError } from "./headless";
import type { InputSource } from "./play-loop";
import type {
  CompiledInputScript,
  CompiledStep,
  CompileResult,
  InputEdge,
  PlaytestStep,
  PlayOptions,
  ScriptIssue,
  UntilClause,
} from "./playtest-types";

type Path = (string | number)[];

// ─── Compiled form ───────────────────────────────────────

/** Axis values and vector components by action, quantised: what a seat holds besides its buttons. */
export type AnalogValues = Readonly<Record<string, number | Vec2>>;

/** A pointer step as it plays: `at`, or a line from `at` to `drag` over the step. */
export type CompiledPointer = {
  at: Vec2;
  drag?: Vec2;
  /** Goes down on the step's first slot. */
  press?: PointerButton;
  /** Goes up on the step's last slot. */
  release?: PointerButton;
};

/** A step of either format: v1's fields, plus what it sets, points at and changes on its seat. */
export type CompiledScriptStep = CompiledStep & {
  /** Axis and vector values held for the step; what the step before set and this one doesn't returns to 0. */
  set?: AnalogValues;
  pointer?: CompiledPointer;
  /** Devices joining (`join`) or leaving (`leave`) the track's seat on the step's one slot. */
  joins?: { device: DeviceId; joined: boolean }[];
};

/** One seat's steps, played concurrently with the other tracks from slot 0. */
export type CompiledTrack = { player: number; steps: CompiledScriptStep[] };

/** One seat's pointer bindings: per button, each button action bound to it. */
export type PointerBindings = Partial<
  Record<PointerButton, readonly { action: string; binding: Binding }[]>
>;

/**
 * A compiled script of either format. A script written with `steps` keeps
 * them there (seat 0's track); one written with `tracks` has every seat's
 * steps in `tracks` and none in `steps`.
 */
export type CompiledScript = CompiledInputScript & {
  steps: CompiledScriptStep[];
  tracks?: CompiledTrack[];
  /** The script's `players`, when it names them. */
  players?: number;
  /**
   * Each seat's pointer bindings, by seat, when any action is bound to a
   * pointer button: a pointer step's buttons raise those actions as live
   * play does.
   */
  pointerBindings?: PointerBindings[];
};

/** How one step of a track went; `player` names the track for a script with `tracks`. */
export type ScriptStepLog = PlaytestStep & { player?: number };

// ─── Parsing ─────────────────────────────────────────────

const V1_KINDS = ["hold", "press", "wait", "command", "elapse"] as const;
const V2_KINDS = [...V1_KINDS, "set", "pointer", "nav", "join", "leave"] as const;
type StepKind = (typeof V2_KINDS)[number];
const DURATIONS = ["for", "forMs", "until"] as const;
const V1_STEP_KEYS = [...V1_KINDS, ...DURATIONS, "max", "args"];
const V2_STEP_KEYS = [...V2_KINDS, ...DURATIONS, "max", "args"];
const V1_KIND_LIST = "hold, press, wait, command or elapse";
const V2_KIND_LIST = "hold, set, pointer, press, wait, command, elapse, nav, join or leave";
/** Kinds that take `for`, `forMs` or `until`. */
const TIMED: readonly StepKind[] = ["hold", "set", "pointer"];
const EXISTS_KEYS = ["id", "enabled"];
const PERSIST_KEYS = ["pointer", "eq", "gte", "lte"];
const NAV_KEYS = ["id", "to"];

type Format = {
  v2: boolean;
  kinds: readonly StepKind[];
  keys: readonly string[];
  kindList: string;
};

const FORMATS: Record<1 | 2, Format> = {
  1: { v2: false, kinds: V1_KINDS, keys: V1_STEP_KEYS, kindList: V1_KIND_LIST },
  2: { v2: true, kinds: V2_KINDS, keys: V2_STEP_KEYS, kindList: V2_KIND_LIST },
};

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

const issueAt = (path: Path, message: string, extra: Partial<ScriptIssue> = {}): ScriptIssue => ({
  path: jsonPointer(path),
  message,
  ...extra,
});

function unknownKey(path: Path, key: string, candidates: readonly string[]): ScriptIssue {
  return issueAt(
    [...path, key],
    `unknown key ${JSON.stringify(key)}${didYouMean(key, candidates)}`,
    {
      expected: candidates.join(" | "),
      got: JSON.stringify(key),
    },
  );
}

function unknownAction(path: Path, action: string, registry: Registry): ScriptIssue {
  return issueAt(path, unknownActionError(action, registry.actionNames)!, {
    expected: registry.actionNames.map((a) => JSON.stringify(a)).join(" | "),
    got: JSON.stringify(action),
  });
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
      for (const key of issue.keys) {
        const ui = rel.at(-1) === "set" ? uiActionScriptProblem(registry, key) : null;
        if (ui) out.push(issueAt([...path, key], ui.message, { hint: ui.hint }));
        else if (rel.at(-1) === "set" && actions.includes(key)) {
          out.push(issueAt([...path, key], `${key} is a button; hold it instead of setting it`));
        } else if (rel.at(-1) === "set") out.push(unknownAction([...path, key], key, registry));
        else out.push(unknownKey(path, key, keysAt(rel)));
      }
    } else if (actionSlot && typeof value === "string" && !actions.includes(value)) {
      out.push(unknownAction(path, value, registry));
    } else if (actionSlot && Array.isArray(value) && issue.code === "invalid_union") {
      const bad = value.flatMap((a, i) =>
        typeof a === "string" && !actions.includes(a)
          ? [unknownAction([...path, i], a, registry)]
          : [],
      );
      out.push(
        ...(bad.length > 0 ? bad : [issueAt(path, issue.message, hintedIssue(issue) ?? {})]),
      );
    } else {
      out.push(issueAt(path, issue.message, hintedIssue(issue) ?? {}));
    }
  }
  return out;
}

type Duration = { for: number } | { forMs: number } | { until: UntilClause; max?: number };

/** A step checked, before its length is resolved to ticks. */
type ParsedStep =
  | { kind: "hold"; hold: string[]; set?: AnalogValues; duration: Duration }
  | { kind: "pointer"; pointer: CompiledPointer; duration: Duration | null }
  | { kind: "press"; press: string[] }
  | { kind: "wait"; ticks: number }
  | { kind: "command"; command: GameCommand }
  | { kind: "elapse"; ms: number }
  | { kind: "nav"; command: GameCommand }
  | { kind: "join" | "leave"; device: DeviceId };

type Parsed<T> = { ok: true; value: T } | { ok: false; issues: ScriptIssue[] };
const failed = (...issues: ScriptIssue[]) => ({ ok: false as const, issues });

const shapeKeys = (schema: unknown): string[] =>
  Object.keys((schema as { shape?: object }).shape ?? {});

/** Which of `for`, `forMs` or `until` a timed step takes, or why it takes none. */
function durationOf(
  raw: Record<string, unknown>,
  label: string,
  path: Path,
): Parsed<(typeof DURATIONS)[number]> {
  const durations = DURATIONS.filter((k) => k in raw);
  if (durations.length !== 1) {
    return failed(
      issueAt(
        path,
        durations.length === 0
          ? `${label} needs one of for, forMs or until`
          : `${label} takes one of for, forMs or until, not ${durations.join(" and ")}`,
      ),
    );
  }
  if ("max" in raw && durations[0] !== "until") {
    return failed(
      issueAt([...path, "max"], "max caps an until step; this step has a fixed length"),
    );
  }
  return { ok: true, value: durations[0]! };
}

/** Picks a step's shape by its keys, so a mistake is reported against the step it was meant to be. */
function parseStep(
  raw: unknown,
  path: Path,
  format: Format,
  schemas: InputScriptSchemas,
  registry: Registry,
): Parsed<ParsedStep> {
  const fail = (message: string, extra: Partial<ScriptIssue> = {}) =>
    failed(issueAt(path, message, extra));
  if (!isRecord(raw)) {
    return fail(
      format.v2
        ? "a step is an object: { hold, set?, for | forMs | until }, { set, for | forMs | until }, { pointer }, { press }, { wait }, { command, args? }, { elapse }, { nav }, { join } or { leave }"
        : "a step is an object: { hold, for | forMs | until }, { press }, { wait }, { command, args? } or { elapse }",
    );
  }

  const unknown = Object.keys(raw).filter((k) => !format.keys.includes(k));
  if (unknown.length > 0) {
    return failed(
      ...unknown.map((k) => {
        const issue = unknownKey(path, k, format.keys);
        if (!format.v2 && (V2_KINDS as readonly string[]).includes(k)) {
          issue.hint = `${k} steps need input-script v2: set "v": 2.`;
        }
        return issue;
      }),
    );
  }
  const found = format.kinds.filter((k) => k in raw);
  const withSet = found.length === 2 && found.includes("hold") && found.includes("set");
  if (found.length !== 1 && !withSet) {
    return fail(
      found.length === 0
        ? `a step needs one of ${format.kindList}`
        : `a step is one of ${format.kindList}, not ${found.join(" and ")}`,
    );
  }
  const kind: StepKind = withSet ? "hold" : found[0]!;
  if ("args" in raw && kind !== "command") {
    return failed(issueAt([...path, "args"], "args goes with a command step"));
  }
  const misplaced = [...DURATIONS, "max"].find((k) => k in raw);
  if (misplaced && !TIMED.includes(kind)) {
    const timed = format.v2 ? "a hold, set or pointer step" : "a hold step";
    return failed(
      issueAt(
        [...path, misplaced],
        `${misplaced} goes with ${timed}; { "hold": [], "${misplaced === "max" ? "until" : misplaced}": … } waits holding nothing`,
      ),
    );
  }
  if (kind === "command") {
    const problem = commandStepIssue(raw, path, registry);
    if (problem) return failed(problem);
  }

  let shape: z.ZodType;
  if (TIMED.includes(kind) && (kind !== "pointer" || misplaced)) {
    const duration = durationOf(raw, `a ${kind} step`, path);
    if (!duration.ok) return duration;
    const named = `${kind}${capitalise(duration.value)}` as keyof InputScriptSchemas["steps"];
    shape = schemas.steps[named];
  } else {
    shape = schemas.steps[kind as keyof InputScriptSchemas["steps"]];
  }
  const parsed = shape.safeParse(raw);
  if (!parsed.success) {
    const keysAt: KeysAt = (rel) => {
      if (rel.at(-1) === "until") return registry.predicateNames;
      if (rel.at(-2) === "until" && rel.at(-1) === "count") return schemas.countKeys;
      if (rel.at(-2) === "until" && rel.at(-1) === "exists") return EXISTS_KEYS;
      if (rel.at(-2) === "until" && rel.at(-1) === "persist") return PERSIST_KEYS;
      if (rel.at(-1) === "set") return shapeKeys(schemas.analog);
      if (rel.at(-1) === "pointer") return shapeKeys(schemas.pointer);
      if (rel.at(-1) === "nav") return NAV_KEYS;
      return format.keys;
    };
    return failed(...fromZod(parsed.error, raw, path, registry, keysAt));
  }
  return stepOf(kind, parsed.data as Record<string, unknown>, path, registry);
}

/** A step its shape accepted, with what no shape can see checked: a value held and set. */
function stepOf(
  kind: StepKind,
  data: Record<string, unknown>,
  path: Path,
  registry: Registry,
): Parsed<ParsedStep> {
  const duration = (): Duration | null => {
    if (data.for !== undefined) return { for: data.for as number };
    if (data.forMs !== undefined) return { forMs: data.forMs as number };
    if (data.until === undefined) return null;
    const until = { until: data.until as UntilClause } as Duration & { max?: number };
    if (data.max !== undefined) until.max = data.max as number;
    return until;
  };
  switch (kind) {
    case "command": {
      const checked = checkCommand(registry, { name: data.command as string, args: data.args });
      if (!checked.ok) return failed(issueAt(path, checked.message));
      return { ok: true, value: { kind, command: checked.command } };
    }
    case "elapse":
      return { ok: true, value: { kind, ms: data.elapse as number } };
    case "nav":
      return { ok: true, value: { kind, command: navCommand(data.nav as NavDestination) } };
    case "wait":
      return { ok: true, value: { kind, ticks: data.wait as number } };
    case "press": {
      const press = data.press as string | string[];
      return {
        ok: true,
        value: { kind, press: unique(typeof press === "string" ? [press] : press) },
      };
    }
    case "join":
    case "leave":
      return { ok: true, value: { kind, device: data[kind] as DeviceId } };
    case "pointer": {
      const pointer = compiledPointer(data.pointer as ScriptPointer);
      return { ok: true, value: { kind, pointer, duration: duration() } };
    }
    case "set":
    case "hold": {
      const hold = unique((data.hold as string[] | undefined) ?? []);
      const set = data.set as AnalogSet | undefined;
      const values = set ? analogValues(set) : undefined;
      const both = values ? hold.find((a) => a in values) : undefined;
      if (both !== undefined) {
        return failed(
          issueAt([...path, "set", both], `${both} is held and set; a step does one or the other`),
        );
      }
      const step: ParsedStep = { kind: "hold", hold, duration: duration()! };
      if (values) step.set = values;
      return { ok: true, value: step };
    }
  }
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
    return issueAt(
      [...path, "command"],
      name === "@elapsed"
        ? "@elapsed is the engine's; send it with an elapse step"
        : name === NAV_COMMAND
          ? `${NAV_COMMAND} is the engine's; send it with a nav step`
          : `${name} is the engine's; a command step sends the game's`,
      { got: JSON.stringify(name) },
    );
  }
  const checked = checkCommand(registry, { name, args: raw.args }, names);
  if (checked.ok) return null;
  const issue = issueAt([...path, checked.at === "name" ? "command" : "args"], checked.message);
  if (checked.at === "name") {
    issue.expected = names.map((n) => JSON.stringify(n)).join(" | ");
    issue.got = JSON.stringify(name);
  }
  return issue;
}

const unique = (actions: readonly string[]) => [...new Set(actions)];

/** What a one-slot step goes on holding: the timed step before it's buttons and values. */
type Carried = { hold: readonly string[]; set?: AnalogValues };

function lengthOf(duration: Duration, time: Pick<ResolvedTime, "rate">): Partial<CompiledStep> {
  if ("for" in duration) return { ticks: duration.for };
  if ("forMs" in duration) return { ticks: ticksFor(duration.forMs, time) };
  const until = Object.fromEntries(
    Object.entries(duration.until).filter(([, v]) => v !== undefined),
  ) as UntilClause;
  return { until, max: duration.max ?? DEFAULT_UNTIL_MAX };
}

function compileStep(
  step: ParsedStep,
  index: number,
  time: Pick<ResolvedTime, "rate">,
  registry: Registry,
  carried: Carried,
): CompiledScriptStep {
  const held = (extra: Partial<CompiledScriptStep>): CompiledScriptStep => {
    const out: CompiledScriptStep = { index, hold: [...carried.hold], ticks: 1, ...extra };
    if (carried.set) out.set = carried.set;
    return out;
  };
  switch (step.kind) {
    case "wait":
      return { index, hold: [], ticks: step.ticks };
    case "press":
      return { index, hold: step.press, ticks: 1 };
    case "command":
    case "nav":
      return held({ commands: [step.command] });
    case "elapse": {
      const { catchUp } = resolveTime({ game: registry.time });
      if (!catchUp) throw new Error("elapse needs the game's time.catchUp");
      return held({ commands: [elapsedCommand(step.ms, catchUp)] });
    }
    case "join":
    case "leave":
      return held({ joins: [{ device: step.device, joined: step.kind === "join" }] });
    case "pointer": {
      const out = held({ pointer: step.pointer });
      if (step.duration) {
        delete out.ticks;
        Object.assign(out, lengthOf(step.duration, time));
      }
      return out;
    }
    case "hold": {
      const out: CompiledScriptStep = { index, hold: step.hold, ...lengthOf(step.duration, time) };
      if (step.set) out.set = step.set;
      return out;
    }
  }
}

/** What the next one-slot step carries after `step`: a timed step's buttons and values; nothing after a press or wait. */
function carriedAfter(step: ParsedStep, compiled: CompiledScriptStep, was: Carried): Carried {
  if (step.kind === "hold")
    return compiled.set ? { hold: compiled.hold, set: compiled.set } : { hold: compiled.hold };
  if (step.kind === "press" || step.kind === "wait") return { hold: [] };
  return was;
}

/** Checks and compiles one track's steps, from `base` (`["steps"]` or `["tracks", i, "steps"]`). */
function compileSteps(
  rawSteps: readonly unknown[],
  base: Path,
  format: Format,
  schemas: InputScriptSchemas,
  registry: Registry,
  time: Pick<ResolvedTime, "rate">,
  issues: ScriptIssue[],
): CompiledScriptStep[] {
  const steps: CompiledScriptStep[] = [];
  let carried: Carried = { hold: [] };
  rawSteps.forEach((raw, index) => {
    const path = [...base, index];
    const parsed = parseStep(raw, path, format, schemas, registry);
    if (!parsed.ok) return void issues.push(...parsed.issues);
    const step = compileStep(parsed.value, index, time, registry, carried);
    const problem =
      step.pointer && step.ticks !== undefined
        ? pointerStepProblem(step.pointer, step.ticks)
        : null;
    if (problem) {
      issues.push(issueAt([...path, "pointer"], problem.message));
      return;
    }
    carried = carriedAfter(parsed.value, step, carried);
    steps.push(step);
  });
  return steps;
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

/** Every button edge of steps that all have fixed lengths, up to `maxTicks` slots; null when one waits on `until`. */
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
 * A script's `tracks`, each checked as `{ player, steps }` and its steps
 * compiled; the list's shape and its seats are the header's to judge.
 */
function compileTracks(
  raw: unknown,
  format: Format,
  schemas: InputScriptSchemas,
  registry: Registry,
  time: Pick<ResolvedTime, "rate">,
  issues: ScriptIssue[],
): CompiledTrack[] {
  if (!Array.isArray(raw)) return [];
  const tracks: CompiledTrack[] = [];
  raw.forEach((track, i) => {
    const path: Path = ["tracks", i];
    const head = schemas.trackHead.safeParse(track);
    if (!head.success) {
      const keys = shapeKeys(schemas.trackHead);
      issues.push(...fromZod(head.error, track, path, registry, () => keys));
    }
    if (!isRecord(track) || !Array.isArray(track.steps)) return;
    const steps = compileSteps(
      track.steps,
      [...path, "steps"],
      format,
      schemas,
      registry,
      time,
      issues,
    );
    if (head.success) tracks.push({ player: head.data.player, steps });
  });
  return tracks;
}

/**
 * Checks an input script against `registry`'s game (its actions and their
 * kinds, commands, `until` predicates, play options and seats) and resolves
 * every step to ticks at `time`'s rate, by default the game's own. Its
 * tracks drive the seats `players` (the project input map's) gives, else
 * the game's, unless the script sets its own `players`. A pointer step's
 * buttons hold the actions bound to them, the project input map's
 * (`map`) over the game's, as live play does. Issues
 * carry JSON Pointers into the script; an unknown action, command or key
 * gets a "did you mean". A v1 script compiles as written, as the v2 subset
 * it is: lengths in a script handed here are metres in either version, and
 * reading a v1 file (`parseInputScript`) is what migrates its px.
 */
export function compileInputScript(
  script: unknown,
  registry: Registry,
  time: Pick<ResolvedTime, "rate"> = resolveTime({ game: registry.time }),
  players?: PlayersDef | null,
  map?: Pick<InputMapFile, "actions"> | null,
): CompileResult {
  const schemas = inputScriptSchemasFor(registry, players);
  const issues: ScriptIssue[] = [];
  const raw = isRecord(script) ? script : null;
  const format = raw?.v === 2 ? FORMATS[2] : FORMATS[1];

  let headInput: unknown = script;
  if (raw?.v === 1) {
    const { tracks: _tracks, players: _players, ...rest } = raw;
    headInput = { ...rest, v: INPUT_SCRIPT_VERSION };
    for (const key of ["tracks", "players"] as const) {
      if (key in raw) {
        issues.push(issueAt([key], `${key} needs input-script v2`, { hint: 'Set "v": 2.' }));
      }
    }
  }
  const head = schemas.head.safeParse(headInput);
  if (!head.success) {
    const topKeys = shapeKeys(schemas.head);
    issues.push(...fromZod(head.error, headInput, [], registry, () => topKeys));
  }

  let steps: CompiledScriptStep[] = [];
  let tracks: CompiledTrack[] | undefined;
  if (raw && Array.isArray(raw.steps)) {
    steps = compileSteps(raw.steps, ["steps"], format, schemas, registry, time, issues);
  } else if (raw && format.v2 && raw.tracks !== undefined) {
    tracks = compileTracks(raw.tracks, format, schemas, registry, time, issues);
  }
  if (!head.success || issues.length > 0) return { ok: false, issues };

  const { at, timeOffsetMs, scene, maxTicks = DEFAULT_SCRIPT_MAX_TICKS } = head.data;
  const play: PlayOptions = {};
  if (at) play.at = { x: at[0], y: at[1] };
  if (timeOffsetMs !== undefined) play.timeOffsetMs = timeOffsetMs;
  const game = (head.data as { game?: unknown }).game;
  if (game !== undefined) play.game = game;
  if (head.data.seed !== undefined) play.seed = head.data.seed;
  const seat0 = tracks ? (tracks.find((t) => t.player === 0)?.steps ?? []) : steps;
  const seats = tracks ? Math.max(1, ...tracks.map((t) => t.player + 1)) : 1;
  const bound = pointerBindingsOf(registry, map, seats);
  const pointerRaises = Object.keys(bound?.[0] ?? {}).length > 0 && seat0.some((s) => s.pointer);
  const compiled: CompiledScript = {
    steps,
    maxTicks,
    play,
    edges: pointerRaises ? null : staticEdges(seat0, maxTicks),
  };
  if (tracks) compiled.tracks = tracks;
  if (bound) compiled.pointerBindings = bound;
  if (head.data.players !== undefined) compiled.players = head.data.players;
  if (scene !== undefined) compiled.scene = scene;
  return { ok: true, script: compiled };
}

/**
 * `script` with `commands` sent on its first slot, ahead of what its first
 * step sends there: on seat 0's first step, or the first track's.
 */
export function withStartCommands(
  script: CompiledInputScript,
  commands: readonly GameCommand[],
): CompiledInputScript {
  if (commands.length === 0) return script;
  const lead = (steps: CompiledScriptStep[]): CompiledScriptStep[] => {
    const [first, ...rest] = steps;
    return first
      ? [{ ...first, commands: [...commands, ...(first.commands ?? [])] }, ...rest]
      : steps;
  };
  const compiled = script as CompiledScript;
  if (!compiled.tracks) return { ...compiled, steps: lead(compiled.steps) };
  const [first, ...rest] = compiled.tracks;
  if (!first) return script;
  const out: CompiledScript = {
    ...compiled,
    tracks: [{ ...first, steps: lead(first.steps) }, ...rest],
  };
  return out;
}

/**
 * Each seat's pointer bindings, `map`'s over the game's, without UI-only
 * actions (`simBindings`); undefined when no seat binds a pointer button.
 */
export function pointerBindingsOf(
  registry: Registry,
  map: Pick<InputMapFile, "actions"> | null | undefined,
  seats: number,
): PointerBindings[] | undefined {
  const { tables } = resolveBindings({ game: registry.actions, map, players: seats });
  if (tables.pointer.size === 0) return undefined;
  const out: PointerBindings[] = Array.from({ length: seats }, () => ({}));
  for (const button of POINTER_BUTTONS) {
    for (const b of simBindings(registry, tables.pointer.get(button) ?? [])) {
      const seat = out[b.player];
      if (seat) seat[button] = [...(seat[button] ?? []), { action: b.action, binding: b.binding }];
    }
  }
  return out.some((seat) => Object.keys(seat).length > 0) ? out : undefined;
}

// ─── Playing ─────────────────────────────────────────────

const withSeat = <T extends { player?: number }>(item: T, player: number): T =>
  player === 0 ? item : { ...item, player };

const sameValue = (a: number | Vec2 | undefined, b: number | Vec2): boolean =>
  typeof a === "number" || typeof b === "number"
    ? a === b
    : a !== undefined && a.x === b.x && a.y === b.y;

/** `set`'s values as the runtime takes them: axis numbers and vector pairs quantised. */
export function analogValues(set: AnalogSet): AnalogValues {
  const out: Record<string, number | Vec2> = {};
  for (const [action, v] of Object.entries(set)) {
    out[action] = typeof v === "number" ? qAxis(v) : qVector({ x: v[0], y: v[1] });
  }
  return out;
}

/** A script or macro pointer as it plays. */
export function compiledPointer(pointer: ScriptPointer): CompiledPointer {
  const out: CompiledPointer = { at: { x: pointer.at[0], y: pointer.at[1] } };
  if (pointer.drag) out.drag = { x: pointer.drag[0], y: pointer.drag[1] };
  if (pointer.press) out.press = pointer.press;
  if (pointer.release) out.release = pointer.release;
  return out;
}

/**
 * The actions that move a seat's values from `prev` to `next` at `tick`:
 * one returning to 0 for each value `next` drops, in `prev`'s order, then
 * one for each value `next` changes or adds, in its order. Pressed means
 * not 0.
 */
export function analogActions(
  prev: AnalogValues,
  next: AnalogValues,
  tick: number,
  player = 0,
  time?: Pick<ResolvedTime, "tickMs">,
): InputAction[] {
  const actions: InputAction[] = [];
  const action = (name: string, value: number | Vec2): InputAction => {
    const zero = typeof value === "number" ? value === 0 : value.x === 0 && value.y === 0;
    const a = inputAction(name, !zero, tick, time);
    if (typeof value === "number") a.value = value;
    else {
      a.x = value.x;
      a.y = value.y;
    }
    return withSeat(a, player);
  };
  for (const [name, value] of Object.entries(prev)) {
    if (!(name in next)) actions.push(action(name, typeof value === "number" ? 0 : { x: 0, y: 0 }));
  }
  for (const [name, value] of Object.entries(next)) {
    if (!sameValue(prev[name], value)) actions.push(action(name, value));
  }
  return actions;
}

/**
 * The pointer on slot `k` of a pointer step `slots` long, from `buttons`
 * (what was down before the slot): at `at`, or along the line to `drag`,
 * reaching it on the last slot; `press` goes down on the first slot and
 * `release` up on the last. `slots` is undefined for an `until` step, which
 * stays at `at`.
 */
export function pointerAt(
  pointer: CompiledPointer,
  k: number,
  slots: number | undefined,
  buttons: number,
): PointerState {
  const last = slots !== undefined && k >= slots - 1;
  let down = buttons;
  if (k === 0 && pointer.press) down |= pointerBit(pointer.press);
  if (last && pointer.release) down &= ~pointerBit(pointer.release);
  let { x, y } = pointer.at;
  if (pointer.drag && slots !== undefined) {
    const t = slots <= 1 ? 1 : Math.min(1, k / (slots - 1));
    x += (pointer.drag.x - pointer.at.x) * t;
    y += (pointer.drag.y - pointer.at.y) * t;
  }
  return { x, y, buttons: down, over: true };
}

/**
 * The button actions a seat holds, in a script and in fuzz: its `hold`, then each action a
 * pointer button in `buttons` holds through `bound`, combined as live play
 * combines an action's bindings (`combineAction`).
 */
export function pointerHeld(
  hold: readonly string[],
  buttons: number,
  bound: PointerBindings | undefined,
): readonly string[] {
  if (!bound) return hold;
  const readings = new Map<string, BindingReading[]>();
  for (const button of POINTER_BUTTONS) {
    const reading = buttons & pointerBit(button) ? 1 : 0;
    for (const { action, binding } of bound[button] ?? []) {
      const list = readings.get(action);
      if (list) list.push({ binding, reading });
      else readings.set(action, [{ binding, reading }]);
    }
  }
  const out = [...hold];
  for (const [action, list] of readings) {
    if (!out.includes(action) && combineAction("button", list).pressed) out.push(action);
  }
  return out.length === hold.length ? hold : out;
}

const samePointer = (a: PointerState | null, b: PointerState): boolean =>
  a !== null && a.x === b.x && a.y === b.y && a.buttons === b.buttons && a.over === b.over;

/** Where one track is: its step, the slots that step ran, and what its seat holds. */
type Cursor = {
  player: number;
  steps: readonly CompiledScriptStep[];
  at: number;
  ran: number;
  start: number;
  held: readonly string[];
  values: AnalogValues;
  pointer: PointerState | null;
};

export type ScriptSource = InputSource & {
  tick(slot: number): TickInput;
  /** Every step that started: how it went, oldest end first; a step still running ends as `run`. */
  log(): ScriptStepLog[];
};

/**
 * Plays a compiled script one slot at a time: every track from slot 0 at
 * once, each `TickInput` holding each seat's button edges (releases first),
 * analog values, pointer (only when it changed), seat changes and commands,
 * all on its step's first slot but the pointer. The actions bound to a
 * pointer button are held while it is down, as in live play. A step's length counts
 * slots, so an idle turns or event game still moves through it; `until` is
 * judged by `holds` after each simulated tick. The input runs out
 * (`script-end`) once every track's steps have; nothing is released then.
 * A track that ends before the others likewise keeps what its last step
 * held (buttons, values, pointer) until the script ends: end it on a
 * `wait` to let go, and on a pointer `release` for a pointer button.
 * A script written with `steps` plays as seat 0's one track.
 */
export function scriptSource(
  script: CompiledInputScript,
  holds: (until: UntilClause, state: PlayState) => boolean,
  time?: Pick<ResolvedTime, "tickMs">,
): ScriptSource {
  const { tracks, pointerBindings } = script as CompiledScript;
  const named = tracks !== undefined;
  const cursors: Cursor[] = (tracks ?? [{ player: 0, steps: script.steps }]).map((t) => ({
    player: t.player,
    steps: t.steps,
    at: 0,
    ran: 0,
    start: 0,
    held: [],
    values: {},
    pointer: null,
  }));
  const log: ScriptStepLog[] = [];
  const entry = (c: Cursor, end: PlaytestStep["end"]): ScriptStepLog => {
    const e: ScriptStepLog = { index: c.steps[c.at]!.index, start: c.start, ticks: c.ran, end };
    if (named) e.player = c.player;
    return e;
  };
  const advance = (c: Cursor, end: PlaytestStep["end"] | null) => {
    if (!end) return;
    log.push(entry(c, end));
    c.at++;
    c.ran = 0;
  };
  /** The step's end once its slots or its `max` run out. */
  const lengthEnd = (c: Cursor, step: CompiledStep): PlaytestStep["end"] | null => {
    if (step.ticks !== undefined) return c.ran >= step.ticks ? "done" : null;
    return c.ran >= step.max! ? "max" : null;
  };
  const running = () => cursors.filter((c) => c.at < c.steps.length);

  return {
    done: () => running().length === 0,
    tick(slot) {
      const input: TickInput = { tick: slot, actions: [], commands: [], pointers: [], joins: [] };
      const joins: SeatChange[] = [];
      for (const c of running()) {
        const step = c.steps[c.at]!;
        const first = c.ran === 0;
        if (first) c.start = slot;
        let moved: PointerState | null = null;
        if (step.pointer) {
          const sample = pointerAt(step.pointer, c.ran, step.ticks, c.pointer?.buttons ?? 0);
          if (!samePointer(c.pointer, sample)) moved = c.pointer = sample;
        }
        const held = pointerHeld(step.hold, c.pointer?.buttons ?? 0, pointerBindings?.[c.player]);
        for (const [, action, pressed] of heldEdges(c.held, held, slot)) {
          input.actions.push(withSeat(inputAction(action, pressed === 1, slot, time), c.player));
        }
        const values = step.set ?? {};
        input.actions.push(...analogActions(c.values, values, slot, c.player, time));
        c.held = held;
        c.values = values;
        if (first) {
          for (const command of step.commands ?? []) {
            input.commands.push(
              command.name.startsWith("@") ? command : withSeat(command, c.player),
            );
          }
          for (const j of step.joins ?? []) joins.push({ player: c.player, ...j });
        }
        if (moved) {
          while (input.pointers.length < c.player) input.pointers.push(undefined);
          input.pointers[c.player] = moved;
        }
      }
      input.joins = joins;
      return input;
    },
    after(state) {
      for (const c of running()) {
        const step = c.steps[c.at]!;
        c.ran++;
        if (step.ticks === undefined && holds(step.until!, state)) advance(c, "until");
        else advance(c, lengthEnd(c, step));
      }
    },
    skipped() {
      for (const c of running()) {
        c.ran++;
        advance(c, lengthEnd(c, c.steps[c.at]!));
      }
    },
    log: () => [...log, ...running().flatMap((c) => (c.ran > 0 ? [entry(c, "run")] : []))],
  };
}

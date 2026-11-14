import type { z } from "zod";

import { zodIssueText } from "../game/fields";
import { EngineError, type GameDefinition, type JsonValue } from "../game/types";
import type { PersistCell } from "./types";

export type PersistCellOptions = {
  /** Judged on every value the cell takes, after the plain-JSON check, when `check` is on. */
  schema?: z.ZodType;
  /** Dev and headless check what the game sets; production trusts it. */
  check?: boolean;
};

/** Where `value` stops being plain JSON, as "<path>: <why>", or null when it is. */
export function plainJsonProblem(value: unknown): string | null {
  const seen = new Set<object>();
  function walk(v: unknown, path: string): string | null {
    if (v === null || typeof v === "string" || typeof v === "boolean") return null;
    if (typeof v === "number")
      return Number.isFinite(v) ? null : `${path}: ${v} isn't a finite number`;
    if (typeof v !== "object") return `${path}: a ${typeof v} isn't JSON`;
    if (seen.has(v)) return `${path}: a cycle`;
    if (Array.isArray(v)) {
      seen.add(v);
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) return `${path}/${i}: a hole`;
        const bad = walk(v[i], `${path}/${i}`);
        if (bad) return bad;
      }
      seen.delete(v);
      return null;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      return `${path}: a ${(v as object).constructor?.name ?? "class"} instance isn't plain JSON`;
    }
    seen.add(v);
    for (const [key, child] of Object.entries(v)) {
      const at = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (child === undefined) return `${at}: undefined isn't JSON`;
      const bad = walk(child, at);
      if (bad) return bad;
    }
    seen.delete(v);
    return null;
  }
  return walk(value, "");
}

/** A deep copy of a JSON value, frozen throughout. */
function frozenCopy(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy)) as JsonValue;
  const out: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(out, key, { value: frozenCopy(child), enumerable: true });
  }
  return Object.freeze(out);
}

/**
 * One persistent value: deep-frozen, the same object until `set`, back to
 * `initial()` on `reset`. `initial` is read when the value is first needed,
 * so a game's code sees any problem with it inside a step.
 */
export function createPersistCell(
  initial: () => JsonValue,
  opts: PersistCellOptions = {},
): PersistCell {
  let value: JsonValue | undefined;

  function take(next: JsonValue, what: string): JsonValue {
    if (opts.check) {
      const problem = persistProblem(next, opts.schema);
      if (problem) throw new EngineError("schema", `${what} ${problem}`);
    }
    return frozenCopy(next);
  }

  return {
    get value() {
      if (value === undefined) value = take(initial(), "persist.initial()");
      return value;
    },
    set(next) {
      value = take(next, "persist.set's value");
    },
    reset() {
      value = undefined;
    },
  };
}

/** Ticks played under one persist cell, across every scene and runtime that share it. */
export type PlayClock = { ticks: number };

const PLAY_CLOCK: unique symbol = Symbol("play clock");

/** The play clock beside `cell`, kept on it: what a save's `meta.playTicks` holds and a restore seeds. */
export function playClockOf(cell: PersistCell): PlayClock {
  return ((cell as PersistCell & { [PLAY_CLOCK]?: PlayClock })[PLAY_CLOCK] ??= { ticks: 0 });
}

/**
 * Why `value` can't be the game's persistent value, as a phrase to follow
 * its name ("isn't plain JSON: /a: …"), or null: plain JSON, then the
 * game's `persist.schema`. Every value a cell checks and every save's
 * persist is judged by it.
 */
export function persistProblem(value: unknown, schema: z.ZodType | undefined): string | null {
  const problem = plainJsonProblem(value);
  if (problem) return `isn't plain JSON: ${problem}`;
  const parsed = schema?.safeParse(value);
  if (!parsed || parsed.success) return null;
  return `doesn't match the game's persist schema: ${zodIssueText(parsed.error)}`;
}

/** The cell for `game`'s `persist`; a game that declares none gets one holding null. */
export function gamePersistCell(
  game: GameDefinition | null | undefined,
  check: boolean,
): PersistCell {
  const def = game?.persist;
  return createPersistCell(() => def?.initial() ?? null, {
    check,
    ...(def?.schema ? { schema: def.schema } : {}),
  });
}

import type { z } from "zod";

import type { EngineContext, JsonValue } from "../game/types";
import { ownValue } from "../project/canonical";
import { isPlainObject } from "../project/kinds/define";
import { persistProblem } from "../runtime/persist";
import { pointerSegments } from "../scene/issues";

/** Where a dialogue's conditions read and its effects write: JSON pointers into the host's value. */
export interface DialogueVars {
  get(pointer: string): JsonValue | undefined;
  set(pointer: string, value: JsonValue): void;
}

const INDEX = /^(?:0|[1-9]\d*)$/;

/** The value at `pointer` in `root`; undefined where the path leaves it. */
export function jsonAt(root: JsonValue | undefined, pointer: string): JsonValue | undefined {
  let at: JsonValue | undefined = root;
  for (const token of pointerSegments(pointer)) {
    if (Array.isArray(at)) at = INDEX.test(token) ? at[Number(token)] : undefined;
    else if (isPlainObject(at)) at = ownValue(at as Record<string, JsonValue>, token);
    else return undefined;
  }
  return at;
}

/**
 * A copy of `root` with `value` at `pointer`; what it passes through is
 * copied, never written. A missing step becomes an object; in an array an
 * index replaces its item, and "-" or the length appends. A step through
 * anything else (a number, or an array by name) replaces it with an object.
 */
export function withJsonAt(root: JsonValue, pointer: string, value: JsonValue): JsonValue {
  const put = (at: JsonValue | undefined, tokens: readonly string[], i: number): JsonValue => {
    if (i === tokens.length) return value;
    const token = tokens[i]!;
    if (Array.isArray(at) && (token === "-" || INDEX.test(token))) {
      const index = token === "-" ? at.length : Math.min(Number(token), at.length);
      const out = [...at];
      out[index] = put(at[index], tokens, i + 1);
      return out;
    }
    const obj = isPlainObject(at) ? (at as Record<string, JsonValue>) : {};
    return { ...obj, [token]: put(ownValue(obj, token), tokens, i + 1) };
  };
  return put(root, pointerSegments(pointer), 0);
}

/**
 * JSON pointers into `ctx.persist`: `set` replaces the value through
 * `ctx.persist.set`. With `opts`, each write is judged first by
 * `persistProblem` against `opts.schema` whatever the mode, and one it
 * refuses leaves persist as it was and goes to `opts.refused`.
 */
export function persistVars(
  ctx: Pick<EngineContext, "persist">,
  opts?: { schema?: z.ZodType; refused?: (pointer: string, problem: string) => void },
): DialogueVars {
  return {
    get: (pointer) => jsonAt(ctx.persist.value, pointer),
    set: (pointer, value) => {
      const next = withJsonAt(ctx.persist.value, pointer, value);
      const problem = opts ? persistProblem(next, opts.schema) : null;
      if (problem) opts?.refused?.(pointer, problem);
      else ctx.persist.set(next);
    },
  };
}

/** Variables over a plain value this host keeps, for tests and games that hold their own. */
export function memoryVars(initial: JsonValue = {}): DialogueVars & { readonly value: JsonValue } {
  let value = initial;
  return {
    get value() {
      return value;
    },
    get: (pointer) => jsonAt(value, pointer),
    set: (pointer, next) => {
      value = withJsonAt(value, pointer, next);
    },
  };
}

/**
 * The field-path grammar that `update`, overrides and issue paths share:
 *
 * ```
 * FieldPath     := Segment ("." Segment)*
 * Segment       := Name | Index | BehaviorName      ; BehaviorName only right after "behaviors"
 * Name          := [A-Za-z_$][A-Za-z0-9_$]*
 * Index         := 0 | [1-9][0-9]*
 * OverridePath  := ChildRef "." FieldPath
 * ChildRef      := Id ("/" Id)* ("/" BulkRef)? | BulkRef
 * ```
 *
 * `behaviors.tactics/selectable.team` is three segments: a behavior name may
 * hold a `/`, never a `.`.
 */
import { BEHAVIOR_NAME_PATTERN, BEHAVIORS_FIELD } from "../game/behaviors";
import type { FieldPath, OverridePath, Ref } from "./types";

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const BULK_REF = /^~([^/]+):(?:0|[1-9][0-9]*)$/;

/** An entity or instance id: a behavior name without its game's prefix is exactly one. */
const isId = (s: string) => !s.includes("/") && BEHAVIOR_NAME_PATTERN.test(s);

/** `~<type>:<index>` or `~<type>:<material>:<index>`. */
function isBulkRef(s: string): boolean {
  const key = BULK_REF.exec(s)?.[1];
  if (key === undefined) return false;
  const parts = key.split(":");
  return parts.length <= 2 && parts.every(isId);
}
const INDEX = /^(?:0|[1-9][0-9]*)$/;

/** The path's segments, or null when it isn't in the grammar. */
export function splitFieldPath(path: FieldPath): string[] | null {
  if (path === "") return null;
  const segments = path.split(".");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (NAME.test(seg) || INDEX.test(seg)) continue;
    if (i > 0 && segments[i - 1] === BEHAVIORS_FIELD && BEHAVIOR_NAME_PATTERN.test(seg)) continue;
    return null;
  }
  return segments;
}

/**
 * A child ref's segments: the ids of the nested instances it passes
 * through, then the child itself, an id or (last only) a bulk ref.
 * `door-1/latch/~solid:0` is `["door-1", "latch", "~solid:0"]`; null when it
 * isn't a child ref.
 */
export function splitChildRef(ref: Ref): string[] | null {
  const segments = ref.split("/");
  const last = segments.length - 1;
  for (let i = 0; i <= last; i++) {
    const seg = segments[i]!;
    if (isId(seg) || (i === last && isBulkRef(seg))) continue;
    return null;
  }
  return segments;
}

/** The fields of a nested instance that an override may set as a whole, besides `params.<name>`. */
export const INSTANCE_OVERRIDE_FIELDS = ["at", "rot", "flip", "z", "off", "layer"] as const;

const PARAM_FIELD = /^params\.[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Whether an override's field path, on a child ref naming a nested
 * instance, sets that instance's own field: `door-1.at`, `door-1.rot`,
 * `.flip`, `.z`, `.off`, `.layer`, `.params.<name>`.
 */
export function isInstanceOverrideField(field: FieldPath): boolean {
  return (INSTANCE_OVERRIDE_FIELDS as readonly string[]).includes(field) || PARAM_FIELD.test(field);
}

/**
 * Splits an override key at its first `.` into the child it names (a
 * `ChildRef`, nested children by `/`) and the field path in it; null when
 * either half isn't in the grammar.
 */
export function splitOverridePath(path: OverridePath): { child: Ref; field: string } | null {
  const dot = path.indexOf(".");
  if (dot <= 0 || dot === path.length - 1) return null;
  const child = path.slice(0, dot);
  const field = path.slice(dot + 1);
  if (!splitChildRef(child) || !splitFieldPath(field)) return null;
  return { child, field };
}

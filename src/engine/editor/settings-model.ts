import type { z } from "zod";

import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { fieldLayout } from "../project/canonical";
import { isPlainObject, type DocLayout } from "../project/kinds/define";
import type { JsonEdit, ProjectOp } from "../project/ops";
import type { AssetId } from "../project/types";
import { jsonPointer } from "../scene/issues";
import { describeRow, typedValue, type InspectorRow } from "./inspector-model";

export type { InspectorRow } from "./inspector-model";

/** A tab of the project settings panel. */
export type SettingsSection = {
  id: "general" | "engine" | "input" | "scenes" | "layers" | (string & {});
  title: string;
};

export type SettingsRowsOptions = {
  /** The game's registry: its `meta.widget` widgets and its px per metre. */
  registry?: Registry;
  /** Px per metre for metric steps; default the registry's, else the engine's. */
  pxPerMetre?: number;
};

const segmentsOf = (path: string): string[] => (path === "" ? [] : path.split("."));

/** `value` placed at `segments` below an otherwise empty root. */
function nest(segments: readonly string[], value: unknown): unknown {
  return segments.reduceRight<unknown>((inner, seg) => ({ [seg]: inner }), value);
}

/**
 * Rows for every field of `schema`, an object whose value is `value` and
 * which sits at `path` in its doc (`""` for the doc's root): row paths are
 * full dot paths from the doc's root, as `settingsEdit` takes them. Nested
 * objects carry their fields as children; enums, bounded numbers,
 * booleans and number pairs get the widgets the scene inspector gives them.
 */
export function settingsRows(
  schema: z.ZodObject,
  value: unknown,
  path: string,
  options: SettingsRowsOptions = {},
): InspectorRow[] {
  const { registry } = options;
  const ctx = {
    registry,
    type: undefined,
    ppm: options.pxPerMetre ?? (registry ? pxPerMetreOf(registry) : DEFAULT_LENGTH_UNIT),
    entity: false,
  };
  const root = nest(segmentsOf(path), value);
  return Object.entries(schema.shape).map(([key, field]) =>
    describeRow(path ? `${path}.${key}` : key, field as z.ZodType, root, ctx),
  );
}

/**
 * What `input` sets `row` to, checked: typed text parsed and rounded as the
 * scene inspector does, `undefined` only for an optional row, and the
 * result passing the row's schema.
 */
export function settingsValue(
  row: InspectorRow,
  input: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const typed = typedValue(row, input, row.value);
  if (!typed.ok) return typed;
  if (typed.value === undefined)
    return row.optional ? typed : { ok: false, error: `${row.title} can't be unset` };
  const parsed = row.schema.safeParse(typed.value);
  return parsed.success
    ? typed
    : { ok: false, error: parsed.error.issues[0]?.message ?? "invalid value" };
}

/** `value` written at `segments` inside a copy of `node`; `undefined` deletes the last key. */
function withValue(node: unknown, segments: readonly string[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (head === undefined) return value;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(node)
    ? [...(node as unknown[])]
    : isPlainObject(node)
      ? { ...node }
      : {};
  const next = withValue((copy as Record<string, unknown>)[head], rest, value);
  if (next === undefined && !Array.isArray(copy)) delete copy[head];
  else (copy as Record<string, unknown>)[head] = next;
  return copy;
}

/** The one edit that writes `value` at `segments`, given the doc as it is now. */
function editFor(
  doc: unknown,
  layout: DocLayout,
  segments: readonly string[],
  value: unknown,
): JsonEdit | null {
  let node = doc;
  let at = layout;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const here = segments.slice(0, i);
    // Inside an atomic or text value only the whole value can be set.
    if (at.as === "atomic" || at.as === "text")
      return { set: jsonPointer(here), value: withValue(node, segments.slice(i), value) };
    const holder = node as Record<string, unknown> | undefined;
    const exists = holder !== null && typeof holder === "object" && Object.hasOwn(holder, seg);
    const deeper = i < segments.length - 1;
    if (!exists && deeper && at.as === "map")
      return value === undefined
        ? null
        : { set: jsonPointer(segments.slice(0, i + 1)), value: nest(segments.slice(i + 1), value) };
    if (!exists) break;
    node = holder![seg];
    at = at.as === "map" ? fieldLayout(at, seg) : at.item;
  }
  return value === undefined
    ? { unset: jsonPointer(segments) }
    : { set: jsonPointer(segments), value };
}

/**
 * One `editAsset` op setting the field at dot `path` on `asset` to `value`
 * (`undefined` unsets it). With the doc as it is now and its kind's
 * layout, the op writes where the layout allows: a value inside an atomic
 * one (`engine.resolution.fit`) sets that whole value, and a field under a
 * missing object sets the object; unsetting under a missing object is no
 * edit at all.
 */
export function settingsEdit(
  asset: AssetId,
  path: string,
  value: unknown,
  current?: { doc: unknown; layout: DocLayout },
): ProjectOp {
  const segments = segmentsOf(path);
  const edit = current
    ? editFor(current.doc, current.layout, segments, value)
    : value === undefined
      ? { unset: jsonPointer(segments) }
      : { set: jsonPointer(segments), value };
  return { op: "editAsset", id: asset, edits: edit ? [edit] : [] };
}

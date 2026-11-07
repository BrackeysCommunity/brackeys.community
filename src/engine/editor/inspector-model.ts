import { z } from "zod";

import type { InspectorWidgetDef, RegisteredType, Registry } from "../game/types";
import { sceneHash } from "../scene/hash";
import { entitySchemaFor, fieldKind, unwrapSchema } from "../scene/schema";
import { aabb, boxCorners, convexHull, isConvex } from "../scene/shape-geometry";
import { parseShape, SHAPE_TYPES, shapeToTuple } from "../scene/shapes";
import type {
  EntityTypeName,
  FieldPath,
  OpBatch,
  Pt,
  Ref,
  SceneDefinition,
  SceneOp,
  ShapeObj,
  ShapeTuple,
  ShapeType,
} from "../scene/types";
import { numberBounds } from "./inspector";
import type { RefTarget } from "./refs";

// ─── Sections ────────────────────────────────────────────

export const INSPECTOR_SECTIONS = [
  "identity",
  "transform",
  "shape",
  "behavior",
  "path",
  "physics",
  "overrides",
] as const;
export type InspectorSectionId = (typeof INSPECTOR_SECTIONS)[number];

export const SECTION_TITLES: Readonly<Record<InspectorSectionId, string>> = {
  identity: "Identity",
  transform: "Transform",
  shape: "Shape",
  behavior: "Behavior",
  path: "Path",
  physics: "Physics",
  overrides: "Overrides",
};

/** `meta.group` values and the section each lands in; the field-builder names map onto the sections. */
const GROUP_SECTIONS: Readonly<Record<string, InspectorSectionId>> = {
  ...Object.fromEntries(INSPECTOR_SECTIONS.map((s) => [s, s])),
  geometry: "shape",
  motion: "path",
  surface: "physics",
};

// ─── Descriptors ─────────────────────────────────────────

export type EnumOption = { value: string | number; label: string };

/** How the site draws a field; the engine only describes it. */
export type FieldWidget =
  /** A number input; `scrub` adds drag-to-scrub on the label, arrows step by `step` (Shift: `bigStep`). */
  | {
      kind: "number";
      integer: boolean;
      unit?: string;
      min?: number;
      max?: number;
      /** `min` itself is out of range. */
      exclusiveMin?: boolean;
      step: number;
      bigStep: number;
      scrub: boolean;
    }
  /** Degrees, a dial plus a field; `snapDeg` is the dial's step. */
  | { kind: "angle"; integer: boolean; snapDeg: number }
  /** An enum of 2–4 values. */
  | { kind: "segmented"; options: EnumOption[] }
  | { kind: "select"; options: EnumOption[] }
  | { kind: "switch" }
  | { kind: "text"; pattern?: string; maxLength?: number }
  /** Paired x and y fields with a pick-in-canvas crosshair. */
  | { kind: "point"; unit?: string; pick: true }
  | { kind: "points"; min?: number }
  | { kind: "tags" }
  /** A combobox of ids whose type (or base) is in `accepts` (`refCandidates`), plus an eyedropper. */
  | { kind: "entity-ref"; accepts: EntityTypeName[]; multiple: boolean }
  /** A tag switcher over `types`; `shapeConversions` says which switches are lossless. */
  | { kind: "shape"; types: ShapeType[] }
  /** Mode, speed, pause and the point list, as `children`. */
  | { kind: "path" }
  | { kind: "object" }
  /** A game's own widget from `registry.widgets`, by the id the field's `meta.widget` names. */
  | { kind: "custom"; id: string; widget: InspectorWidgetDef }
  | { kind: "readonly"; format: "text" | "json" };

export type ModelField = {
  /** Dot path into the entity, as an update op's `set` takes it. */
  path: FieldPath;
  /** The field's own key. */
  name: string;
  /** `meta.title`, else the key. */
  title: string;
  /** The field's `.describe()` text: the tooltip, and what an agent reads in the JSON Schema. */
  description?: string;
  section: InspectorSectionId;
  widget: FieldWidget;
  optional: boolean;
  /** Shown, not edited here: the id (renamed with the `rename` op), the type, computed values. */
  readonly: boolean;
  /** The value every target shares; undefined when unset or `mixed`. */
  value: unknown;
  /** The targets disagree; the site shows "—". */
  mixed: boolean;
  /** What a draft must pass before it commits. */
  schema: z.ZodType;
  /** A path's or an object's fields, paths prefixed with this one's. */
  children?: ModelField[];
};

export type InspectorSectionModel = {
  id: InspectorSectionId;
  title: string;
  fields: ModelField[];
};

export type InspectorModel = {
  refs: Ref[];
  /** The selection's types, in first-seen order. */
  types: EntityTypeName[];
  sections: InspectorSectionModel[];
};

// ─── Reading schemas ─────────────────────────────────────

type FieldMeta = {
  title?: unknown;
  group?: unknown;
  unit?: unknown;
  widget?: unknown;
  accepts?: unknown;
};

/** The field's metadata, inner wrappers first so an outer `.meta()` wins. */
function fieldMeta(schema: z.core.$ZodType): FieldMeta {
  const layers: FieldMeta[] = [];
  for (let s: z.core.$ZodType | undefined = schema; s; ) {
    layers.unshift((z.globalRegistry.get(s) ?? {}) as FieldMeta);
    s = (s._zod.def as { innerType?: z.core.$ZodType }).innerType;
  }
  return Object.assign({}, ...layers) as FieldMeta;
}

const SHAPE_SAMPLES: Record<ShapeType, ShapeTuple> = {
  box: ["box", 0, 0, 1, 1],
  circle: ["circle", 0, 0, 1],
  capsule: ["capsule", 0, 0, 1, 1],
  poly: ["poly", 0, 0, 1, 0, 0, 1],
  chain: ["chain", 0, 0, 1, 0],
};

/** The shape types a shape field accepts, found by trying one of each. */
function shapeTypesOf(schema: z.ZodType): ShapeType[] {
  return SHAPE_TYPES.filter((t) => schema.safeParse(SHAPE_SAMPLES[t]).success);
}

const optionLabel = (v: string | number) =>
  typeof v === "number" ? String(v) : v.replace(/[_-]+/g, " ");

type Ctx = { registry: Registry; type: RegisteredType | undefined };

function widgetFor(schema: z.ZodType, name: string, top: boolean, ctx: Ctx): FieldWidget {
  const meta = fieldMeta(schema);
  if (typeof meta.widget === "string") {
    const widget = ctx.registry.widgets.get(meta.widget);
    if (widget) return { kind: "custom", id: meta.widget, widget };
  }
  const kind = fieldKind(schema);
  if (kind === "shape") return { kind: "shape", types: shapeTypesOf(schema) };
  if (kind === "point")
    return {
      kind: "point",
      pick: true,
      ...(typeof meta.unit === "string" ? { unit: meta.unit } : {}),
    };
  if (kind === "path") return { kind: "path" };

  const inner = unwrapSchema(schema);
  const ref = top ? ctx.type?.refs?.find((r) => r.field === name) : undefined;
  const accepts = ref
    ? [...ref.targets]
    : Array.isArray(meta.accepts)
      ? meta.accepts.filter((t): t is string => typeof t === "string")
      : undefined;
  if (accepts) return { kind: "entity-ref", accepts, multiple: inner instanceof z.ZodArray };

  if (inner instanceof z.ZodNumber) {
    const b = numberBounds(inner);
    const unit = typeof meta.unit === "string" ? meta.unit : undefined;
    if (unit === "deg") return { kind: "angle", integer: b.integer, snapDeg: 15 };
    const step = b.integer || unit === "px" ? 1 : 0.1;
    return {
      kind: "number",
      integer: b.integer,
      ...(unit ? { unit } : {}),
      ...(b.min !== undefined ? { min: b.min } : {}),
      ...(b.max !== undefined ? { max: b.max } : {}),
      ...(b.exclusive ? { exclusiveMin: true } : {}),
      step,
      bigStep: step * 10,
      scrub: unit !== undefined,
    };
  }
  if (inner instanceof z.ZodEnum) {
    const options = (inner.options as (string | number)[]).map((value) => ({
      value,
      label: optionLabel(value),
    }));
    return options.length <= 4 ? { kind: "segmented", options } : { kind: "select", options };
  }
  if (inner instanceof z.ZodBoolean) return { kind: "switch" };
  if (inner instanceof z.ZodLiteral) return { kind: "readonly", format: "text" };
  if (inner instanceof z.ZodString) {
    const json = z.toJSONSchema(inner) as { pattern?: string; maxLength?: number };
    return {
      kind: "text",
      ...(json.pattern ? { pattern: json.pattern } : {}),
      ...(json.maxLength !== undefined ? { maxLength: json.maxLength } : {}),
    };
  }
  if (inner instanceof z.ZodArray) {
    const element = inner.element as z.ZodType;
    if (fieldKind(element) === "point") {
      const min = (z.toJSONSchema(inner) as { minItems?: number }).minItems;
      return { kind: "points", ...(min !== undefined ? { min } : {}) };
    }
    if (unwrapSchema(element) instanceof z.ZodString) return { kind: "tags" };
  }
  if (inner instanceof z.ZodObject) return { kind: "object" };
  return { kind: "readonly", format: "json" };
}

function defaultSection(widget: FieldWidget): InspectorSectionId {
  switch (widget.kind) {
    case "shape":
      return "shape";
    case "point":
    case "angle":
      return "transform";
    case "path":
      return "path";
    default:
      return "behavior";
  }
}

function valueAt(root: unknown, path: FieldPath): unknown {
  let cur = root;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function describeField(
  path: FieldPath,
  schema: z.ZodType,
  root: unknown,
  ctx: Ctx,
  inherited?: InspectorSectionId,
): ModelField {
  const name = path.slice(path.lastIndexOf(".") + 1);
  const meta = fieldMeta(schema);
  const widget = widgetFor(schema, name, !path.includes("."), ctx);
  const group = typeof meta.group === "string" ? GROUP_SECTIONS[meta.group] : undefined;
  const section = group ?? inherited ?? defaultSection(widget);
  const field: ModelField = {
    path,
    name,
    title: typeof meta.title === "string" ? meta.title : name,
    ...(schema.description ? { description: schema.description } : {}),
    section,
    widget,
    optional: schema.safeParse(undefined).success,
    readonly:
      path === "id" ||
      widget.kind === "readonly" ||
      (widget.kind === "custom" && widget.widget.kind === "readonly"),
    value: valueAt(root, path),
    mixed: false,
    schema,
  };
  const inner = unwrapSchema(schema);
  if ((widget.kind === "path" || widget.kind === "object") && inner instanceof z.ZodObject) {
    field.children = Object.entries(inner.shape).map(([k, s]) =>
      describeField(`${path}.${k}`, s as z.ZodType, root, ctx, section),
    );
  }
  return field;
}

function orderedFields(
  shape: z.ZodRawShape,
  order: readonly string[],
): [name: string, schema: z.ZodType][] {
  const names = [
    ...order.filter((n) => n in shape),
    ...Object.keys(shape).filter((n) => !order.includes(n)),
  ];
  return names.map((n) => [n, shape[n] as z.ZodType]);
}

/** One target's fields: every field of an entity's type, or a bulk entry's one field. */
function targetFields(
  registry: Registry,
  target: RefTarget,
): { type?: string; fields: ModelField[] } {
  if (target.kind === "bulk") {
    const info = registry.bulkKey(target.key);
    const type = info && registry.types.get(info.type);
    const schema = type?.shape[info!.field] as z.ZodType | undefined;
    if (!info || !schema) return { fields: [] };
    const root = { [info.field]: target.value };
    return {
      type: info.type,
      fields: [describeField(info.field, schema, root, { registry, type })],
    };
  }
  const type = registry.types.get(target.entity.type);
  const schema = entitySchemaFor(registry, target.entity.type);
  if (!type || !schema) return { fields: [] };
  const ctx = { registry, type };
  const fields = orderedFields(schema.shape, type.inspector?.order ?? []).map(([n, s]) =>
    describeField(n, s, target.entity, ctx),
  );
  return { type: type.type, fields };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The fields every list shares (same path, section and widget), with values compared across them. */
function shared(lists: readonly ModelField[][]): ModelField[] {
  const [first, ...rest] = lists;
  if (!first) return [];
  const out: ModelField[] = [];
  for (const f of first) {
    const others = rest.map((l) => l.find((g) => g.path === f.path));
    if (
      others.some(
        (g) =>
          !g || g.section !== f.section || !same(g.widget, f.widget) || g.optional !== f.optional,
      )
    )
      continue;
    const all = [f, ...(others as ModelField[])];
    const mixed = all.some((g) => g.mixed || !same(g.value, f.value));
    const merged: ModelField = { ...f, value: mixed ? undefined : f.value, mixed };
    if (f.children) merged.children = shared(all.map((g) => g.children ?? []));
    out.push(merged);
  }
  return out;
}

/**
 * What the inspector shows for a selection: each registered type's schema
 * walked into field descriptors, titled by `meta.title`, explained by
 * `.describe()`, drawn by the widget its Zod kind (or a game's
 * `meta.widget`) calls for, and sectioned by `meta.group` or, without one,
 * by kind. With several targets only the fields they share are shown, and a
 * field whose values differ is `mixed`. Pure: the site renders it.
 */
export function buildInspectorModel(
  registry: Registry,
  targets: readonly RefTarget[],
): InspectorModel {
  const per = targets.map((t) => targetFields(registry, t));
  const types = [...new Set(per.flatMap((p) => (p.type ? [p.type] : [])))];
  const fields = shared(per.map((p) => p.fields));
  const sections = INSPECTOR_SECTIONS.map((id) => ({
    id,
    title: SECTION_TITLES[id],
    fields: fields.filter((f) => f.section === id),
  })).filter((s) => s.fields.length > 0);
  return { refs: targets.map((t) => t.ref), types, sections };
}

// ─── Edits ───────────────────────────────────────────────

/**
 * A number typed into a field: a plain number, or a relative edit applied
 * to `current` (`+=16`, `-=8`, `*=2`, `/=2`). Undefined when it's neither,
 * or relative with no current number.
 */
export function parseRelative(text: string, current: unknown): number | undefined {
  const num = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
  const rel = new RegExp(String.raw`^\s*([+\-*/])=\s*(${num})\s*$`, "i").exec(text);
  if (rel) {
    if (typeof current !== "number") return undefined;
    const n = Number(rel[2]);
    const out =
      rel[1] === "+"
        ? current + n
        : rel[1] === "-"
          ? current - n
          : rel[1] === "*"
            ? current * n
            : current / n;
    return Number.isFinite(out) ? out : undefined;
  }
  return new RegExp(String.raw`^\s*${num}\s*$`, "i").test(text) ? Number(text) : undefined;
}

export type ModelEdit = { ok: true; ops: SceneOp[] } | { ok: false; error: string };

const numeric = (w: FieldWidget) => w.kind === "number" || w.kind === "angle";

/**
 * The update ops that set `field` to `input` on each target, one per
 * target whose value changes. On a number field a string is parsed by
 * `parseRelative` against each target's own value, so `+=16` moves every
 * one. `undefined` unsets an optional field. Fails without ops when any
 * target's new value doesn't pass the field's schema.
 */
export function modelOps(
  field: ModelField,
  input: unknown,
  targets: readonly RefTarget[],
): ModelEdit {
  const ops: SceneOp[] = [];
  for (const t of targets) {
    const current =
      t.kind === "bulk"
        ? field.path.includes(".")
          ? undefined
          : t.value
        : valueAt(t.entity, field.path);
    let next = input;
    if (typeof input === "string" && numeric(field.widget)) {
      next = parseRelative(input, current);
      if (next === undefined)
        return { ok: false, error: `"${input}" isn't a number or a relative edit like +=16` };
      if (field.widget.kind !== "number" || field.widget.integer) next = Math.round(next as number);
    }
    if (same(next, current)) continue;
    if (next === undefined) {
      if (!field.optional || t.kind === "bulk")
        return { ok: false, error: `${field.title} can't be unset` };
      ops.push({ op: "update", ref: t.ref, unset: [field.path] });
      continue;
    }
    const parsed = field.schema.safeParse(next);
    if (!parsed.success)
      return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid value" };
    ops.push({ op: "update", ref: t.ref, set: { [field.path]: next } });
  }
  return { ok: true, ops };
}

/** `modelOps` as one undoable batch, with the `base` hash bulk refs need. */
export function modelBatch(
  field: ModelField,
  input: unknown,
  targets: readonly RefTarget[],
  def: SceneDefinition,
): { ok: true; batch: OpBatch } | { ok: false; error: string } {
  const edit = modelOps(field, input, targets);
  if (!edit.ok) return edit;
  const bulk = targets.some((t) => t.kind === "bulk");
  return {
    ok: true,
    batch: {
      label: `Set ${field.title}`,
      ...(bulk ? { base: sceneHash(def) } : {}),
      ops: edit.ops,
    },
  };
}

/** Ids an entity-ref field may name: entities whose type, or its base, is in `accepts`. */
export function refCandidates(
  def: SceneDefinition,
  registry: Registry,
  accepts: readonly EntityTypeName[],
): string[] {
  return (def.entities ?? [])
    .filter((e) => {
      const base = registry.types.get(e.type)?.base;
      return accepts.includes(e.type) || (base !== undefined && accepts.includes(base));
    })
    .map((e) => e.id);
}

// ─── Shape conversions ───────────────────────────────────

export type ShapeConversion = {
  to: ShapeType;
  tuple: ShapeTuple;
  /** Converting back gives the same shape. */
  lossless: boolean;
  /** What a lossy conversion loses, for the warning. */
  note?: string;
};

type Box = Extract<ShapeObj, { type: "box" }>;

const round = (n: number) => Math.round(n);
const pos = (n: number) => Math.max(1, round(n));
const roundPts = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [round(x), round(y)]);
const outline = (pts: Pt[], to: "poly" | "chain"): ShapeObj =>
  to === "poly" ? { type: "poly", pts } : { type: "chain", pts: [...pts, pts[0]!] };

function boundingBox(s: ShapeObj): Box {
  const b = aabb(s);
  return {
    type: "box",
    cx: round((b.minX + b.maxX) / 2),
    cy: round((b.minY + b.maxY) / 2),
    hw: pos((b.maxX - b.minX) / 2),
    hh: pos((b.maxY - b.minY) / 2),
    rotDeg: 0,
  };
}

function roundFromBox(b: Box, to: "circle" | "capsule"): ShapeObj {
  if (to === "circle") return { type: "circle", cx: b.cx, cy: b.cy, r: pos(Math.max(b.hw, b.hh)) };
  return {
    type: "capsule",
    cx: b.cx,
    cy: b.cy,
    halfLen: pos(Math.abs(b.hw - b.hh)),
    r: pos(Math.min(b.hw, b.hh)),
    // A capsule's axis is vertical before rotation.
    rotDeg: b.hw > b.hh ? (b.rotDeg + 90) % 360 : b.rotDeg,
  };
}

/** Whether `pts` are the four corners of an axis-aligned rectangle. */
function isAxisRect(pts: readonly Pt[]): boolean {
  return (
    pts.length === 4 &&
    new Set(pts.map((p) => p[0])).size === 2 &&
    new Set(pts.map((p) => p[1])).size === 2 &&
    new Set(pts.map((p) => `${p[0]},${p[1]}`)).size === 4
  );
}

const isClosed = (pts: readonly Pt[]) =>
  pts.length > 2 && pts[0]![0] === pts.at(-1)![0] && pts[0]![1] === pts.at(-1)![1];

type Converted = { shape: ShapeObj; lossless: boolean; note?: string };

function convert(s: ShapeObj, to: ShapeType): Converted {
  const lossy = (shape: ShapeObj, note: string): Converted => ({ shape, lossless: false, note });
  const HOLLOW = "a chain is an outline with no inside";
  switch (s.type) {
    case "box": {
      const corners = roundPts(boxCorners(s));
      if (to === "poly")
        return s.rotDeg % 90 === 0
          ? { shape: outline(corners, "poly"), lossless: true }
          : lossy(outline(corners, "poly"), "corners round to whole pixels");
      if (to === "chain") return lossy(outline(corners, "chain"), HOLLOW);
      return lossy(roundFromBox(s, to as "circle" | "capsule"), "the corners become round");
    }
    case "circle": {
      if (to === "box") return lossy(boundingBox(s), "the circle becomes a square");
      if (to === "capsule")
        return lossy(
          { type: "capsule", cx: s.cx, cy: s.cy, halfLen: 1, r: s.r, rotDeg: 0 },
          "it stretches by 2px",
        );
      const step = Math.PI / 4;
      const pts = roundPts(
        Array.from(
          { length: 8 },
          (_, i): Pt => [s.cx + s.r * Math.cos(i * step), s.cy + s.r * Math.sin(i * step)],
        ),
      );
      return lossy(outline(pts, to as "poly" | "chain"), "the circle becomes an octagon");
    }
    case "capsule": {
      const box: Box = {
        type: "box",
        cx: s.cx,
        cy: s.cy,
        hw: s.r,
        hh: s.halfLen + s.r,
        rotDeg: s.rotDeg,
      };
      if (to === "box") return lossy(box, "the ends become square");
      if (to === "circle")
        return lossy(
          { type: "circle", cx: s.cx, cy: s.cy, r: s.halfLen + s.r },
          "it becomes a circle",
        );
      return lossy(
        outline(roundPts(boxCorners(box)), to as "poly" | "chain"),
        "the ends become square",
      );
    }
    case "poly": {
      if (to === "chain") return lossy(outline(s.pts, "chain"), HOLLOW);
      const box = boundingBox(s);
      if (to === "box")
        return isAxisRect(s.pts)
          ? { shape: box, lossless: true }
          : lossy(box, "it becomes its bounding box");
      return lossy(roundFromBox(box, to as "circle" | "capsule"), "it becomes a round shape");
    }
    case "chain": {
      const ring = isClosed(s.pts) ? s.pts.slice(0, -1) : s.pts;
      if (to === "poly")
        return isClosed(s.pts) && ring.length >= 3 && isConvex(ring)
          ? { shape: { type: "poly", pts: ring }, lossless: true }
          : lossy({ type: "poly", pts: roundPts(convexHull(ring)) }, "it becomes its convex hull");
      const box = boundingBox(s);
      if (to === "box") return lossy(box, "it becomes its bounding box");
      return lossy(roundFromBox(box, to as "circle" | "capsule"), "it becomes a round shape");
    }
  }
}

/**
 * What the shape tag switcher offers for `tuple`: each of `types` other
 * than its own, converted, and whether converting is lossless (an
 * axis-aligned box to a poly and back) or what it loses.
 */
export function shapeConversions(
  tuple: ShapeTuple,
  types: readonly ShapeType[] = SHAPE_TYPES,
): ShapeConversion[] {
  const parsed = parseShape(tuple);
  if (!parsed.ok) return [];
  const s = parsed.shape;
  return types
    .filter((t) => t !== s.type)
    .map((to) => {
      const { shape, ...rest } = convert(s, to);
      return { to, tuple: shapeToTuple(shape), ...rest };
    });
}

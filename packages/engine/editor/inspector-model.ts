import { z } from "zod";

import {
  BEHAVIORS_FIELD,
  type BehaviorCategory,
  type BehaviorName,
  type RegisteredBehavior,
} from "../game/behaviors";
import { DEFAULT_LENGTH_UNIT, DEFAULT_TIME } from "../game/defaults";
import { behaviorsConflict } from "../game/define";
import { assetKindsOf, CHILD_REF_PATTERN, SIDES } from "../game/fields";
import { capitalise } from "../game/live";
import type { BehaviorRules, InspectorWidgetDef, RegisteredType, Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { ANIMATION_KIND } from "../project/kinds/animation";
import { ATLAS_KIND } from "../project/kinds/atlas";
import type { AssetId, AssetKindName } from "../project/types";
import { bulkKeysOf } from "../scene/expand";
import { splitFieldPath } from "../scene/field-path";
import { sceneHash } from "../scene/hash";
import { CHILD_SEPARATOR, childEntity, resolvePrefab, splitOverridePath } from "../scene/resolve";
import { entitySchemaFor, fieldKind, InstanceSchema, unwrapSchema } from "../scene/schema";
import { aabb, boxCorners, convexHull, isConvex } from "../scene/shape-geometry";
import { parseShape, SHAPE_TYPES, shapeToTuple } from "../scene/shapes";
import { addPt, isPt } from "../scene/translate";
import {
  PREFAB_MAX_DEPTH,
  type EntityDef,
  type EntityTypeName,
  type FieldPath,
  type InstanceDef,
  type OpBatch,
  type OverridePath,
  type PrefabLibrary,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneOp,
  type ShapeObj,
  type ShapeTuple,
  type ShapeType,
} from "../scene/types";
import {
  LENGTH_UNITS,
  lengthDecimals,
  roundLength,
  snapToPixel,
  type LengthUnitName,
} from "../scene/units";
import { validateScene } from "../scene/validate";
import { editPose } from "./gizmos/behavior-target";
import { numberBounds } from "./inspector";
import { nestedInstanceOf, prefabInstances } from "./prefab-commands";
import { referableEntities, type RefTarget } from "./refs";
import { entityGeometry } from "./spatial-index";

// ─── Sections ────────────────────────────────────────────

export const INSPECTOR_SECTIONS = [
  "identity",
  "transform",
  "shape",
  "behavior",
  "assets",
  "path",
  "physics",
  "overrides",
] as const;
export type InspectorSectionId = (typeof INSPECTOR_SECTIONS)[number];

export const SECTION_TITLES: Readonly<Record<InspectorSectionId, string>> = {
  identity: "Identity",
  transform: "Transform",
  shape: "Shape",
  behavior: "Gameplay",
  assets: "Assets",
  path: "Path",
  physics: "Physics",
  overrides: "Overrides",
};

/** A carried behavior's own section. */
export type BehaviorSectionId = `behaviors:${BehaviorName}`;
export type ModelSectionId = InspectorSectionId | BehaviorSectionId;

const behaviorSectionId = (name: BehaviorName): BehaviorSectionId => `behaviors:${name}`;

/** `meta.group` values and the section each lands in; the field-builder names map onto the sections. */
const GROUP_SECTIONS: Readonly<Record<string, InspectorSectionId>> = {
  ...Object.fromEntries(INSPECTOR_SECTIONS.map((s) => [s, s])),
  geometry: "shape",
  motion: "path",
  surface: "physics",
  body: "physics",
};

// ─── Descriptors ─────────────────────────────────────────

export type EnumOption = { value: string | number; label: string; description?: string };

/** How the site draws a field; the engine only describes it. */
export type FieldWidget =
  /**
   * A number input; `scrub` adds drag-to-scrub on the label, one `step` per
   * screen px; arrows step by `step` (Shift: `bigStep`). An `m` field steps
   * one world px, an `m/s` or `m/s²` field 0.01.
   */
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
      /** Decimals to show: for an `m` field, the ones one world px needs (`lengthDecimals`). */
      decimals?: number;
      /**
       * Shown in `unit` as the stored value times this (a `rad/s` field as
       * `°/s`): the row's value and default are shown values, and what is
       * typed is divided back.
       */
      scale?: number;
    }
  /**
   * A [low, high] pair (`meta.widget: "range"`, a joint's limits): two number
   * fields and a unit, stepping as a number field does. `scale` as a
   * number field's.
   */
  | {
      kind: "range";
      unit?: string;
      scale?: number;
      step: number;
      bigStep: number;
      decimals?: number;
    }
  /** Degrees, a dial plus a field; `snapDeg` is the dial's step. */
  | { kind: "angle"; integer: boolean; snapDeg: number }
  /** An enum of 2–4 values. */
  | { kind: "segmented"; options: EnumOption[] }
  | { kind: "select"; options: EnumOption[] }
  | { kind: "switch" }
  | { kind: "text"; pattern?: string; maxLength?: number }
  /**
   * Paired x and y fields; a metric one steps and shows as an `m` number
   * does. `pick` adds a pick-in-canvas crosshair: a scene point has one, a
   * plain number pair (a setting's gravity) doesn't. `either` as an
   * entity-ref's.
   */
  | {
      kind: "point";
      unit?: string;
      pick: boolean;
      step?: number;
      bigStep?: number;
      decimals?: number;
      either?: true;
    }
  | { kind: "points"; min?: number }
  /**
   * A list of names as chips. With `options` (`meta.widget: "collision-group"`)
   * new ones are picked from those, else typed; `placeholder` is the add box's.
   */
  | { kind: "tags"; options?: string[]; placeholder?: string }
  /**
   * A combobox of ids whose type (or base) is in `accepts` (`refCandidates`),
   * plus an eyedropper. With `any`, every entity but the selection: a
   * behavior's reference, which names no types (`accepts` is empty).
   * `either`: the field takes a point or an entity (`nav-agent.to`), and
   * this widget is the form its value holds; the other is a switch away.
   */
  | {
      kind: "entity-ref";
      accepts: EntityTypeName[];
      multiple: boolean;
      any?: true;
      either?: true;
    }
  /** A tag switcher over `types`; `shapeConversions` says which switches are lossless. */
  | { kind: "shape"; types: ShapeType[] }
  /** Mode, speed, pause and the point list, as `children`. */
  | { kind: "path" }
  | { kind: "object" }
  /**
   * A list of objects: one object row per item in `children`, titled
   * `item` and its number from 1, with add and remove within `min` and
   * `max`. Add copies the last item, or `seed` into an empty list.
   */
  | { kind: "list"; item: string; min?: number; max?: number; seed?: unknown }
  /**
   * A `Delay`-shaped value: whole ticks, or `{ ms }`. One number in the
   * form the value holds (ms when unset) and a switch between the two,
   * converting at the game's `rate` ticks per second.
   */
  | { kind: "delay"; min: number; rate: number }
  /**
   * An sRGB colour, for `meta.widget: "color"` when the game registers no
   * widget of that id: a swatch that opens a picker, and a hex field. A
   * number field stores `0xRRGGBB`, a string one `#rrggbb`.
   */
  | { kind: "color" }
  /**
   * A project asset of one of `kinds` (an `assetField`). When an atlas is
   * among them and the field has a sibling string field named `frame`,
   * `frame` is that field's path; when an animation is among them and it has
   * one named `clip`, `clip` is. Picking an asset sets the asset and its part.
   */
  | { kind: "asset"; kinds: AssetKindName[]; frame?: FieldPath; clip?: FieldPath }
  /** A game's own widget from `registry.widgets`, by the id the field's `meta.widget` names. */
  | { kind: "custom"; id: string; widget: InspectorWidgetDef }
  | { kind: "readonly"; format: "text" | "json" };

/** One field as any schema-driven form draws it: the scene inspector's fields and the settings panels' rows. */
export type InspectorRow = {
  /** Dot path from the root of the entity or doc, as an update op's `set` or `settingsEdit` takes it. */
  path: FieldPath;
  /** The field's own key. */
  name: string;
  /** `meta.title`, else the key in sentence case (`fieldTitle`). */
  title: string;
  /** The field's `.describe()` text: the tooltip, and what an agent reads in the JSON Schema. */
  description?: string;
  widget: FieldWidget;
  optional: boolean;
  /** What an unset field takes: a behavior's or the type's default, else the schema's `meta.default`. */
  defaultValue?: unknown;
  /** `meta.placeholder`: what an unset field without one fixed default falls back to, in words. */
  placeholder?: string;
  /** Shown, not edited here: the id (renamed with the `rename` op), the type, computed values. */
  readonly: boolean;
  /** The value every target shares; undefined when unset or `mixed`. */
  value: unknown;
  /** The targets disagree; the site shows "—". */
  mixed: boolean;
  /** What a draft must pass before it commits. */
  schema: z.ZodType;
  /** A path's or an object's fields, paths prefixed with this one's. */
  children?: InspectorRow[];
};

/** An inspector row placed in a section of the scene inspector. */
export type ModelField = Omit<InspectorRow, "children"> & {
  section: ModelSectionId;
  /** A behavior field's `meta.group` (`jump`, `surface`): the sub-heading the inspector puts it under. */
  group?: string;
  children?: ModelField[];
};

/** A behavior section's block, and the batch that drops it. */
export type BehaviorSectionInfo = {
  name: BehaviorName;
  description?: string;
  /** One update per target removing the block; absent when a target's type requires it. */
  remove?: OpBatch;
};

export type InspectorSectionModel = {
  id: ModelSectionId;
  title: string;
  fields: ModelField[];
  /** Set on a `behaviors:<name>` section. */
  behavior?: BehaviorSectionInfo;
};

/** A behavior the Add behavior menu offers, with the batch that adds it. */
export type BehaviorOption = {
  name: BehaviorName;
  label: string;
  description: string;
  /** The behavior's `inspector.category`: its Add behavior heading; a game's own without one list under Game. */
  category?: BehaviorCategory;
  /**
   * One update per target that lacks the block. It also adds the behaviors
   * it requires that a target lacks, each from its own template.
   */
  batch: OpBatch;
  /** The required behaviors `batch` adds alongside it, by label. */
  adds?: string[];
  /** The project assets `batch` names, each with the clip it picked (`hero (idle)`). */
  uses?: string[];
  /** Why it can't be added yet (a reference with nothing in the scene to name); `batch` would fail. */
  unavailable?: string;
};

export type InspectorModel = {
  refs: Ref[];
  /** The selection's types, in first-seen order. */
  types: EntityTypeName[];
  sections: InspectorSectionModel[];
  /** What Add behavior lists: behaviors every target's type allows and not every target carries. */
  addBehaviors: BehaviorOption[];
};

// ─── Reading schemas ─────────────────────────────────────

type FieldMeta = {
  title?: unknown;
  group?: unknown;
  unit?: unknown;
  widget?: unknown;
  accepts?: unknown;
  default?: unknown;
  placeholder?: unknown;
  when?: unknown;
  units?: unknown;
  options?: unknown;
  enum?: unknown;
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

/** One value's `meta.options` entry: `{ revolute: { label: "Hinge", description: "…" } }`. */
type OptionMeta = { label?: unknown; description?: unknown };

/**
 * A choice among `values`: segmented for up to four, else a select. A
 * value `meta.options` names reads by its label, the value after it when
 * they differ ("Hinge (revolute)"), with its description as the tooltip.
 */
function choice(values: readonly (string | number)[], meta?: unknown): FieldWidget {
  const named = meta !== null && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
  const options = values.map((value): EnumOption => {
    const plain = optionLabel(value);
    const entry = named[String(value)] as OptionMeta | undefined;
    const label = typeof entry?.label === "string" ? entry.label : undefined;
    return {
      value,
      label:
        label && label.toLowerCase() !== plain.toLowerCase()
          ? `${label} (${plain})`
          : (label ?? plain),
      ...(typeof entry?.description === "string" ? { description: entry.description } : {}),
    };
  });
  return options.length <= 4 ? { kind: "segmented", options } : { kind: "select", options };
}

/**
 * What a schema walk reads beyond the schema: the game's widgets, layers
 * and px per metre, and, for an entity, its type's refs. `entity` is false
 * for a settings doc, whose top-level keys are no entity fields.
 */
export type FieldCtx = {
  registry: Registry | undefined;
  type: RegisteredType | undefined;
  ppm: number;
  entity: boolean;
  /** A behavior block's current value of `key`, its default when unset: what `meta.units` reads. */
  block?: (key: string) => unknown;
};

type Ctx = FieldCtx;

const entityCtx = (registry: Registry, type: RegisteredType | undefined): Ctx => ({
  registry,
  type,
  ppm: pxPerMetreOf(registry),
  entity: true,
});

/** A tuple of exactly two numbers that isn't a point, vector or other kinded field. */
function isNumberPair(schema: z.ZodType, inner: z.core.$ZodType): boolean {
  if (fieldKind(schema) !== "value" || !(inner instanceof z.ZodTuple)) return false;
  const items = inner.def.items;
  return (
    inner.def.rest === null &&
    items.length === 2 &&
    items.every((item) => unwrapSchema(item) instanceof z.ZodNumber)
  );
}

const isLengthUnit = (unit: unknown): unit is LengthUnitName =>
  (LENGTH_UNITS as readonly unknown[]).includes(unit);

/**
 * How a metric field steps and how many decimals it shows, at `pxPerMetre`:
 * a length one world px (ten with Shift), a speed or an acceleration 0.01.
 */
export function lengthStep(
  unit: LengthUnitName,
  pxPerMetre: number,
): { step: number; bigStep: number; decimals: number } {
  return unit === "m"
    ? { step: 1 / pxPerMetre, bigStep: 10 / pxPerMetre, decimals: lengthDecimals(pxPerMetre) }
    : { step: 0.01, bigStep: 0.1, decimals: 2 };
}

/**
 * The unit a field is in: `meta.units` by a block field's current value
 * (`{ kind: { revolute: "rad", prismatic: "m" } }`), else `meta.unit`.
 */
function unitOf(meta: FieldMeta, ctx: Ctx): string | undefined {
  if (ctx.block && meta.units !== null && typeof meta.units === "object") {
    for (const [key, byValue] of Object.entries(meta.units)) {
      const value = ctx.block(key);
      const unit =
        byValue !== null && typeof byValue === "object" && typeof value === "string"
          ? (byValue as Record<string, unknown>)[value]
          : undefined;
      if (typeof unit === "string") return unit;
    }
  }
  return typeof meta.unit === "string" ? meta.unit : undefined;
}

/** The unit a field shows in, and the factor from stored to shown: radians show as degrees. */
function shownUnit(unit: string | undefined): { unit?: string; scale?: number } {
  if (unit === "rad") return { unit: "°", scale: 180 / Math.PI };
  if (unit === "rad/s") return { unit: "°/s", scale: 180 / Math.PI };
  return unit === undefined ? {} : { unit };
}

/** A shown number, rid of the float noise a conversion leaves (89.99999999999999°). */
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;

/** `value` as `scale` converts it, number by number; anything else unchanged. */
function scaled(value: unknown, by: (n: number) => number): unknown {
  if (typeof value === "number") return by(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "number"))
    return value.map((v: number) => by(v));
  return value;
}

/** A string field holding an entity id or an instance child's ref (`refField`). */
function isChildRef(inner: z.core.$ZodType): boolean {
  if (!(inner instanceof z.ZodString)) return false;
  const patterns = (inner._zod.bag as { patterns?: Set<RegExp> }).patterns;
  return [...(patterns ?? [])].some((p) => p.source === CHILD_REF_PATTERN.source);
}

/** A select over the game's actions a behavior can read (`ui` ones never reach the simulation). */
function actionChoice(registry: Registry): FieldWidget {
  const options = registry.actions
    .filter((a) => a.ui !== true)
    .map((a) => ({
      value: a.action,
      label: a.kind && a.kind !== "button" ? `${a.action} (${a.kind})` : a.action,
    }));
  return { kind: "select", options };
}

function widgetFor(
  schema: z.ZodType,
  name: string,
  top: boolean,
  ctx: Ctx,
  value?: unknown,
): FieldWidget {
  const meta = fieldMeta(schema);
  if (typeof meta.widget === "string") {
    const widget = ctx.registry?.widgets.get(meta.widget);
    if (widget) return { kind: "custom", id: meta.widget, widget };
    if (meta.widget === "color") return { kind: "color" };
    if (meta.widget === "action" && ctx.registry) return actionChoice(ctx.registry);
    if (meta.widget === "type" && ctx.registry) return choice(ctx.registry.typeNames);
    const groups = ctx.registry?.collisionGroupNames ?? [];
    if (meta.widget === "collision-group" && groups.length > 0) {
      if (unwrapSchema(schema) instanceof z.ZodArray)
        return { kind: "tags", options: [...groups], placeholder: "Add a group" };
      return choice(groups);
    }
  }
  const assetKinds = assetKindsOf(schema);
  if (assetKinds) return { kind: "asset", kinds: [...assetKinds] };
  if (top && ctx.entity && ctx.registry && name === "layer")
    return choice(ctx.registry.layers.map((l) => l.name));
  const kind = fieldKind(schema);
  if (kind === "shape") return { kind: "shape", types: shapeTypesOf(schema) };
  const declared = unitOf(meta, ctx);
  const point = (pick: boolean): FieldWidget => ({
    kind: "point",
    pick,
    ...(declared !== undefined ? { unit: declared } : {}),
    ...(isLengthUnit(declared) ? lengthStep(declared, ctx.ppm) : {}),
  });
  if (kind === "point") return point(true);
  if (kind === "vector") return point(false);
  if (kind === "path") return { kind: "path" };
  if (kind === "side") return choice(SIDES);

  const inner = unwrapSchema(schema);
  const ref = top && ctx.entity ? ctx.type?.refs?.find((r) => r.field === name) : undefined;
  const accepts = ref
    ? [...ref.targets]
    : Array.isArray(meta.accepts)
      ? meta.accepts.filter((t): t is string => typeof t === "string")
      : undefined;
  if (accepts) return { kind: "entity-ref", accepts, multiple: inner instanceof z.ZodArray };
  if (isChildRef(inner)) return { kind: "entity-ref", accepts: [], multiple: false, any: true };
  const { unit, scale } = shownUnit(declared);
  if (isNumberPair(schema, inner)) {
    if (meta.widget !== "range") return point(false);
    const length = isLengthUnit(unit) ? lengthStep(unit, ctx.ppm) : undefined;
    return {
      kind: "range",
      ...(unit ? { unit } : {}),
      ...(scale ? { scale } : {}),
      step: length?.step ?? 1,
      bigStep: length?.bigStep ?? (scale ? 15 : 10),
      decimals: length?.decimals ?? 2,
    };
  }

  if (inner instanceof z.ZodNumber) {
    const b = numberBounds(inner);
    if (declared === "deg") return { kind: "angle", integer: b.integer, snapDeg: 15 };
    const length = !b.integer && isLengthUnit(unit) ? lengthStep(unit, ctx.ppm) : undefined;
    const step = length?.step ?? (b.integer || unit === "px" ? 1 : scale ? 1 : 0.1);
    const bigStep = length?.bigStep ?? step * 10;
    const show = (n: number) => (scale ? tidy(n * scale) : n);
    return {
      kind: "number",
      integer: b.integer,
      ...(unit ? { unit } : {}),
      ...(b.min !== undefined ? { min: show(b.min) } : {}),
      ...(b.max !== undefined ? { max: show(b.max) } : {}),
      ...(b.exclusive ? { exclusiveMin: true } : {}),
      step,
      bigStep,
      scrub: unit !== undefined,
      ...(length ? { decimals: length.decimals } : scale ? { decimals: 2 } : {}),
      ...(scale ? { scale } : {}),
    };
  }
  if (inner instanceof z.ZodEnum) {
    return choice(inner.options as (string | number)[], meta.options);
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
    if (unwrapSchema(element) instanceof z.ZodObject) {
      const { minimum, maximum } = inner._zod.bag as { minimum?: number; maximum?: number };
      const title = fieldMeta(element).title;
      const seed = seedValue(element);
      return {
        kind: "list",
        item: typeof title === "string" ? title : "Item",
        ...(minimum !== undefined ? { min: minimum } : {}),
        ...(maximum !== undefined ? { max: maximum } : {}),
        ...(seed !== undefined ? { seed } : {}),
      };
    }
  }
  if (inner instanceof z.ZodObject) return { kind: "object" };
  const delayMin = delayUnionMin(inner);
  if (delayMin !== undefined)
    return {
      kind: "delay",
      min: delayMin,
      rate: ctx.registry?.game?.time?.rate ?? DEFAULT_TIME.rate,
    };
  if (inner instanceof z.ZodUnion) {
    // A point or an entity (`nav-agent.to`): the editor for the form the value holds, an entity when unset.
    const options = inner.options as z.ZodType[];
    const at = options.find((o) => fieldKind(o) === "vector" || fieldKind(o) === "point");
    if (at && options.some((o) => isChildRef(unwrapSchema(o)))) {
      if (!Array.isArray(value))
        return { kind: "entity-ref", accepts: [], multiple: false, any: true, either: true };
      const point = widgetFor(at, name, top, ctx);
      return point.kind === "point" ? { ...point, either: true } : point;
    }
  }
  return { kind: "readonly", format: "json" };
}

/**
 * The least a `Delay`-shaped union takes (whole ticks with `meta.unit`
 * "ticks", or an object of `ms` alone), or undefined for any other schema.
 */
function delayUnionMin(inner: z.core.$ZodType): number | undefined {
  if (!(inner instanceof z.ZodUnion) || inner.options.length !== 2) return undefined;
  const [ticks, ms] = inner.options as [z.ZodType, z.ZodType];
  const count = unwrapSchema(ticks);
  const object = unwrapSchema(ms);
  if (!(count instanceof z.ZodNumber) || fieldMeta(ticks).unit !== "ticks") return undefined;
  if (!(object instanceof z.ZodObject) || Object.keys(object.shape).join() !== "ms")
    return undefined;
  return numberBounds(count).min ?? 0;
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

/** The value at `path`, with a side field's `true` shown as the `"up"` it means. */
function fieldValue(schema: z.ZodType, root: unknown, path: FieldPath): unknown {
  const value = valueAt(root, path);
  return value === true && fieldKind(schema) === "side" ? "up" : value;
}

const ACRONYM = /^(?:id|ui|url|fps|hud|rng|ai)$/i;

/**
 * A key as a label when the schema gives no title: camelCase, kebab-case and
 * snake_case split into words, sentence-cased, acronyms kept upper-case.
 * `aiStepTicks` reads "AI step ticks", `end-turn` "End turn".
 */
export function fieldTitle(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) =>
      ACRONYM.test(w) || (w.length > 1 && /^[A-Z0-9]+$/.test(w))
        ? w.toUpperCase()
        : w.toLowerCase(),
    );
  const text = words.join(" ");
  return text ? capitalise(text) : name;
}

/** Where a field lands: `forced` always (a behavior's block), else its group, `inherited`, or its kind's. */
type Placement = { inherited?: ModelSectionId; forced?: ModelSectionId };

/**
 * The row for the field at `path` (its value read from `root` by that
 * path), with a path's or an object's fields as children: its widget from
 * its Zod kind or `meta.widget`, its title, help, default and placeholder
 * from its metadata. An entity's `id`, or a doc's `id` key, is read-only.
 */
export function describeRow(
  path: FieldPath,
  schema: z.ZodType,
  root: unknown,
  ctx: FieldCtx,
): InspectorRow {
  const name = path.slice(path.lastIndexOf(".") + 1);
  const meta = fieldMeta(schema);
  const stored = fieldValue(schema, root, path);
  const widget = widgetFor(schema, name, !path.includes("."), ctx, stored);
  const scale = "scale" in widget ? widget.scale : undefined;
  const shown = (v: unknown) => (scale ? scaled(v, (n) => tidy(n * scale)) : v);
  const value = shown(stored);
  const row: InspectorRow = {
    path,
    name,
    title: typeof meta.title === "string" ? meta.title : fieldTitle(name),
    ...(schema.description ? { description: schema.description } : {}),
    widget,
    optional: schema.safeParse(undefined).success,
    readonly:
      (ctx.entity ? path === "id" : name === "id") ||
      widget.kind === "readonly" ||
      (widget.kind === "custom" && widget.widget.kind === "readonly"),
    value,
    mixed: false,
    schema,
  };
  if (row.optional && meta.default !== undefined) row.defaultValue = shown(meta.default);
  if (typeof meta.placeholder === "string") row.placeholder = meta.placeholder;
  const inner = unwrapSchema(schema);
  if ((widget.kind === "path" || widget.kind === "object") && inner instanceof z.ZodObject) {
    row.children = linkFrames(
      Object.entries(inner.shape).map(([k, s]) =>
        describeRow(`${path}.${k}`, s as z.ZodType, root, ctx),
      ),
    );
  }
  if (widget.kind === "list" && inner instanceof z.ZodArray && Array.isArray(stored)) {
    const element = inner.element as z.ZodType;
    row.children = stored.map((_, i) => ({
      ...describeRow(`${path}.${i}`, element, root, ctx),
      title: `${widget.item} ${i + 1}`,
    }));
  }
  return row;
}

/** `row` and its children in their sections: `forced`, else the field's group, the parent's, or its kind's. */
function placeRow(row: InspectorRow, place: Placement): ModelField {
  const { path, name, title, description, children, ...rest } = row;
  const group = fieldMeta(row.schema).group;
  const section =
    place.forced ??
    (typeof group === "string" ? GROUP_SECTIONS[group] : undefined) ??
    place.inherited ??
    defaultSection(row.widget);
  const field: ModelField = {
    path,
    name,
    title,
    ...(description !== undefined ? { description } : {}),
    section,
    ...rest,
  };
  if (children) field.children = children.map((c) => placeRow(c, { ...place, inherited: section }));
  return field;
}

function describeField(
  path: FieldPath,
  schema: z.ZodType,
  root: unknown,
  ctx: Ctx,
  place: Placement = {},
): ModelField {
  return placeRow(describeRow(path, schema, root, ctx), place);
}

/**
 * Points each asset field at the sibling text field naming a part of the
 * asset: `frame` for one taking atlases, `clip` for one taking animations
 * (whose atlases' tags are clips too). `siblings` share one parent.
 */
function linkFrames<R extends InspectorRow>(siblings: R[]): R[] {
  const part = (name: string) => siblings.find((f) => f.name === name && f.widget.kind === "text");
  const frame = part("frame");
  const clip = part("clip");
  if (!frame && !clip) return siblings;
  for (const f of siblings) {
    if (f.widget.kind !== "asset") continue;
    if (frame && f.widget.kinds.includes(ATLAS_KIND)) f.widget = { ...f.widget, frame: frame.path };
    if (clip && f.widget.kinds.includes(ANIMATION_KIND))
      f.widget = { ...f.widget, clip: clip.path };
  }
  return siblings;
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
      fields: [describeField(info.field, schema, root, entityCtx(registry, type))],
    };
  }
  const type = registry.types.get(target.entity.type);
  const schema = entitySchemaFor(registry, target.entity.type);
  if (!type || !schema) return { fields: [] };
  const ctx = entityCtx(registry, type);
  const fields = orderedFields(schema.shape, type.inspector?.order ?? [])
    .filter(([n]) => n !== BEHAVIORS_FIELD)
    .map(([n, s]) => describeField(n, s, target.entity, ctx));
  return { type: type.type, fields: linkFrames(fields) };
}

// ─── Behaviors ───────────────────────────────────────────

type BehaviorState = {
  target: Extract<RefTarget, { kind: "entity" }>;
  rules: BehaviorRules;
  /** The names the entity's file writes. */
  written: string[];
  /** Required and written, registered ones in registration order, then unknown ones. */
  carried: BehaviorName[];
  /** The entity's schema, built once: block fields as it validates them. */
  schema: z.ZodObject | undefined;
};

function writtenBlocks(entity: Record<string, unknown>): Record<string, unknown> {
  const blocks = entity[BEHAVIORS_FIELD];
  return blocks !== null && typeof blocks === "object" && !Array.isArray(blocks)
    ? (blocks as Record<string, unknown>)
    : {};
}

function behaviorState(registry: Registry, target: RefTarget): BehaviorState | null {
  if (target.kind !== "entity") return null;
  const rules = registry.behaviorRules(target.entity.type);
  const written = Object.keys(writtenBlocks(target.entity));
  const has = new Set([...rules.required.keys(), ...written]);
  const carried = [
    ...registry.behaviorNames.filter((n) => has.has(n)),
    ...written.filter((n) => !registry.behaviors.has(n)).sort(),
  ];
  return { target, rules, written, carried, schema: entitySchemaFor(registry, target.entity.type) };
}

/** A block's fields as the entity schema validates them (optional where a default exists), else the behavior's own. */
function blockShape(registry: Registry, s: BehaviorState, name: BehaviorName): z.ZodRawShape {
  const slot = s.schema?.shape[BEHAVIORS_FIELD];
  const slotObj = slot && unwrapSchema(slot);
  const block = slotObj instanceof z.ZodObject ? slotObj.shape[name] : undefined;
  const blockObj = block && unwrapSchema(block);
  if (blockObj instanceof z.ZodObject) return blockObj.shape;
  return registry.behaviors.get(name)?.shape ?? {};
}

function behaviorFields(registry: Registry, s: BehaviorState, name: BehaviorName): ModelField[] {
  const entity = s.target.entity;
  const forced = behaviorSectionId(name);
  const b = registry.behaviors.get(name);
  if (!b)
    return [
      describeField(
        `${BEHAVIORS_FIELD}.${name}`,
        z.unknown(),
        entity,
        entityCtx(registry, registry.types.get(entity.type)),
        { forced },
      ),
    ];
  const defaults = s.rules.defaults.get(name) ?? {};
  const shape = blockShape(registry, s, name);
  const written = writtenBlocks(entity)[name];
  const block =
    written !== null && typeof written === "object" ? (written as Record<string, unknown>) : {};
  const current = (key: string): unknown => {
    if (block[key] !== undefined) return block[key];
    if (defaults[key] !== undefined) return defaults[key];
    const field = shape[key];
    const parsed = field ? z.safeParse(field, undefined) : undefined;
    return parsed?.success ? parsed.data : undefined;
  };
  const ctx: Ctx = { ...entityCtx(registry, registry.types.get(entity.type)), block: current };
  const applies = ([k, schema]: [string, z.ZodType]) =>
    block[k] !== undefined || fieldApplies(fieldMeta(schema).when, current);
  return linkFrames(
    orderedFields(shape, b.inspector?.order ?? [])
      .filter(applies)
      .map(([k, schema]) => {
        const f = describeField(`${BEHAVIORS_FIELD}.${name}.${k}`, schema, entity, ctx, {
          forced,
        });
        const group = fieldMeta(schema).group;
        if (typeof group === "string") f.group = group;
        const d = defaults[k];
        if (d !== undefined) {
          f.defaultValue = d;
          f.optional = true;
        }
        return f;
      }),
  );
}

/**
 * Whether a field with `meta.when` (`{ kind: ["spring"] }`) applies to the
 * block: every key it names holds one of the listed values, or no value
 * yet. A field without one always applies.
 */
function fieldApplies(when: unknown, current: (key: string) => unknown): boolean {
  if (when === null || typeof when !== "object") return true;
  return Object.entries(when).every(([key, values]) => {
    const v = current(key);
    return v === undefined || !Array.isArray(values) || values.includes(v);
  });
}

/** A value `schema` accepts for a field with no default, so an added block validates; undefined when none is found. */
function seedValue(schema: z.ZodType): unknown {
  const inner = unwrapSchema(schema);
  let v: unknown;
  if (inner instanceof z.ZodEnum) v = (inner.options as unknown[])[0];
  else if (inner instanceof z.ZodLiteral) v = [...inner.values][0];
  else if (inner instanceof z.ZodBoolean) v = false;
  else if (inner instanceof z.ZodNumber) {
    const b = numberBounds(inner);
    let n = 0;
    if (b.min !== undefined && (b.exclusive ? n <= b.min : n < b.min))
      n = b.exclusive ? b.min + 1 : b.min;
    if (b.max !== undefined && n > b.max) n = b.max;
    v = n;
  } else if (inner instanceof z.ZodString) v = "";
  else if (inner instanceof z.ZodArray) v = [];
  else if (inner instanceof z.ZodTuple && inner.def.rest === null) {
    const items = (inner.def.items as z.ZodType[]).map(seedValue);
    v = items.every((i) => i !== undefined) ? items : undefined;
  } else if (inner instanceof z.ZodObject) v = seedBlock(inner.shape, {});
  return v !== undefined && schema.safeParse(v).success ? v : undefined;
}

function seedBlock(shape: z.ZodRawShape, defaults: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(shape)) {
    if (s._zod.optin === "optional" || defaults[k] !== undefined) continue;
    const v = seedValue(s as z.ZodType);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ─── Behavior field edits ────────────────────────────────

/** What one field edit writes to an entity: set and unset paths, as an update op takes them. */
export type FieldEdit = { set: Record<FieldPath, unknown>; unset: FieldPath[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * `base` with `next` at `rel` below it; an object `rel` passes through that
 * `base` lacks is seeded (`seedBlock`) so its required fields hold a value.
 * Undefined when `rel` leaves the schema's objects.
 */
function withNested(
  shape: z.ZodRawShape,
  base: Record<string, unknown>,
  rel: readonly string[],
  next: unknown,
): Record<string, unknown> | undefined {
  const [key, ...rest] = rel;
  if (key === undefined) return undefined;
  const out = { ...base };
  if (rest.length === 0) {
    if (next === undefined) delete out[key];
    else out[key] = next;
    return out;
  }
  const field = shape[key];
  const inner = field && unwrapSchema(field);
  if (!(inner instanceof z.ZodObject)) return undefined;
  const cur = base[key];
  const nested = withNested(
    inner.shape,
    isRecord(cur) ? cur : seedBlock(inner.shape, {}),
    rest,
    next,
  );
  if (!nested) return undefined;
  out[key] = nested;
  return out;
}

/** A field's `meta.when` names `key`. */
const keysOn = (schema: z.ZodType, key: string) => {
  const when = fieldMeta(schema).when;
  return isRecord(when) && key in when;
};

/** A number for a field of `unit` from a value a switch dropped in that unit: a number's size, a vector's length. */
function carried(
  unit: unknown,
  dropped: readonly (readonly [z.ZodType, unknown])[],
): number | undefined {
  if (typeof unit !== "string") return undefined;
  for (const [schema, value] of dropped) {
    if (fieldMeta(schema).unit !== unit) continue;
    if (typeof value === "number") return Math.abs(value);
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number"))
      return tidy(Math.hypot(...(value as number[])));
  }
  return undefined;
}

/**
 * What writing `next` to the behavior field at `path` on `entity` takes
 * for the block to stay valid; null when `path` isn't a registered
 * behavior's field. A field under an object the block lacks (a joint's
 * `motor.velocity`) writes the whole object, its other required fields
 * seeded. Changing a field other fields' `meta.when` keys on (a `kind`)
 * unsets those that no longer apply. When the behavior's `refine` still
 * refuses the block, it seeds the applicable fields that fix it, from a
 * value the switch dropped in the same unit (a force's length as a
 * strength), the template, else `seedValue`, and failing that unsets the
 * other written fields that fix it (a spawner's `prefab` once `type` is
 * set). A refusal it can't fix is left for the op to report.
 */
export function behaviorFieldEdit(
  registry: Registry,
  entity: EntityDef,
  path: FieldPath,
  next: unknown,
): FieldEdit | null {
  const segs = path.split(".");
  const [root, name, key] = segs;
  if (root !== BEHAVIORS_FIELD || name === undefined || key === undefined) return null;
  const b = registry.behaviors.get(name);
  if (!b) return null;
  const shape = b.shape;
  const written = writtenBlocks(entity)[name];
  const before = isRecord(written) ? written : {};
  const after = withNested(shape, before, segs.slice(2), next);
  if (!after) return null;
  const prefix = `${BEHAVIORS_FIELD}.${name}`;
  const edit: FieldEdit = { set: {}, unset: [] };
  // The first object above the field the block lacks is written whole.
  let depth = 3;
  while (depth < segs.length && isRecord(valueAt(before, segs.slice(2, depth).join(".")))) depth++;
  if (next === undefined) edit.unset.push(path);
  else if (depth < segs.length) {
    const at = segs.slice(2, depth).join(".");
    edit.set[`${prefix}.${at}`] = valueAt(after, at);
  } else edit.set[path] = next;

  const defaults = registry.behaviorRules(entity.type).defaults.get(name) ?? {};
  const fallback = (k: string): unknown => {
    if (defaults[k] !== undefined) return defaults[k];
    const field = shape[k];
    const parsed = field ? z.safeParse(field, undefined) : undefined;
    return parsed?.success ? parsed.data : undefined;
  };
  const current = (k: string) => (after[k] !== undefined ? after[k] : fallback(k));
  const order = orderedFields(shape, b.inspector?.order ?? []).filter(([k]) => k !== key);
  const dropped: (readonly [z.ZodType, unknown])[] = [];
  for (const [k, schema] of order) {
    if (after[k] === undefined || !keysOn(schema, key)) continue;
    if (fieldApplies(fieldMeta(schema).when, current)) continue;
    dropped.push([schema, after[k]]);
    delete after[k];
    edit.unset.push(`${prefix}.${k}`);
  }
  if (!b.refine) return edit;
  const refused = () => {
    const full: Record<string, unknown> = {};
    for (const k of Object.keys(shape)) {
      const v = current(k);
      if (v !== undefined) full[k] = v;
    }
    return b.refine!(full);
  };
  let error = refused();
  if (error === undefined) return edit;
  const fixes: FieldEdit = { set: {}, unset: [] };
  const template = (b.template ?? {}) as Record<string, unknown>;
  for (const [k, schema] of order) {
    if (error === undefined) break;
    if (after[k] !== undefined || fallback(k) !== undefined) continue;
    if (!fieldApplies(fieldMeta(schema).when, current)) continue;
    const options = [carried(fieldMeta(schema).unit, dropped), template[k], seedValue(schema)];
    const seed = options.find((v) => v !== undefined && schema.safeParse(v).success);
    if (seed === undefined) continue;
    after[k] = structuredClone(seed);
    const now = refused();
    if (now === error) delete after[k];
    else {
      fixes.set[`${prefix}.${k}`] = after[k];
      error = now;
    }
  }
  for (const [k, schema] of order) {
    if (error === undefined) break;
    if (after[k] === undefined || !schema.safeParse(undefined).success) continue;
    const kept = after[k];
    delete after[k];
    const now = refused();
    if (now === error) after[k] = kept;
    else {
      fixes.unset.push(`${prefix}.${k}`);
      error = now;
    }
  }
  if (error !== undefined) return edit;
  return { set: { ...edit.set, ...fixes.set }, unset: [...edit.unset, ...fixes.unset] };
}

/** Where an entity stands as the editor places it; undefined for an unregistered type. */
function poseOf(registry: Registry, e: EntityDef): Pt | undefined {
  const t = registry.types.get(e.type);
  return t ? editPose(entityGeometry(t, e), e).at : undefined;
}

/** A template path's waypoints moved to start from `at`, since a path's points are world metres. */
function pathFrom(path: unknown, at: Pt): unknown {
  if (path === null || typeof path !== "object" || !("pts" in path) || !Array.isArray(path.pts))
    return path;
  return { ...path, pts: path.pts.map((p: unknown) => (isPt(p) ? addPt(p, at) : p)) };
}

/**
 * The block Add behavior writes: the behavior's template under the type's own
 * defaults for it, then a seed for each required field still unset. The
 * template keys the defaults don't set are kept unless, with the defaults,
 * they break the behavior's refine; then the template is dropped.
 */
function addedBlock(
  registry: Registry,
  s: BehaviorState,
  name: BehaviorName,
  b: RegisteredBehavior,
): Record<string, unknown> {
  const defaults = s.rules.defaults.get(name) ?? {};
  const shape = blockShape(registry, s, name);
  const block = (base: Record<string, unknown>) => ({
    ...base,
    ...seedBlock(shape, { ...defaults, ...base }),
  });
  if (!b.template) return block({});
  const at = poseOf(registry, s.target.entity) ?? [0, 0];
  const kept = Object.fromEntries(
    Object.entries(structuredClone(b.template))
      .filter(([k]) => defaults[k] === undefined)
      .map(([k, v]) => [k, shape[k] && fieldKind(shape[k]) === "path" ? pathFrom(v, at) : v]),
  );
  const withTemplate = block(kept);
  return b.refine?.({ ...defaults, ...withTemplate }) === undefined ? withTemplate : block({});
}

/** `name` and every behavior it requires, transitively, that `s` lacks and its type allows, in registration order. */
function withRequires(registry: Registry, s: BehaviorState, name: BehaviorName): BehaviorName[] {
  const need = new Set<BehaviorName>();
  const visit = (n: BehaviorName) => {
    if (need.has(n) || s.carried.includes(n) || !s.rules.allowed.includes(n)) return;
    const b = registry.behaviors.get(n);
    if (!b) return;
    need.add(n);
    for (const r of b.requires ?? []) visit(r);
  };
  visit(name);
  return registry.behaviorNames.filter((n) => need.has(n));
}

/** `def` with only `entities`: its header (settings, bounds), no other entries. */
function sceneWith(def: SceneDefinition | undefined, entities: EntityDef[]): SceneDefinition {
  if (!def) return { v: 1, name: "add", bounds: [-1e4, -1e4, 1e4, 1e4], entities };
  const header: SceneDefinition = { ...def, entities };
  delete header.instances;
  for (const k of bulkKeysOf(def)) delete header[k];
  return header;
}

const withBlocks = (e: EntityDef, blocks: Record<BehaviorName, Record<string, unknown>>) => ({
  ...e,
  [BEHAVIORS_FIELD]: { ...writtenBlocks(e), ...blocks },
});

/** A block field that names another entity and must be set: no default, not optional. */
function requiredRefs(registry: Registry, s: BehaviorState, name: BehaviorName): string[] {
  const shape = blockShape(registry, s, name);
  const defaults = s.rules.defaults.get(name) ?? {};
  return Object.entries(shape)
    .filter(
      ([k, f]) =>
        f._zod.optin !== "optional" && defaults[k] === undefined && isChildRef(unwrapSchema(f)),
    )
    .map(([k]) => k);
}

/** How many of the nearest entities Add tries for a reference before giving up. */
const REF_TRIES = 8;

/**
 * The nearest entity in `def` that `field` of `name`'s block may name, as
 * the scene's validation judges it with the block added; undefined when
 * none of the nearest few will do.
 */
function seedRef(
  registry: Registry,
  def: SceneDefinition,
  self: EntityDef,
  blocks: Record<BehaviorName, Record<string, unknown>>,
  name: BehaviorName,
  field: string,
): string | undefined {
  const from = poseOf(registry, self) ?? [0, 0];
  const near = (def.entities ?? [])
    .filter((e) => e.id !== self.id && registry.types.has(e.type))
    .map((e) => {
      const at = poseOf(registry, e);
      return { e, d: at ? (at[0] - from[0]) ** 2 + (at[1] - from[1]) ** 2 : Infinity };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, REF_TRIES);
  const pointer = `/entities/0/${BEHAVIORS_FIELD}/${name}/${field}`;
  for (const { e } of near) {
    const tried = { ...blocks, [name]: { ...blocks[name], [field]: e.id } };
    const issues = validateScene(sceneWith(def, [withBlocks(self, tried), e]), registry);
    if (!issues.some((i) => i.path === pointer)) return e.id;
  }
  return undefined;
}

/**
 * The fixes the scene's validation offers for the blocks being added, as
 * the entity holds them alone in the scene (a force area's collider made a
 * sensor): each sets fields of an added block on the entity itself. Merged
 * into `blocks` until none is left, a few rounds at most.
 */
function fixAdded(
  registry: Registry,
  def: SceneDefinition | undefined,
  self: EntityDef,
  blocks: Record<BehaviorName, Record<string, unknown>>,
  extra: EntityDef[],
): void {
  for (let round = 0; round < 3; round++) {
    let fixed = false;
    for (const issue of validateScene(
      sceneWith(def, [withBlocks(self, blocks), ...extra]),
      registry,
    )) {
      const ops = issue.fix?.ops ?? [];
      const sets = ops.flatMap((op) =>
        op.op === "update" && op.ref === self.id && !op.unset && op.set
          ? Object.entries(op.set)
          : [],
      );
      if (sets.length === 0 || sets.length !== ops.length) continue;
      const targets = sets.map(([path, value]) => {
        const [root, name, ...rest] = path.split(".");
        return root === BEHAVIORS_FIELD && name && blocks[name] && rest.length === 1
          ? { name, key: rest[0]!, value }
          : null;
      });
      if (targets.some((t) => t === null)) continue;
      for (const t of targets) {
        if (same(blocks[t!.name]![t!.key], t!.value)) continue;
        blocks[t!.name]![t!.key] = structuredClone(t!.value);
        fixed = true;
      }
    }
    if (!fixed) return;
  }
}

/** Why `adding` can't join what `s` carries: the first carried behavior one of them conflicts with. */
function conflictNote(
  registry: Registry,
  s: BehaviorState,
  adding: readonly BehaviorName[],
): string | undefined {
  for (const carried of s.carried) {
    const held = registry.behaviors.get(carried);
    if (!held) continue;
    for (const n of adding) {
      const b = registry.behaviors.get(n);
      if (b && behaviorsConflict(b, held))
        return `Can't share an entity with ${held.inspector?.label ?? carried}.`;
    }
  }
  return undefined;
}

/**
 * The blocks one target gains when `name` is added: it and the behaviors it
 * requires, each from `addedBlock`, a required reference seeded with the
 * nearest entity that suits it, and the validation fixes that apply to
 * them. `unavailable` when one of them conflicts with a carried behavior
 * or a reference has nothing to name.
 */
function addedBlocks(
  registry: Registry,
  s: BehaviorState,
  name: BehaviorName,
  def: SceneDefinition | undefined,
  { clips, assetKind }: ClipSources,
): {
  blocks: Record<BehaviorName, Record<string, unknown>>;
  unavailable?: string;
  uses: string[];
} {
  const blocks: Record<BehaviorName, Record<string, unknown>> = {};
  for (const n of withRequires(registry, s, name))
    blocks[n] = addedBlock(registry, s, n, registry.behaviors.get(n)!);
  const self = s.target.entity;
  const extra: EntityDef[] = [];
  let unavailable = conflictNote(registry, s, Object.keys(blocks));
  for (const n of Object.keys(blocks)) {
    for (const field of requiredRefs(registry, s, n)) {
      if (blocks[n]![field] !== undefined) continue;
      const id = def ? seedRef(registry, def, self, blocks, n, field) : undefined;
      if (id === undefined) {
        unavailable ??= `${behaviorLabel(registry, n)} needs another entity in the scene to link to.`;
        continue;
      }
      blocks[n]![field] = id;
      const other = def?.entities?.find((e) => e.id === id);
      if (other) extra.push(other);
    }
  }
  const uses: string[] = [];
  for (const n of Object.keys(blocks)) {
    const title = behaviorLabel(registry, n);
    const block = blocks[n]!;
    const shape = blockShape(registry, s, n);
    // Asset fields first: one taking animations picks its clip too.
    const unset = unsetRequired(registry, s, n, block).sort(
      ([, a], [, b]) => Number(!assetKindsOf(a)) - Number(!assetKindsOf(b)),
    );
    for (const [field, schema] of unset) {
      if (block[field] !== undefined) continue;
      const kinds = assetKindsOf(schema);
      const choices = kinds ? assetChoices(schema) : [];
      const clip = kinds?.includes(ANIMATION_KIND) ? clipField(shape, block) : undefined;
      if (clip !== undefined && choices.length > 0) {
        const named = namedValues(self, blocks);
        const rank = (id: string) =>
          named.has(id) ? 0 : assetKind?.(id) === ANIMATION_KIND ? 1 : 2;
        const picked = [...choices]
          .sort((a, b) => rank(a) - rank(b))
          .map((id) => [id, clips?.(id)?.[0]] as const)
          .find(([, first]) => first !== undefined);
        if (picked) {
          block[field] = picked[0];
          block[clip] = picked[1];
          uses.push(`${picked[0]} (${picked[1]})`);
          continue;
        }
        unavailable ??= clips
          ? `${title} needs ${articled(kinds!)} asset with clips in the project.`
          : `${title} needs its ${clip} set, which Add can't choose.`;
        continue;
      }
      const [first] = choices;
      if (first !== undefined) {
        block[field] = first;
        uses.push(first);
        continue;
      }
      unavailable ??= kinds
        ? `${title} needs ${articled(kinds)} asset in the project.`
        : `${title} needs its ${field} set, which Add can't choose.`;
    }
  }
  fixAdded(registry, def, self, blocks, extra);
  return unavailable ? { blocks, unavailable, uses } : { blocks, uses };
}

/** A behavior as Add behavior's notes name it: its inspector label, else its key in sentence case. */
const behaviorLabel = (registry: Registry, name: BehaviorName) =>
  registry.behaviors.get(name)?.inspector?.label ?? fieldTitle(name);

/** Asset kinds as a phrase names them, each with its article: "an animation or an atlas"; "an asset" for none. */
export const articled = (kinds: readonly string[]) =>
  kinds.length === 0
    ? "an asset"
    : kinds.map((k) => `${/^[aeiou]/.test(k) ? "an" : "a"} ${k}`).join(" or ");

/** `buildInspectorModel`'s `clips`. */
type ClipLookup = (source: AssetId) => readonly string[] | null;

/** What Add behavior reads of the project to pick an `anim` block's source and clip. */
type ClipSources = {
  clips?: ClipLookup | undefined;
  assetKind?: ((id: AssetId) => AssetKindName | undefined) | undefined;
};

/**
 * The strings the entity's blocks already hold at their top level, written
 * or being added (a sprite's atlas): a source among them keeps its look.
 */
function namedValues(
  entity: Record<string, unknown>,
  added: Readonly<Record<BehaviorName, Readonly<Record<string, unknown>>>>,
): Set<string> {
  const out = new Set<string>();
  for (const block of [...Object.values(writtenBlocks(entity)), ...Object.values(added)]) {
    if (!isRecord(block)) continue;
    for (const v of Object.values(block)) if (typeof v === "string") out.add(v);
  }
  return out;
}

/** The block's required `clip` text field an animation-taking asset field picks along with it, when unset. */
function clipField(shape: z.ZodRawShape, block: Readonly<Record<string, unknown>>) {
  const clip = shape.clip;
  if (!clip || block.clip !== undefined || clip._zod.optin === "optional") return undefined;
  return unwrapSchema(clip) instanceof z.ZodString ? "clip" : undefined;
}

/** The project asset ids an asset field offers, as its schema's choices list them. */
function assetChoices(schema: z.core.$ZodType): readonly string[] {
  const ids = fieldMeta(schema).enum;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * The fields of `name`'s block that must hold a value and don't: neither
 * optional, defaulted, seeded nor an entity reference (those are seeded
 * from the scene).
 */
function unsetRequired(
  registry: Registry,
  s: BehaviorState,
  name: BehaviorName,
  block: Readonly<Record<string, unknown>>,
): [string, z.core.$ZodType][] {
  const defaults = s.rules.defaults.get(name) ?? {};
  return Object.entries(blockShape(registry, s, name)).filter(
    ([k, f]) =>
      f._zod.optin !== "optional" &&
      defaults[k] === undefined &&
      block[k] === undefined &&
      !isChildRef(unwrapSchema(f)),
  );
}

function removeBatch(states: readonly BehaviorState[], name: BehaviorName, title: string) {
  if (states.some((s) => s.rules.required.has(name))) return undefined;
  const ops: SceneOp[] = states.map(({ target, written }) => ({
    op: "update",
    ref: target.ref,
    // The last block takes the empty `behaviors` object with it.
    unset: [written.length === 1 ? BEHAVIORS_FIELD : `${BEHAVIORS_FIELD}.${name}`],
  }));
  const who = states.length === 1 ? states[0]!.target.ref : `${states.length} entities`;
  return { label: `Remove ${title} from ${who}`, ops };
}

function addOptions(
  registry: Registry,
  states: readonly BehaviorState[],
  def: SceneDefinition | undefined,
  sources: ClipSources,
): BehaviorOption[] {
  const [first, ...rest] = states;
  if (!first) return [];
  const out: BehaviorOption[] = [];
  for (const name of first.rules.allowed) {
    const b = registry.behaviors.get(name);
    if (!b || !rest.every((s) => s.rules.allowed.includes(name))) continue;
    const lacking = states.filter((s) => !s.carried.includes(name));
    if (lacking.length === 0) continue;
    const label = b.inspector?.label ?? name;
    const adds = new Set<string>();
    const uses = new Set<string>();
    let unavailable: string | undefined;
    const ops: SceneOp[] = lacking.map((s) => {
      const added = addedBlocks(registry, s, name, def, sources);
      unavailable ??= added.unavailable;
      for (const u of added.uses) uses.add(u);
      for (const n of Object.keys(added.blocks))
        if (n !== name) adds.add(behaviorLabel(registry, n));
      const set = Object.fromEntries(
        Object.entries(added.blocks).map(([n, block]) => [`${BEHAVIORS_FIELD}.${n}`, block]),
      );
      return { op: "update", ref: s.target.ref, set };
    });
    const who = lacking.length === 1 ? lacking[0]!.target.ref : `${lacking.length} entities`;
    out.push({
      name,
      label,
      description: b.description,
      ...(b.inspector?.category ? { category: b.inspector.category } : {}),
      batch: { label: `Add ${label} to ${who}`, ops },
      ...(adds.size > 0 ? { adds: [...adds] } : {}),
      ...(uses.size > 0 && !unavailable ? { uses: [...uses] } : {}),
      ...(unavailable ? { unavailable } : {}),
    });
  }
  return out;
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
    if (all.some((g) => !same(g.defaultValue, f.defaultValue))) delete merged.defaultValue;
    if (all.some((g) => g.placeholder !== f.placeholder)) delete merged.placeholder;
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
 * by kind. Each behavior every target carries gets its own section,
 * `behaviors:<name>`, with its fields in `inspector.order` (each with its
 * `meta.group`) and a Remove batch; `addBehaviors` lists the rest the types
 * allow, each adding what it requires too. With several
 * targets only the fields they share are shown, and a field whose values
 * differ is `mixed`. Pure: the site renders it.
 */
export function buildInspectorModel(
  registry: Registry,
  targets: readonly RefTarget[],
  opts: {
    /** The scene the targets are in (the resolved view): Add behavior seeds a reference from it. */
    def?: SceneDefinition;
    /**
     * The clip names an animation or atlas asset offers, in file order (an
     * atlas's tags are its clips), null when they can't be read: Add
     * behavior picks an `anim` block's source and clip from them.
     */
    clips?: (source: AssetId) => readonly string[] | null;
    /**
     * A project asset's kind: Add behavior then prefers an animation's
     * clips over an atlas's tags when it picks an `anim` block's source.
     */
    assetKind?: (id: AssetId) => AssetKindName | undefined;
  } = {},
): InspectorModel {
  const maybe = targets.map((t) => behaviorState(registry, t));
  const states = maybe.every((s) => s !== null) ? maybe : [];
  const common = states[0]?.carried.filter((n) => states.every((s) => s.carried.includes(n))) ?? [];
  const per = targets.map((t) => targetFields(registry, t));
  const types = [...new Set(per.flatMap((p) => (p.type ? [p.type] : [])))];
  const fields = shared(
    per.map((p, i) => {
      const s = states[i];
      return s ? [...p.fields, ...common.flatMap((n) => behaviorFields(registry, s, n))] : p.fields;
    }),
  );
  const fixed: InspectorSectionModel[] = INSPECTOR_SECTIONS.map((id) => ({
    id,
    title: SECTION_TITLES[id],
    fields: fields.filter((f) => f.section === id),
  })).filter((s) => s.fields.length > 0);
  const behaviors = common.map((name): InspectorSectionModel => {
    const id = behaviorSectionId(name);
    const b = registry.behaviors.get(name);
    const title = b?.inspector?.label ?? name;
    const remove = removeBatch(states, name, title);
    return {
      id,
      title,
      fields: fields.filter((f) => f.section === id),
      behavior: {
        name,
        description: b?.description ?? `"${name}" isn't a behavior this game registers.`,
        ...(remove ? { remove } : {}),
      },
    };
  });
  const at = fixed.findIndex((s) => s.id === "overrides");
  const sections =
    at < 0 ? [...fixed, ...behaviors] : [...fixed.slice(0, at), ...behaviors, ...fixed.slice(at)];
  return {
    refs: targets.map((t) => t.ref),
    types,
    sections,
    addBehaviors: addOptions(registry, states, opts.def, opts),
  };
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

/** A metric value as a file holds it (`roundLength`), whatever was typed or stepped. */
function roundMetric(w: FieldWidget, value: unknown): unknown {
  if (!("unit" in w) || !isLengthUnit(w.unit)) return value;
  if (w.kind === "number" && typeof value === "number" && !w.integer) return roundLength(value);
  if (
    (w.kind === "point" || w.kind === "range") &&
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === "number")
  )
    return value.map((v: number) => roundLength(v));
  return value;
}

/**
 * What `input` sets `row` to when it now holds `current` (as stored): a
 * string typed into a number field parsed by `parseRelative` (against
 * `current`, else the row's default) and rounded when whole, a metric
 * number, point or range rounded as a file holds it. A scaled widget's
 * input is a shown value, divided back. Not yet checked against the schema.
 */
export function typedValue(
  row: InspectorRow,
  input: unknown,
  current: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  let next = input;
  const scale = "scale" in row.widget ? row.widget.scale : undefined;
  if (typeof input === "string" && numeric(row.widget)) {
    const base =
      current === undefined
        ? row.defaultValue
        : scale && typeof current === "number"
          ? current * scale
          : current;
    next = parseRelative(input, base);
    if (next === undefined)
      return { ok: false, error: `"${input}" isn't a number or a relative edit like +=16` };
    if (row.widget.kind !== "number" || row.widget.integer) next = Math.round(next as number);
  }
  if (scale) next = scaled(next, (n) => n / scale);
  return { ok: true, value: roundMetric(row.widget, next) };
}

/**
 * The update ops that set `field` to `input` on each target, one per
 * target whose value changes. On a number field a string is parsed by
 * `parseRelative` against each target's own value (or the field's default
 * when unset), so `+=16` moves every one. A metric number or point is
 * written to micrometres (`roundLength`). `undefined` unsets an optional
 * field. With `registry`, a behavior field's edit on an entity also writes
 * what keeps its block valid (`behaviorFieldEdit`). Fails without ops when
 * any target's new value doesn't pass the field's schema.
 */
export function modelOps(
  field: ModelField,
  input: unknown,
  targets: readonly RefTarget[],
  registry?: Registry,
): ModelEdit {
  const ops: SceneOp[] = [];
  for (const t of targets) {
    const current =
      t.kind === "bulk"
        ? field.path.includes(".")
          ? undefined
          : t.value
        : valueAt(t.entity, field.path);
    const typed = typedValue(field, input, current);
    if (!typed.ok) return typed;
    const next = typed.value;
    if (same(next, current)) continue;
    if (next === undefined) {
      if (!field.optional || t.kind === "bulk")
        return { ok: false, error: `${field.title} can't be unset` };
    } else {
      const parsed = field.schema.safeParse(next);
      if (!parsed.success)
        return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid value" };
    }
    const edit =
      registry && t.kind === "entity"
        ? behaviorFieldEdit(registry, t.entity, field.path, next)
        : null;
    const set = edit ? edit.set : next === undefined ? {} : { [field.path]: next };
    const unset = edit ? edit.unset : next === undefined ? [field.path] : [];
    ops.push({
      op: "update",
      ref: t.ref,
      ...(Object.keys(set).length > 0 ? { set } : {}),
      ...(unset.length > 0 ? { unset } : {}),
    });
  }
  return { ok: true, ops };
}

/** `modelOps` as one undoable batch, with the `base` hash bulk refs need. */
export function modelBatch(
  field: ModelField,
  input: unknown,
  targets: readonly RefTarget[],
  def: SceneDefinition,
  registry?: Registry,
): { ok: true; batch: OpBatch } | { ok: false; error: string } {
  const edit = modelOps(field, input, targets, registry);
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

/**
 * Refs an entity-ref field may name: entities whose type, or its base, is
 * in `accepts`. With `prefabs`, instances' children count too, by their
 * resolved refs (`gate-2/door`) at any depth.
 */
export function refCandidates(
  def: SceneDefinition,
  registry: Registry,
  accepts: readonly EntityTypeName[],
  prefabs?: PrefabLibrary,
): string[] {
  return referableEntities(def, registry, prefabs)
    .filter((e) => {
      const base = registry.types.get(e.type)?.base;
      return accepts.includes(e.type) || (base !== undefined && accepts.includes(base));
    })
    .map((e) => e.id);
}

// ─── Instance parameters ─────────────────────────────────

/** One exposed parameter of an instance's prefab, as the instance panel edits it. */
export type ParamModel = {
  name: string;
  description: string;
  targets: readonly OverridePath[];
  /**
   * Its value as a field at `params.<name>`, drawn by its first target's
   * schema; `defaultValue` is the param's default, else what that target
   * holds without it.
   */
  field: ModelField;
  /** The instance sets it (for a nested instance: an override on the scene instance does). */
  set: boolean;
};

/** The keys among `keys` that are `path`, under it, or above it: the ones that set some of its value. */
export function overlappingKeys(keys: readonly string[], path: string): string[] {
  return keys.filter((k) => k === path || k.startsWith(`${path}.`) || path.startsWith(`${k}.`));
}

/**
 * The override keys on `model`'s scene instance that set part of what
 * `param` feeds, so beat it there.
 */
export function paramOverriddenBy(
  def: SceneDefinition,
  model: InstanceParamsModel,
  param: ParamModel,
): OverridePath[] {
  const inst = def.instances?.find((i) => i.id === model.instance);
  const keys = Object.keys(inst?.overrides ?? {});
  const prefix = model.nested !== undefined ? `${model.nested}${CHILD_SEPARATOR}` : "";
  return keys.filter((k) =>
    param.targets.some((t) => overlappingKeys([k], `${prefix}${t}`).length),
  );
}

export type InstanceParamsModel = {
  ref: Ref;
  /** The scene instance the values are written on. */
  instance: string;
  /** For a nested instance, its path inside `instance` (`door-1`). */
  nested?: string;
  /** The instance as a target `modelOps` reads `params.<name>` from. */
  target: RefTarget;
  params: ParamModel[];
};

/** The schema `segments` reach below `shape`, through objects, records, arrays and tuples. */
function schemaAtPath(shape: z.ZodRawShape, segments: readonly string[]): z.ZodType | undefined {
  const [first, ...rest] = segments;
  let s =
    first !== undefined && Object.hasOwn(shape, first) ? (shape[first] as z.ZodType) : undefined;
  for (const seg of rest) {
    const inner = s && unwrapSchema(s);
    if (inner instanceof z.ZodObject) s = inner.shape[seg] as z.ZodType | undefined;
    else if (inner instanceof z.ZodRecord) s = inner.valueType as z.ZodType;
    else if (inner instanceof z.ZodArray && /^\d+$/.test(seg)) s = inner.element as z.ZodType;
    else if (inner instanceof z.ZodTuple && /^\d+$/.test(seg))
      s = inner.def.items[Number(seg)] as z.ZodType | undefined;
    else return undefined;
  }
  return s;
}

type TargetInfo = { schema: z.ZodType; root: unknown; field: string; type?: RegisteredType };

/** The nested instance at `path` (`a/b`) inside prefab `holder`. */
function instanceIn(prefabs: PrefabLibrary, holder: string, path: string): InstanceDef | null {
  let found: InstanceDef | undefined;
  for (const seg of path.split("/")) {
    const p = prefabs.get(found ? found.prefab : holder);
    found = p ? prefabInstances(p, prefabs).find((i) => i.id === seg) : undefined;
    if (!found) return null;
  }
  return found ?? null;
}

/** The schema an override path inside `prefab` reaches, with the value it has there. */
function targetInfo(
  registry: Registry,
  prefabs: PrefabLibrary,
  prefab: string,
  target: OverridePath,
  depth = 0,
): TargetInfo | null {
  const split = splitOverridePath(target);
  const segments = split && splitFieldPath(split.field);
  if (!split || !segments || depth > PREFAB_MAX_DEPTH) return null;
  const resolved = resolvePrefab(prefab, prefabs, registry);
  if (!resolved.ok) return null;
  const child = resolved.prefab.children.find((c) => c.child === split.child);
  if (child) {
    const def = childEntity(child, registry);
    const shape = def && entitySchemaFor(registry, def.type)?.shape;
    const schema = shape && schemaAtPath(shape, segments);
    return def && schema
      ? { schema, root: def, field: split.field, type: registry.types.get(def.type) }
      : null;
  }
  const inst = instanceIn(prefabs, prefab, split.child);
  if (!inst) return null;
  if (segments[0] === "params" && segments.length === 2) {
    const name = segments[1]!;
    const inner = resolvePrefab(inst.prefab, prefabs, registry);
    const param = inner.ok ? inner.prefab.params[name] : undefined;
    const first = param?.targets[0];
    const info = first && targetInfo(registry, prefabs, inst.prefab, first, depth + 1);
    if (!info) return null;
    const own = inst.params?.[name] ?? param.default;
    return own === undefined ? info : { ...info, root: { v: own }, field: "v" };
  }
  const schema = schemaAtPath(InstanceSchema.shape, segments);
  return schema ? { schema, root: inst, field: split.field } : null;
}

/** `f` moved from `from` to `to`, its children's values read from `root`. */
function moveField(f: ModelField, from: string, to: string, root: unknown): ModelField {
  const path = `${to}${f.path.slice(from.length)}`;
  const out: ModelField = { ...f, path, value: fieldValue(f.schema, root, path) };
  if (f.children) out.children = f.children.map((c) => moveField(c, from, to, root));
  return out;
}

function paramField(
  registry: Registry,
  name: string,
  param: { description: string; default?: unknown },
  info: TargetInfo | null,
  values: Record<string, unknown>,
): ModelField {
  const path = `params.${name}`;
  const root = { params: values };
  const base = info
    ? describeField(info.field, info.schema, info.root, entityCtx(registry, info.type))
    : describeField(path, z.unknown(), root, entityCtx(registry, undefined));
  const field = moveField(base, info?.field ?? path, path, root);
  const scale = "scale" in field.widget ? field.widget.scale : undefined;
  const shown = (v: unknown) => (scale ? scaled(v, (n) => tidy(n * scale)) : v);
  field.value = shown(field.value);
  const stored = param.default ?? (info ? valueAt(info.root, info.field) : undefined);
  const fallback = stored !== undefined ? shown(stored) : base.defaultValue;
  field.name = name;
  field.title = name;
  field.description = param.description;
  field.section = "overrides";
  field.optional = true;
  field.mixed = false;
  delete field.defaultValue;
  if (fallback !== undefined) field.defaultValue = fallback;
  return field;
}

/**
 * The exposed parameters of the instance `ref` names (a scene instance, or
 * one nested in it, `room-1/door-1`): its prefab's params (`resolvePrefab`,
 * a variant's base's included), each typed by its first target's schema,
 * with the value the instance sets. Null when `ref` names no instance or
 * its prefab doesn't resolve.
 */
export function instanceParamsModel(
  def: SceneDefinition,
  ref: Ref,
  registry: Registry,
  prefabs: PrefabLibrary,
): InstanceParamsModel | null {
  const own = def.instances?.find((i) => i.id === ref);
  const nested = own ? null : nestedInstanceOf(def, ref, prefabs);
  const inst = own ?? nested?.instance;
  if (!inst) return null;
  const resolved = resolvePrefab(inst.prefab, prefabs, registry);
  if (!resolved.ok) return null;
  const overrides = nested?.top.overrides ?? {};
  const values: Record<string, unknown> = {};
  const set = new Set<string>();
  for (const name of Object.keys(resolved.prefab.params)) {
    const key = nested ? `${nested.path}.params.${name}` : undefined;
    if (key !== undefined && Object.hasOwn(overrides, key)) {
      values[name] = overrides[key];
      set.add(name);
    } else if (inst.params && Object.hasOwn(inst.params, name)) {
      values[name] = inst.params[name];
      if (!nested) set.add(name);
    }
  }
  const params = Object.entries(resolved.prefab.params).map(([name, p]): ParamModel => {
    const first = p.targets[0];
    const info = first === undefined ? null : targetInfo(registry, prefabs, inst.prefab, first);
    return {
      name,
      description: p.description,
      targets: p.targets,
      field: paramField(registry, name, p, info, values),
      set: set.has(name),
    };
  });
  return {
    ref,
    instance: nested ? nested.top.id : inst.id,
    ...(nested ? { nested: nested.path } : {}),
    target: {
      kind: "entity",
      ref,
      index: -1,
      entity: { id: inst.id, type: inst.prefab, params: values },
    },
    params,
  };
}

function setAt(root: Record<string, unknown>, path: FieldPath, value: unknown): void {
  const segs = path.split(".");
  let cur = root;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (next === null || typeof next !== "object") cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  const last = segs.at(-1)!;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

/**
 * The batch that sets `param` (or one field inside it) to `input` on the
 * instance, parsed and checked as `modelOps` does: `setParam` on a scene
 * instance (undefined clears it), an override of `<nested>.params.<name>`
 * on the scene instance for a nested one. Written against the document.
 */
export function paramBatch(
  model: InstanceParamsModel,
  param: ParamModel,
  input: unknown,
  field: ModelField = param.field,
): { ok: true; batch: OpBatch } | { ok: false; error: string } {
  const edit = modelOps(field, input, [model.target]);
  if (!edit.ok) return edit;
  const label = `Set ${model.ref}'s ${param.name}`;
  const [op] = edit.ops;
  if (!op || op.op !== "update") return { ok: true, batch: { label, ops: [] } };
  const top = `params.${param.name}`;
  const entity = model.target.kind === "entity" ? model.target.entity : undefined;
  const whole = valueAt(entity, top) ?? param.field.defaultValue;
  const root: Record<string, unknown> = { params: { [param.name]: structuredClone(whole) } };
  if (op.set) for (const [k, v] of Object.entries(op.set)) setAt(root, k, v);
  for (const k of op.unset ?? []) setAt(root, k, undefined);
  const value = valueAt(root, top);
  if (model.nested === undefined) {
    const ops: SceneOp[] = [
      { op: "setParam", ref: model.instance, name: param.name, value: value ?? null },
    ];
    return { ok: true, batch: { label, ops } };
  }
  const key = `${model.nested}.${top}`;
  if (value !== undefined)
    return {
      ok: true,
      batch: { label, ops: [{ op: "override", ref: model.instance, set: { [key]: value } }] },
    };
  return {
    ok: true,
    batch: {
      label,
      ops: param.set ? [{ op: "revertOverride", ref: model.instance, paths: [key] }] : [],
    },
  };
}

// ─── Instance placement ──────────────────────────────────

/** How an instance sits: its quarter turns, mirror and `z`, as the instance panel shows them. */
export type InstanceTransformModel = {
  ref: Ref;
  /** Quarter turns clockwise, 0–3. */
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
  /** The instance's `z`; 0 when it sets none. */
  z: number;
  /** A scene instance turns, flips and takes a `z`; one nested in another shows its prefab's. */
  editable: boolean;
};

/** The placement of the instance `ref` names (a scene instance, or one nested in it); null for anything else. */
export function instanceTransformModel(
  def: SceneDefinition,
  ref: Ref,
  prefabs: PrefabLibrary,
): InstanceTransformModel | null {
  const own = def.instances?.find((i) => i.id === ref);
  const inst = own ?? nestedInstanceOf(def, ref, prefabs)?.instance;
  if (!inst) return null;
  return {
    ref,
    rot: inst.rot ?? 0,
    flip: inst.flip === true,
    z: inst.z ?? 0,
    editable: own !== undefined,
  };
}

/**
 * The batch setting a scene instance's `z` from a typed number or a
 * relative edit (`+=1`), checked against the instance schema. No ops when
 * the value doesn't change.
 */
export function instanceZBatch(
  model: InstanceTransformModel,
  text: string,
): { ok: true; batch: OpBatch } | { ok: false; error: string } {
  if (!model.editable) return { ok: false, error: `${model.ref}'s z comes from its prefab` };
  const n = parseRelative(text, model.z);
  if (n === undefined)
    return { ok: false, error: `"${text}" isn't a number or a relative edit like +=1` };
  const next = Math.round(n);
  const parsed = InstanceSchema.shape.z.safeParse(next);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid value" };
  const label = `Set ${model.ref}'s z`;
  const ops: SceneOp[] = next === model.z ? [] : [{ op: "setZ", refs: [model.ref], z: next }];
  return { ok: true, batch: { label, ops } };
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

/** Rounding a conversion writes: whole world px at `ppm`, sizes at least one px. */
type Px = { at(n: number): number; size(n: number): number; pts(pts: readonly Pt[]): Pt[] };

function pxRounding(ppm: number): Px {
  const at = (n: number) => snapToPixel(n, ppm);
  const one = snapToPixel(1 / ppm, ppm);
  return {
    at,
    size: (n) => Math.max(one, at(n)),
    pts: (pts) => pts.map(([x, y]) => [at(x), at(y)]),
  };
}

const outline = (pts: Pt[], to: "poly" | "chain"): ShapeObj =>
  to === "poly" ? { type: "poly", pts } : { type: "chain", pts: [...pts, pts[0]!] };

function boundingBox(s: ShapeObj, px: Px): Box {
  const b = aabb(s);
  return {
    type: "box",
    cx: px.at((b.minX + b.maxX) / 2),
    cy: px.at((b.minY + b.maxY) / 2),
    hw: px.size((b.maxX - b.minX) / 2),
    hh: px.size((b.maxY - b.minY) / 2),
    rotDeg: 0,
  };
}

function roundFromBox(b: Box, to: "circle" | "capsule", px: Px): ShapeObj {
  if (to === "circle")
    return { type: "circle", cx: b.cx, cy: b.cy, r: px.size(Math.max(b.hw, b.hh)) };
  return {
    type: "capsule",
    cx: b.cx,
    cy: b.cy,
    halfLen: px.size(Math.abs(b.hw - b.hh)),
    r: px.size(Math.min(b.hw, b.hh)),
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

function convert(s: ShapeObj, to: ShapeType, px: Px): Converted {
  const lossy = (shape: ShapeObj, note: string): Converted => ({ shape, lossless: false, note });
  const HOLLOW = "a chain is an outline with no inside";
  switch (s.type) {
    case "box": {
      const corners = px.pts(boxCorners(s));
      if (to === "poly")
        return s.rotDeg % 90 === 0
          ? { shape: outline(corners, "poly"), lossless: true }
          : lossy(outline(corners, "poly"), "corners round to whole pixels");
      if (to === "chain") return lossy(outline(corners, "chain"), HOLLOW);
      return lossy(roundFromBox(s, to as "circle" | "capsule", px), "the corners become round");
    }
    case "circle": {
      if (to === "box") return lossy(boundingBox(s, px), "the circle becomes a square");
      if (to === "capsule")
        return lossy(
          { type: "capsule", cx: s.cx, cy: s.cy, halfLen: px.size(0), r: s.r, rotDeg: 0 },
          "it stretches by 2px",
        );
      const step = Math.PI / 4;
      const pts = px.pts(
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
        outline(px.pts(boxCorners(box)), to as "poly" | "chain"),
        "the ends become square",
      );
    }
    case "poly": {
      if (to === "chain") return lossy(outline(s.pts, "chain"), HOLLOW);
      const box = boundingBox(s, px);
      if (to === "box")
        return isAxisRect(s.pts)
          ? { shape: box, lossless: true }
          : lossy(box, "it becomes its bounding box");
      return lossy(roundFromBox(box, to as "circle" | "capsule", px), "it becomes a round shape");
    }
    case "chain": {
      const ring = isClosed(s.pts) ? s.pts.slice(0, -1) : s.pts;
      if (to === "poly")
        return isClosed(s.pts) && ring.length >= 3 && isConvex(ring)
          ? { shape: { type: "poly", pts: ring }, lossless: true }
          : lossy({ type: "poly", pts: px.pts(convexHull(ring)) }, "it becomes its convex hull");
      const box = boundingBox(s, px);
      if (to === "box") return lossy(box, "it becomes its bounding box");
      return lossy(roundFromBox(box, to as "circle" | "capsule", px), "it becomes a round shape");
    }
  }
}

/**
 * What the shape tag switcher offers for `tuple`: each of `types` other
 * than its own, converted, and whether converting is lossless (an
 * axis-aligned box to a poly and back) or what it loses. Converted points
 * and sizes land on whole world px at the game's `pxPerMetre`.
 */
export function shapeConversions(
  tuple: ShapeTuple,
  types: readonly ShapeType[] = SHAPE_TYPES,
  pxPerMetre: number = DEFAULT_LENGTH_UNIT,
): ShapeConversion[] {
  const parsed = parseShape(tuple);
  if (!parsed.ok) return [];
  const s = parsed.shape;
  const px = pxRounding(pxPerMetre);
  return types
    .filter((t) => t !== s.type)
    .map((to) => {
      const { shape, ...rest } = convert(s, to, px);
      return { to, tuple: shapeToTuple(shape), ...rest };
    });
}

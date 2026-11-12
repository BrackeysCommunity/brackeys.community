import type { z } from "zod";

import { mapShapeLengths } from "../scene/shapes";
import { LENGTH_UNITS, pxToMetres, type LengthUnitName } from "../scene/units";
import { DEFAULT_LENGTH_UNIT } from "./defaults";
import { fieldMeta } from "./fields";
import type { Registry } from "./types";

/** The game's px per metre: `world.lengthUnit`, else the default. */
export function pxPerMetreOf(registry: Registry): number {
  return registry.game?.world?.lengthUnit ?? DEFAULT_LENGTH_UNIT;
}

const isLengthUnit = (unit: unknown): unit is LengthUnitName =>
  (LENGTH_UNITS as readonly unknown[]).includes(unit);

/** The length unit a field declares in `meta.unit`, looking through its wrappers; undefined for any other field. */
export function lengthUnitOf(schema: z.core.$ZodType): LengthUnitName | undefined {
  const unit = fieldMeta(schema, "unit");
  return isLengthUnit(unit) ? unit : undefined;
}

/** The parts of a Zod definition the walker reads. */
type Def = {
  type: string;
  innerType?: z.core.$ZodType;
  in?: z.core.$ZodType;
  getter?: () => z.core.$ZodType;
  shape?: Record<string, z.core.$ZodType>;
  catchall?: z.core.$ZodType;
  valueType?: z.core.$ZodType;
  items?: readonly z.core.$ZodType[];
  rest?: z.core.$ZodType | null;
  element?: z.core.$ZodType;
  options?: readonly z.core.$ZodType[];
  discriminator?: string;
  left?: z.core.$ZodType;
};

const defOf = (schema: z.core.$ZodType) => schema._zod.def as unknown as Def;

/** The schema a wrapper, pipe or lazy schema stands for; undefined for any other. */
function innerOf(def: Def): z.core.$ZodType | undefined {
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "nonoptional":
    case "readonly":
    case "catch":
    case "success":
      return def.innerType;
    case "pipe":
      return def.in;
    case "lazy":
      return def.getter?.();
    default:
      return undefined;
  }
}

/** An object's schema for keys it doesn't name; a strict object's `never` names none. */
const catchallOf = (def: Def): z.core.$ZodType | undefined =>
  def.catchall && defOf(def.catchall).type !== "never" ? def.catchall : undefined;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Whether numbers under `schema` are lengths: a `meta.unit` sets it for
 * everything below (a length unit on a tuple covers its items), and a
 * non-length unit (`deg`, `ms`) clears it.
 */
function lengthBelow(schema: z.core.$ZodType, inherited: boolean): boolean {
  const unit = fieldMeta(schema, "unit");
  return unit === undefined ? inherited : isLengthUnit(unit);
}

/** The union option `value` takes: by discriminator, else the first that parses, else the first of its JSON kind. */
function optionFor(value: unknown, def: Def): z.core.$ZodType | undefined {
  const options = def.options ?? [];
  if (def.discriminator !== undefined && isRecord(value)) {
    const tag = value[def.discriminator];
    const hit = options.find((o) => {
      const values = (o._zod as { propValues?: Record<string, Set<unknown>> }).propValues;
      return values?.[def.discriminator!]?.has(tag) === true;
    });
    if (hit) return hit;
  }
  const parsed = options.find((o) => (o as z.ZodType).safeParse(value).success);
  if (parsed) return parsed;
  const kind = (s: z.core.$ZodType): string => {
    const d = defOf(s);
    const inner = innerOf(d);
    return inner ? kind(inner) : d.type;
  };
  const want = Array.isArray(value)
    ? ["array", "tuple"]
    : isRecord(value)
      ? ["object", "record"]
      : [typeof value];
  return options.find((o) => want.includes(kind(o)));
}

/** A value with no schema below it but a length unit above it: every number is a length, a shape tuple's angle aside. */
function scaleAll(value: unknown, toMetres: (n: number) => number): unknown {
  if (typeof value === "number") return toMetres(value);
  if (Array.isArray(value)) {
    const shape = mapShapeLengths(value, toMetres);
    return shape !== value ? shape : value.map((v) => scaleAll(v, toMetres));
  }
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scaleAll(v, toMetres)]));
  return value;
}

function walk(
  value: unknown,
  schema: z.core.$ZodType,
  inherited: boolean,
  toMetres: (n: number) => number,
): unknown {
  const length = lengthBelow(schema, inherited);
  const def = defOf(schema);
  const inner = innerOf(def);
  if (inner) return walk(value, inner, length, toMetres);
  switch (def.type) {
    case "number":
      return length && typeof value === "number" ? toMetres(value) : value;
    case "object": {
      if (!isRecord(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        const field = def.shape?.[k] ?? catchallOf(def);
        out[k] = field ? walk(v, field, length, toMetres) : v;
      }
      return out;
    }
    case "record": {
      if (!isRecord(value) || !def.valueType) return value;
      const field = def.valueType;
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v, field, length, toMetres)]),
      );
    }
    case "tuple": {
      if (!Array.isArray(value)) return value;
      return value.map((v, i) => {
        const item = def.items?.[i] ?? def.rest ?? undefined;
        return item ? walk(v, item, length, toMetres) : v;
      });
    }
    case "array": {
      if (!Array.isArray(value) || !def.element) return value;
      const element = def.element;
      return value.map((v) => walk(v, element, length, toMetres));
    }
    case "union": {
      const option = optionFor(value, def);
      return option ? walk(value, option, length, toMetres) : value;
    }
    case "intersection":
      return def.left ? walk(value, def.left, length, toMetres) : value;
    default:
      return length ? scaleAll(value, toMetres) : value;
  }
}

/**
 * `value` with every number under a length-unit field divided by
 * `pxPerMetre` (roundLength), through objects, tuples, arrays, records,
 * discriminated unions, optionals and defaults; other values unchanged.
 * A length unit on a container covers the numbers in it; a shape tuple's
 * `rotDeg` stays degrees.
 */
export function scaleLengths(value: unknown, schema: z.core.$ZodType, pxPerMetre: number): unknown {
  return walk(value, schema, false, (n) => pxToMetres(n, pxPerMetre));
}

const INDEX = /^(?:0|[1-9][0-9]*)$/;

/** The schema at `path` under `schema`, and whether a length unit above it covers it; null when the path leaves the schema. */
function schemaAt(
  schema: z.core.$ZodType,
  path: readonly string[],
  inherited: boolean,
): { schema: z.core.$ZodType; inherited: boolean } | null {
  if (path.length === 0) return { schema, inherited };
  const length = lengthBelow(schema, inherited);
  const def = defOf(schema);
  const inner = innerOf(def);
  if (inner) return schemaAt(inner, path, length);
  const [seg, ...rest] = path as [string, ...string[]];
  const index = INDEX.test(seg) ? Number(seg) : undefined;
  let next: z.core.$ZodType | undefined;
  switch (def.type) {
    case "object":
      next = def.shape?.[seg] ?? catchallOf(def);
      break;
    case "record":
      next = def.valueType;
      break;
    case "tuple":
      next = index === undefined ? undefined : (def.items?.[index] ?? def.rest ?? undefined);
      break;
    case "array":
      next = index === undefined ? undefined : def.element;
      break;
    case "union":
      for (const option of def.options ?? []) {
        const hit = schemaAt(option, path, length);
        if (hit) return hit;
      }
      return null;
    default:
      return null;
  }
  return next ? schemaAt(next, rest, length) : null;
}

/**
 * `value`, the value at field path `path` under `schema` (`["path",
 * "speed"]`), scaled as `scaleLengths` would scale it in place; null when
 * the path doesn't lead to a field the schema describes.
 */
export function scaleLengthsAt(
  value: unknown,
  schema: z.core.$ZodType,
  path: readonly string[],
  pxPerMetre: number,
): { value: unknown } | null {
  const at = schemaAt(schema, path, false);
  if (!at) return null;
  return { value: walk(value, at.schema, at.inherited, (n) => pxToMetres(n, pxPerMetre)) };
}

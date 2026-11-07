import { z } from "zod";

import type { Registry } from "../game/types";
import { fieldKind, unwrapSchema } from "../scene/schema";
import type { Pt, Ref, SceneOp, ShapeTuple } from "../scene/types";
import type { RefTarget } from "./refs";

type FieldBase = {
  /** Dot path into the entity, as an update op's `set` takes it. */
  path: string;
  /** The field's `meta.title`, else its name. */
  title: string;
  description?: string;
};

/** One tuple slot of a shape the inspector can edit as a number. */
export type ShapeSlot = { name: string; index: number; value: number; size: boolean };

export type InspectorField =
  | (FieldBase & {
      kind: "number";
      value: number | undefined;
      integer: boolean;
      min?: number;
      /** `min` itself is out of range. */
      exclusive?: boolean;
      max?: number;
    })
  | (FieldBase & { kind: "point"; value: Pt | undefined })
  | (FieldBase & { kind: "points"; value: Pt[] })
  /** `slots` is null for shapes edited only as a whole (polygons and chains). */
  | (FieldBase & { kind: "shape"; value: ShapeTuple; slots: ShapeSlot[] | null })
  | (FieldBase & { kind: "object"; fields: InspectorField[] })
  /** Shown, not edited here. */
  | (FieldBase & { kind: "value"; value: unknown });

/** Tuple slots after the tag; sizes are half-extents and radii, so must stay above 0. */
const SHAPE_SLOTS: Partial<Record<string, readonly { name: string; size?: boolean }[]>> = {
  box: [
    { name: "cx" },
    { name: "cy" },
    { name: "hw", size: true },
    { name: "hh", size: true },
    { name: "rotDeg" },
  ],
  circle: [{ name: "cx" }, { name: "cy" }, { name: "r", size: true }],
  capsule: [
    { name: "cx" },
    { name: "cy" },
    { name: "halfLen", size: true },
    { name: "r", size: true },
    { name: "rotDeg" },
  ],
};

/** The number slots of a box, circle or capsule tuple; null for polygons and chains. */
export function shapeSlots(tuple: ShapeTuple): ShapeSlot[] | null {
  const spec = SHAPE_SLOTS[tuple[0]];
  return spec
    ? spec.map(({ name, size }, i) => ({
        name,
        index: i + 1,
        value: (tuple[i + 1] as number | undefined) ?? 0,
        size: size === true,
      }))
    : null;
}

/** The tuple with one slot replaced. */
export function withShapeSlot(tuple: ShapeTuple, index: number, value: number): ShapeTuple {
  const next = [...tuple] as (string | number)[];
  next[index] = value;
  return next as ShapeTuple;
}

export type NumberBounds = { integer: boolean; min?: number; exclusive?: boolean; max?: number };

/** What a number schema allows, read from its JSON Schema form. */
export function numberBounds(s: z.ZodNumber): NumberBounds {
  const json = z.toJSONSchema(s) as {
    type?: string;
    minimum?: number;
    exclusiveMinimum?: number;
    maximum?: number;
  };
  // `.int()` alone bounds a number to the safe integers, which is no limit worth showing.
  const real = (n: number | undefined) =>
    n !== undefined && Math.abs(n) !== Number.MAX_SAFE_INTEGER ? n : undefined;
  const out: NumberBounds = { integer: json.type === "integer" };
  if (json.exclusiveMinimum !== undefined) {
    out.min = json.exclusiveMinimum;
    out.exclusive = true;
  } else if (real(json.minimum) !== undefined) out.min = json.minimum;
  if (real(json.maximum) !== undefined) out.max = json.maximum;
  return out;
}

function describeField(path: string, schema: z.ZodType, value: unknown): InspectorField {
  const name = path.slice(path.lastIndexOf(".") + 1);
  const meta = schema.meta() as { title?: unknown } | undefined;
  const base: FieldBase = {
    path,
    title: typeof meta?.title === "string" ? meta.title : name,
    ...(schema.description ? { description: schema.description } : {}),
  };
  const kind = fieldKind(schema);
  if (kind === "shape" && Array.isArray(value)) {
    const tuple = value as ShapeTuple;
    return { ...base, kind: "shape", value: tuple, slots: shapeSlots(tuple) };
  }
  if (kind === "point") return { ...base, kind: "point", value: value as Pt | undefined };
  const inner = unwrapSchema(schema);
  if (inner instanceof z.ZodNumber) {
    return {
      ...base,
      kind: "number",
      value: typeof value === "number" ? value : undefined,
      ...numberBounds(inner),
    };
  }
  if (inner instanceof z.ZodArray && fieldKind(inner.element) === "point") {
    return { ...base, kind: "points", value: Array.isArray(value) ? (value as Pt[]) : [] };
  }
  if (inner instanceof z.ZodObject) {
    const obj = (value ?? {}) as Record<string, unknown>;
    return { ...base, kind: "object", fields: fieldsOf(path, inner.shape, obj) };
  }
  return { ...base, kind: "value", value };
}

function fieldsOf(
  prefix: string,
  shape: z.ZodRawShape,
  value: Record<string, unknown>,
  order: readonly string[] = [],
): InspectorField[] {
  const names = [
    ...order.filter((n) => n in shape),
    ...Object.keys(shape).filter((n) => !order.includes(n)),
  ];
  return names.map((n) =>
    describeField(prefix ? `${prefix}.${n}` : n, shape[n] as z.ZodType, value[n]),
  );
}

/**
 * The fields the inspector shows for a selection, read from its registered
 * type's schema: titles from `meta.title`, help from `.describe()`, order
 * from the type's `inspector.order`. A bulk entry shows only its bulk field.
 * Empty when the type isn't registered.
 */
export function inspectorFields(registry: Registry, target: RefTarget): InspectorField[] {
  if (target.kind === "bulk") {
    const info = registry.bulkKey(target.key);
    const type = info && registry.types.get(info.type);
    const schema = type?.shape[info!.field];
    return schema ? [describeField(info!.field, schema as z.ZodType, target.value)] : [];
  }
  const type = registry.types.get(target.entity.type);
  return type ? fieldsOf("", type.shape, target.entity, type.inspector?.order) : [];
}

/** The update that sets one field, by its inspector path. */
export function fieldOp(ref: Ref, path: string, value: unknown): SceneOp {
  return { op: "update", ref, set: { [path]: value } };
}

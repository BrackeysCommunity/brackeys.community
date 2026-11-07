import { z } from "zod";

import { closest } from "./did-you-mean";
import { makeIssue } from "./issues";
import type { Pt, SceneIssue, ShapeObj, ShapeTuple, ShapeType } from "./types";

export const SHAPE_TYPES = [
  "box",
  "circle",
  "capsule",
  "poly",
  "chain",
] as const satisfies readonly ShapeType[];

export const SHAPE_SIGNATURES: Record<ShapeType, string> = {
  box: '["box", cx, cy, hw, hh, rotDeg?]',
  circle: '["circle", cx, cy, r]',
  capsule: '["capsule", cx, cy, halfLen, r, rotDeg?]',
  poly: '["poly", x1, y1, x2, y2, x3, y3, ...]',
  chain: '["chain", x1, y1, x2, y2, ...]',
};

/** Field names after the tag, for the fixed-arity tags. */
const FIELDS = {
  box: ["cx", "cy", "hw", "hh", "rotDeg"],
  circle: ["cx", "cy", "r"],
  capsule: ["cx", "cy", "halfLen", "r", "rotDeg"],
} as const;

export type ParseShapeResult = { ok: true; shape: ShapeObj } | { ok: false; issue: SceneIssue };

function fail(
  path: string | undefined,
  message: string,
  extra: Partial<SceneIssue> = {},
): ParseShapeResult {
  return { ok: false, issue: makeIssue("bad-shape", { message, path, ...extra }) };
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function describeValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "an array";
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return typeof v === "object" ? "an object" : typeof v;
}

function sub(path: string | undefined, key: string | number): string | undefined {
  return path === undefined ? undefined : `${path}/${key}`;
}

function pairs(coords: readonly number[]): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) pts.push([coords[i]!, coords[i + 1]!]);
  return pts;
}

function checkPoints(
  type: "poly" | "chain",
  pts: Pt[],
  path: string | undefined,
): ParseShapeResult {
  const min = type === "poly" ? 3 : 2;
  if (pts.length < min) {
    return fail(path, `${type} needs at least ${min} points; got ${pts.length}`, {
      expected: SHAPE_SIGNATURES[type],
      got: `${pts.length} points`,
    });
  }
  return { ok: true, shape: { type, pts } };
}

function parseTuple(input: unknown[], path: string | undefined): ParseShapeResult {
  const tag = input[0];
  if (typeof tag !== "string" || !(SHAPE_TYPES as readonly string[]).includes(tag)) {
    const suggestion = typeof tag === "string" ? closest(tag, SHAPE_TYPES) : undefined;
    return fail(
      sub(path, 0),
      `unknown shape tag ${describeValue(tag)}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
      {
        expected: SHAPE_TYPES.map((t) => `"${t}"`).join(" | "),
        got: describeValue(tag),
        hint: suggestion
          ? `Use "${suggestion}": ${SHAPE_SIGNATURES[suggestion as ShapeType]}.`
          : `A shape tuple starts with one of ${SHAPE_TYPES.join(", ")}.`,
      },
    );
  }
  const type = tag as ShapeType;
  const values = input.slice(1);
  for (let i = 0; i < values.length; i++) {
    if (!isNum(values[i])) {
      const name = type in FIELDS ? FIELDS[type as keyof typeof FIELDS][i] : undefined;
      return fail(
        sub(path, i + 1),
        `${type} value ${i + 1}${name ? ` (${name})` : ""} must be a finite number; got ${describeValue(values[i])}`,
        { expected: "number", got: describeValue(values[i]) },
      );
    }
  }
  const nums = values as number[];

  if (type === "poly" || type === "chain") {
    if (nums.length % 2 !== 0) {
      return fail(
        path,
        `${type} expects ${SHAPE_SIGNATURES[type]}; got an odd number of coordinates (${nums.length})`,
        {
          expected: SHAPE_SIGNATURES[type],
          got: `${input.length} values`,
        },
      );
    }
    return checkPoints(type, pairs(nums), path);
  }

  const fields = FIELDS[type];
  const required = type === "circle" ? fields.length : fields.length - 1;
  const wrongCount = () =>
    fail(path, `${type} expects ${SHAPE_SIGNATURES[type]}; got ${input.length} values`, {
      expected: SHAPE_SIGNATURES[type],
      got: `${input.length} values`,
    });
  if (nums.length < required || nums.length > fields.length) return wrongCount();
  for (const [i, n] of nums.entries()) {
    const name = fields[i];
    if (name !== "cx" && name !== "cy" && name !== "rotDeg" && !(n > 0)) {
      return fail(sub(path, i + 1), `${type} ${name} must be > 0; got ${n}`, {
        expected: "> 0",
        got: String(n),
      });
    }
  }
  const [cx, cy, a, b, rotDeg = 0] = nums;
  if (cx === undefined || cy === undefined || a === undefined) return wrongCount();
  if (type === "circle") return { ok: true, shape: { type, cx, cy, r: a } };
  if (b === undefined) return wrongCount();
  if (type === "box") return { ok: true, shape: { type, cx, cy, hw: a, hh: b, rotDeg } };
  return { ok: true, shape: { type, cx, cy, halfLen: a, r: b, rotDeg } };
}

function parseRect(input: Record<string, unknown>, path: string | undefined): ParseShapeResult {
  for (const key of ["left", "top", "right", "bottom"] as const) {
    if (!isNum(input[key])) {
      return fail(
        sub(path, key),
        `rect ${key} must be a finite number; got ${describeValue(input[key])}`,
        {
          expected: "number",
          got: describeValue(input[key]),
        },
      );
    }
  }
  const { left, top, right, bottom } = input as Record<"left" | "top" | "right" | "bottom", number>;
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) {
    return fail(path, `rect needs right > left and bottom > top; got ${width}x${height}`, {
      expected: "right > left, bottom > top",
      got: `${width}x${height}`,
    });
  }
  const oddW = Number.isInteger(width) && width % 2 !== 0;
  const oddH = Number.isInteger(height) && height % 2 !== 0;
  if (oddW || oddH) {
    const widen = [oddW ? `right: ${right + 1}` : null, oddH ? `bottom: ${bottom + 1}` : null]
      .filter(Boolean)
      .join(", ");
    return fail(
      path,
      `rect is ${width}x${height}; box half-extents must be whole pixels, so each side must be even`,
      {
        expected: "even width and height",
        got: `${width}x${height}`,
        hint: `Widen it by 1px (${widen}).`,
      },
    );
  }
  return {
    ok: true,
    shape: {
      type: "box",
      cx: left + width / 2,
      cy: top + height / 2,
      hw: width / 2,
      hh: height / 2,
      rotDeg: 0,
    },
  };
}

function readPts(raw: unknown, path: string | undefined): Pt[] | ParseShapeResult {
  if (!Array.isArray(raw))
    return fail(path, `pts must be an array of [x, y]; got ${describeValue(raw)}`);
  const pts: Pt[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) {
      return fail(sub(path, i), `point ${i} must be [x, y] with finite numbers`);
    }
    pts.push([p[0], p[1]]);
  }
  return pts;
}

function parseObject(input: Record<string, unknown>, path: string | undefined): ParseShapeResult {
  const type = input.type;
  if (type === "rect") return parseRect(input, path);
  if (type === "poly" || type === "chain") {
    const pts = readPts(input.pts, sub(path, "pts"));
    return Array.isArray(pts) ? checkPoints(type, pts, path) : pts;
  }
  if (type === "box" || type === "circle" || type === "capsule") {
    const fields = FIELDS[type];
    const tuple: unknown[] = [type];
    for (const name of fields) {
      if (name === "rotDeg") {
        if (input.rotDeg !== undefined) tuple.push(input.rotDeg);
      } else {
        tuple.push(input[name]);
      }
    }
    return parseTuple(tuple, path);
  }
  const suggestion = typeof type === "string" ? closest(type, [...SHAPE_TYPES, "rect"]) : undefined;
  return fail(
    sub(path, "type"),
    `unknown shape type ${describeValue(type)}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
    {
      expected: [...SHAPE_TYPES, "rect"].map((t) => `"${t}"`).join(" | "),
      got: describeValue(type),
    },
  );
}

/** Accepts a tuple, a `ShapeObj`, or `{ type: "rect", left, top, right, bottom }`. */
export function parseShape(input: unknown, path?: string): ParseShapeResult {
  if (Array.isArray(input)) {
    if (input.length === 0)
      return fail(path, "shape tuple is empty", { expected: SHAPE_TYPES.join(" | ") });
    return parseTuple(input, path);
  }
  if (input !== null && typeof input === "object")
    return parseObject(input as Record<string, unknown>, path);
  return fail(
    path,
    `expected a shape tuple such as ${SHAPE_SIGNATURES.box}; got ${describeValue(input)}`,
    {
      expected: "shape tuple",
      got: describeValue(input),
    },
  );
}

/** Canonical tuple; `rotDeg` is dropped when 0. */
export function shapeToTuple(s: ShapeObj): ShapeTuple {
  switch (s.type) {
    case "box":
      return s.rotDeg ? ["box", s.cx, s.cy, s.hw, s.hh, s.rotDeg] : ["box", s.cx, s.cy, s.hw, s.hh];
    case "circle":
      return ["circle", s.cx, s.cy, s.r];
    case "capsule":
      return s.rotDeg
        ? ["capsule", s.cx, s.cy, s.halfLen, s.r, s.rotDeg]
        : ["capsule", s.cx, s.cy, s.halfLen, s.r];
    case "poly":
      return ["poly", ...s.pts.flat()];
    case "chain":
      return ["chain", ...s.pts.flat()];
  }
}

// ─── Zod and JSON Schema ─────────────────────────────────

const px = (description: string) => ({ type: "number", unit: "px", description });
const size = (description: string) => ({
  type: "number",
  exclusiveMinimum: 0,
  unit: "px",
  description,
});
const rot = {
  type: "number",
  unit: "deg",
  description: "Rotation in integer degrees, clockwise on screen (y is down). Omitted means 0.",
};

const TUPLE_JSON: Record<ShapeType, Record<string, unknown>> = {
  box: {
    title: "box",
    description:
      "Axis-aligned box (a Rapier cuboid) by centre and half-extents, optionally rotated about its centre.",
    type: "array",
    prefixItems: [
      { const: "box" },
      px("Centre x."),
      px("Centre y (y is down)."),
      size("Half-width; the box is 2*hw wide."),
      size("Half-height; the box is 2*hh tall."),
      rot,
    ],
    items: false,
    minItems: 5,
    maxItems: 6,
  },
  circle: {
    title: "circle",
    description: "Circle (a Rapier ball) by centre and radius.",
    type: "array",
    prefixItems: [
      { const: "circle" },
      px("Centre x."),
      px("Centre y (y is down)."),
      size("Radius."),
    ],
    items: false,
    minItems: 4,
    maxItems: 4,
  },
  capsule: {
    title: "capsule",
    description:
      "Capsule, vertical before rotation: a segment of half-length halfLen through the centre, swept by radius r.",
    type: "array",
    prefixItems: [
      { const: "capsule" },
      px("Centre x."),
      px("Centre y (y is down)."),
      size("Half the length of the inner segment."),
      size("Radius."),
      rot,
    ],
    items: false,
    minItems: 5,
    maxItems: 6,
  },
  poly: {
    title: "poly",
    description:
      "Convex polygon as flat x, y pairs (at least 3 points). Points are absolute; the loader centres the body on their centroid. Concave outlines must be split or drawn as a chain.",
    type: "array",
    prefixItems: [{ const: "poly" }],
    items: { type: "number", unit: "px" },
    minItems: 7,
  },
  chain: {
    title: "chain",
    description:
      "Open polyline as flat x, y pairs (at least 2 points), for static terrain. Allowed on solid and sensor only.",
    type: "array",
    prefixItems: [{ const: "chain" }],
    items: { type: "number", unit: "px" },
    minItems: 5,
  },
};

/** Every shape tuple schema derives from this one, which is how `isShapeSchema` knows a shape field. */
const SHAPE_ROOT = z.unknown();

/** Whether `schema` is a shape tuple schema, or derives from one through `.describe()`, `.meta()` or `.optional()`. */
export function isShapeSchema(schema: z.core.$ZodType): boolean {
  return derivesFrom(schema, SHAPE_ROOT);
}

/** Whether `schema` is `root` or was made from it by clones, refinements and optional or default wrappers. */
export function derivesFrom(schema: z.core.$ZodType, root: z.core.$ZodType): boolean {
  for (let s: z.core.$ZodType | undefined = schema; s; ) {
    if (s === root) return true;
    const def = s._zod.def as { innerType?: z.core.$ZodType };
    s = def.innerType ?? s._zod.parent;
  }
  return false;
}

/**
 * A shape tuple schema limited to `types`. Validation goes through
 * `parseShape`, so errors carry its messages instead of a union failure;
 * the JSON Schema form is a `oneOf` of the allowed tuple layouts.
 */
export function shapeTupleSchemaOf(
  types: readonly ShapeType[],
  id: string,
  owner?: string,
): z.ZodType<ShapeTuple> {
  const signatures = types.map((t) => SHAPE_SIGNATURES[t]);
  const schema = SHAPE_ROOT.superRefine((value, ctx) => {
    if (!Array.isArray(value)) {
      ctx.addIssue({
        code: "custom",
        message: `expected a shape tuple such as ${signatures[0]}; got ${describeValue(value)}`,
        params: { sceneCode: "bad-shape", expected: "shape tuple", got: describeValue(value) },
      });
      return;
    }
    const result = parseShape(value, "");
    if (!result.ok) {
      const { message, expected, got, hint, path } = result.issue;
      const at = path
        ? path
            .slice(1)
            .split("/")
            .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg))
        : [];
      ctx.addIssue({
        code: "custom",
        message,
        path: at,
        params: { sceneCode: "bad-shape", expected, got, hint },
      });
      return;
    }
    if (!types.includes(result.shape.type)) {
      ctx.addIssue({
        code: "custom",
        message: `${owner ?? "this"} shape must be ${types.join(" or ")}; got ${result.shape.type}`,
        path: [0],
        params: {
          sceneCode: "bad-shape",
          expected: types.join(" | "),
          got: result.shape.type,
          hint: `Use ${signatures.join(" or ")}.`,
        },
      });
    }
  }).meta({
    id,
    description: `A shape tuple: ${signatures.join(" | ")}. Integer pixels, y is down.`,
    oneOf: types.map((t) => TUPLE_JSON[t]),
  });
  return schema as unknown as z.ZodType<ShapeTuple>;
}

export const ShapeTupleSchema = shapeTupleSchemaOf(SHAPE_TYPES, "ShapeTuple");

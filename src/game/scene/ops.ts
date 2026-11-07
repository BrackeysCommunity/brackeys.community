import { closest } from "./did-you-mean";
import { diffScenes } from "./diff";
import { bulkId, parseBulkId } from "./expand";
import { sceneHash } from "./hash";
import { jsonPointer, makeIssue } from "./issues";
import { OpBatchSchema, opRefs, SceneOpSchema, usesBulkRefs } from "./ops-schema";
import { entityIssues, suggestBehavior } from "./parse";
import { entitySchemaFor, ID_PATTERN } from "./schema";
import { aabb } from "./shape-geometry";
import { parseShape, shapeToTuple } from "./shapes";
import {
  BEHAVIORS,
  BULK_KEYS,
  type ApplyOptions,
  type ApplyResult,
  type Behavior,
  type BulkKey,
  type EntityDef,
  type EntityInput,
  type IssueCode,
  type OpBatch,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type ShapeBulkKey,
  type ShapeTuple,
  type SpotAnchor,
} from "./types";
import { REFERENCE_FIELDS, validateScene } from "./validate";

type BulkValue = ShapeTuple | Pt;
/** A bulk entry with identity, so references keep pointing at it while indices shift. */
type Slot = { value: BulkValue; orig: number | null; demotedFrom?: string };
type EntRec = { def: EntityDef; orig: number | null; origId: string | null };
type Target = { kind: "bulk"; key: BulkKey; slot: Slot } | { kind: "entity"; rec: EntRec };
type Json = Record<string, unknown>;

type Work = {
  name: string;
  bounds: SceneDefinition["bounds"];
  spawn: Pt[];
  buckets: Map<BulkKey, Slot[]>;
  /** Each bucket's slots as the batch found them, for start-of-batch references. */
  start: Map<BulkKey, Slot[]>;
  touchedBuckets: Set<BulkKey>;
  entities: EntRec[];
  entitiesTouched: boolean;
  created: string[];
  /** Start-of-batch bulk refs that were promoted, to the id they became. */
  promoted: Map<Ref, string>;
};

class OpFailure extends Error {
  constructor(readonly issue: SceneIssue) {
    super(issue.message);
  }
}

function fail(
  code: IssueCode,
  message: string,
  fields: Partial<Omit<SceneIssue, "code" | "message">> = {},
): never {
  throw new OpFailure(makeIssue(code, { message, ...fields }));
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function bucketValues(def: SceneDefinition, key: BulkKey): BulkValue[] {
  return ((def as Json)[key] as BulkValue[] | undefined) ?? [];
}

export function applyOps(
  def: SceneDefinition,
  batch: OpBatch,
  opts: ApplyOptions = {},
): ApplyResult {
  const startHash = sceneHash(def);

  const parsed = OpBatchSchema.safeParse(batch);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    const segs = first.path.map((p) => (typeof p === "symbol" ? String(p) : p));
    const failedAt = segs[0] === "ops" && typeof segs[1] === "number" ? segs[1] : 0;
    return { ok: false, hash: startHash, failedAt, issue: batchIssue(first, segs, batch) };
  }

  if (usesBulkRefs(batch) && batch.base !== startHash) {
    const failedAt = batch.ops.findIndex((op) => opRefs(op).some((r) => r.startsWith("~")));
    return {
      ok: false,
      hash: startHash,
      failedAt,
      issue: makeIssue("stale-base", {
        message: batch.base
          ? `The batch was written against scene ${batch.base}, but the scene is now ${startHash}, so its ~ references may point at different entries.`
          : "The batch uses ~ bulk references but has no base hash.",
        expected: batch.base,
        got: startHash,
        hint: "Re-read the scene and rebuild the batch against the current hash, or promote the bulk entries to ids and refer to those.",
      }),
    };
  }

  const start = clone(def);
  const w = initWork(start);
  for (let i = 0; i < batch.ops.length; i++) {
    try {
      applyOp(w, batch.ops[i]!, i);
    } catch (err) {
      if (err instanceof OpFailure)
        return { ok: false, hash: startHash, failedAt: i, issue: err.issue };
      throw err;
    }
  }

  const after = materialize(start, w);
  const hash = sceneHash(after);
  const inverseOps = buildInverse(start, w);
  const inverse: OpBatch = { ops: inverseOps };
  if (batch.label) inverse.label = `Undo ${batch.label}`;
  if (usesBulkRefs(inverse)) inverse.base = hash;

  return {
    ok: true,
    def: after,
    hash,
    inverse,
    touched: touchedRefs(start, w),
    created: w.created,
    remap: refRemap(start, w),
    diff: diffScenes(def, after),
    issues: opts.validate === "none" ? [] : validateScene(after),
  };
}

function initWork(start: SceneDefinition): Work {
  const buckets = new Map<BulkKey, Slot[]>();
  const startSlots = new Map<BulkKey, Slot[]>();
  for (const key of BULK_KEYS) {
    const slots = bucketValues(start, key).map((value, i): Slot => ({ value, orig: i }));
    buckets.set(key, slots);
    startSlots.set(key, [...slots]);
  }
  return {
    name: start.name,
    bounds: start.bounds,
    spawn: clone(start.spawn),
    buckets,
    start: startSlots,
    touchedBuckets: new Set(),
    entities: (start.entities ?? []).map((d, i) => ({ def: d, orig: i, origId: d.id })),
    entitiesTouched: false,
    created: [],
    promoted: new Map(),
  };
}

function materialize(start: SceneDefinition, w: Work): SceneDefinition {
  const out: Json = { ...start, name: w.name, bounds: w.bounds, spawn: w.spawn };
  for (const key of w.touchedBuckets) {
    const values = w.buckets.get(key)!.map((s) => s.value);
    if (values.length > 0) out[key] = values;
    else delete out[key];
  }
  if (w.entitiesTouched) {
    if (w.entities.length > 0) out.entities = w.entities.map((r) => r.def);
    else delete out.entities;
  }
  return out as SceneDefinition;
}

// ─── Resolution and checks ───────────────────────────────

function resolve(w: Work, ref: Ref): Target {
  if (ref.startsWith("~")) {
    const p = parseBulkId(ref);
    if (!p) {
      fail(
        "ref-not-found",
        `${ref} is not a bulk reference; expected ~<bulkKey>:<index> with a key from ${BULK_KEYS.join(", ")}.`,
        {
          got: ref,
        },
      );
    }
    const slot = w.start.get(p.key)![p.index];
    if (!slot) {
      fail(
        "ref-not-found",
        `${ref} doesn't exist: ${p.key} had ${w.start.get(p.key)!.length} entries when the batch started.`,
        { got: ref },
      );
    }
    if (!w.buckets.get(p.key)!.includes(slot)) {
      fail("ref-not-found", `${ref} was already removed or promoted earlier in this batch.`, {
        got: ref,
      });
    }
    return { kind: "bulk", key: p.key, slot };
  }
  return { kind: "entity", rec: resolveEntity(w, ref) };
}

function resolveEntity(w: Work, id: string): EntRec {
  const rec = w.entities.find((r) => r.def.id === id);
  if (!rec) {
    const suggestion = closest(
      id,
      w.entities.map((r) => r.def.id),
    );
    fail(
      "ref-not-found",
      `No entity has the id "${id}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
      { got: id },
    );
  }
  return rec;
}

function checkNewId(w: Work, id: string): void {
  if (!ID_PATTERN.test(id)) {
    fail(
      "bad-id",
      `"${id}" isn't a valid id: use lowercase letters, digits and hyphens, starting with a letter or digit, at most 48 characters.`,
      {
        got: id,
        expected: String(ID_PATTERN),
      },
    );
  }
  if (w.entities.some((r) => r.def.id === id)) {
    fail("id-taken", `The id "${id}" is already used by another entity.`, {
      entityIds: [id],
      got: id,
      hint: `Pick another id, such as "${freeId(w, id)}".`,
    });
  }
}

function freeId(w: Work, prefix: string): string {
  const ids = new Set(w.entities.map((r) => r.def.id));
  let n = prefix.match(/-\d+$/) ? 2 : 1;
  const stem = prefix.replace(/-\d+$/, "");
  while (ids.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/** Where an entity-relative pointer points in the op that produced the entity. */
type Relocate = (rel: string) => string;

const inEntity =
  (i: number): Relocate =>
  (rel) =>
    `/ops/${i}/entity${rel}`;

/** An update's `set` keys are dotted paths, so an entity field maps to one. */
const inSet =
  (i: number): Relocate =>
  (rel) =>
    rel ? `/ops/${i}/set/${rel.slice(1).split("/").join(".")}` : `/ops/${i}`;

function validateEntity(def: EntityDef, relocate: Relocate): void {
  const result = entitySchemaFor(def.b).safeParse(def);
  if (!result.success) {
    const issue = entityIssues(result.error.issues, def, relocate)[0]!;
    throw new OpFailure({ ...issue, message: `${def.id}: ${issue.message}`, entityIds: [def.id] });
  }
}

const BATCH_KEYS = ["label", "base", "actor", "ops"];

function describeValue(v: unknown): string {
  if (v === undefined) return "missing";
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return typeof v === "string" ? JSON.stringify(v) : typeof v;
}

function valueAt(root: unknown, segs: readonly (string | number)[]): unknown {
  let cur = root;
  for (const s of segs) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[s];
  }
  return cur;
}

/** The keys an op of this name takes, from its schema. */
function opKeys(name: unknown): string[] {
  for (const option of SceneOpSchema.options) {
    const shape = (option as { shape?: Record<string, { value?: unknown }> }).shape;
    if (shape && shape.op?.value === name) return Object.keys(shape);
  }
  return [];
}

/** A batch schema failure as an issue with a pointer, `expected`, `got` and a did-you-mean. */
function batchIssue(
  issue: { code: string; message: string; keys?: string[]; expected?: unknown; values?: unknown[] },
  segs: (string | number)[],
  batch: unknown,
): SceneIssue {
  const path = jsonPointer(segs);
  const where = path || "/";
  if (issue.code === "unrecognized_keys" && issue.keys?.length) {
    const key = issue.keys[0]!;
    const known =
      segs.length === 0
        ? BATCH_KEYS
        : segs.length === 2 && segs[0] === "ops"
          ? opKeys(valueAt(batch, [...segs, "op"]))
          : [];
    const suggestion = closest(key, known);
    return makeIssue("op-invalid", {
      message: `unknown key "${key}" at ${where}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
      path: `${path}${jsonPointer([key])}`,
      got: key,
      expected: known.length > 0 ? known.join(", ") : undefined,
      hint: suggestion ? `Rename "${key}" to "${suggestion}".` : undefined,
    });
  }
  const got = valueAt(batch, segs);
  if (segs[segs.length - 1] === "b" && segs[segs.length - 2] === "entity") {
    const suggestion = typeof got === "string" ? suggestBehavior(got) : undefined;
    return makeIssue("op-invalid", {
      message: `unknown behavior b: ${describeValue(got)} at ${where}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
      path,
      expected: BEHAVIORS.join(" | "),
      got: describeValue(got),
      hint: suggestion ? `Use b: "${suggestion}".` : `b is one of ${BEHAVIORS.join(", ")}.`,
    });
  }
  const expected = Array.isArray(issue.values)
    ? issue.values.map(String).join(" | ")
    : typeof issue.expected === "string"
      ? issue.expected
      : undefined;
  return makeIssue("op-invalid", {
    message: `${where}: ${issue.message}`,
    path,
    expected,
    got: describeValue(got),
  });
}

function storeShape(input: unknown, cloudOnly: boolean): ShapeTuple {
  const result = parseShape(input);
  if (!result.ok) throw new OpFailure(result.issue);
  if (cloudOnly && result.shape.type !== "box") {
    fail("bad-shape", `cloud is box-only; got a ${result.shape.type}.`, {
      expected: "box",
      got: result.shape.type,
    });
  }
  return Array.isArray(input) ? (clone(input) as ShapeTuple) : shapeToTuple(result.shape);
}

function insertIndex(index: number | undefined, length: number, what: string): number {
  if (index === undefined) return length;
  if (index > length)
    fail("op-invalid", `index ${index} is past the end of ${what}, which has ${length} entries.`);
  return index;
}

// ─── Geometry ────────────────────────────────────────────

function translateTuple(t: ShapeTuple, [dx, dy]: Pt): ShapeTuple {
  const out = [...t] as (string | number)[];
  if (t[0] === "poly" || t[0] === "chain") {
    for (let i = 1; i + 1 < out.length; i += 2) {
      out[i] = (out[i] as number) + dx;
      out[i + 1] = (out[i + 1] as number) + dy;
    }
  } else {
    out[1] = (out[1] as number) + dx;
    out[2] = (out[2] as number) + dy;
  }
  return out as ShapeTuple;
}

const addPt = (p: Pt, [dx, dy]: Pt): Pt => [p[0] + dx, p[1] + dy];

function translateEntity(def: EntityDef, by: Pt): EntityDef {
  const next = clone(def);
  if (next.b === "mover") next.path.pts = next.path.pts.map((p) => addPt(p, by));
  else if ("at" in next) next.at = addPt(next.at, by);
  else next.shape = translateTuple(next.shape, by);
  return next;
}

function translateTarget(t: Target, by: Pt): void {
  if (t.kind === "bulk") {
    t.slot.value =
      t.key === "anchor"
        ? addPt(t.slot.value as Pt, by)
        : translateTuple(t.slot.value as ShapeTuple, by);
  } else {
    t.rec.def = translateEntity(t.rec.def, by);
  }
}

function targetLabel(t: Target, ref: Ref): string {
  return t.kind === "entity" ? t.rec.def.id : ref;
}

function spotOf(t: Target, ref: Ref, anchor: SpotAnchor): Pt {
  let tuple: ShapeTuple;
  let offset: Pt = [0, 0];
  if (t.kind === "bulk") {
    if (t.key === "anchor") return t.slot.value as Pt;
    tuple = t.slot.value as ShapeTuple;
  } else {
    const def = t.rec.def;
    if ("at" in def) return def.at;
    tuple = def.shape;
    if (def.b === "mover") offset = def.path.pts[0] ?? [0, 0];
  }
  const parsed = parseShape(tuple);
  if (!parsed.ok)
    fail("bad-shape", `${targetLabel(t, ref)} has an invalid shape: ${parsed.issue.message}`);
  const box = aabb(parsed.shape);
  const minX = box.minX + offset[0];
  const maxX = box.maxX + offset[0];
  const minY = box.minY + offset[1];
  const maxY = box.maxY + offset[1];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  switch (anchor) {
    case "top":
      return [cx, minY];
    case "bottom":
      return [cx, maxY];
    case "left":
      return [minX, cy];
    case "right":
      return [maxX, cy];
    default:
      return [cx, cy];
  }
}

// ─── Field paths ─────────────────────────────────────────

function arrayIndex(seg: string, arr: unknown[], allowAppend: boolean, path: string): number {
  if (!/^\d+$/.test(seg)) fail("op-invalid", `${path}: "${seg}" isn't an array index.`);
  const idx = Number(seg);
  if (idx > arr.length || (idx === arr.length && !allowAppend)) {
    fail("op-invalid", `${path}: index ${idx} is out of range; the array has ${arr.length} items.`);
  }
  return idx;
}

function setPath(root: Json, segs: string[], value: unknown, path: string): void {
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    if (Array.isArray(cur)) {
      cur = cur[arrayIndex(seg, cur, false, path)];
    } else {
      const obj = cur as Json;
      if (obj[seg] === undefined) obj[seg] = {};
      cur = obj[seg];
    }
    if (cur === null || typeof cur !== "object") {
      fail(
        "op-invalid",
        `${path}: ${segs.slice(0, i + 1).join(".")} holds a value, not an object or array.`,
      );
    }
  }
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur)) cur[arrayIndex(last, cur, true, path)] = value;
  else (cur as Json)[last] = value;
}

function unsetPath(root: Json, segs: string[]): void {
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || typeof cur !== "object") return;
    cur = (cur as Json)[segs[i]!];
  }
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur)) {
    const idx = Number(last);
    if (/^\d+$/.test(last) && idx < cur.length) cur.splice(idx, 1);
  } else if (cur !== null && typeof cur === "object") {
    delete (cur as Json)[last];
  }
}

function getPath(root: unknown, segs: string[]): unknown {
  let cur = root;
  for (const seg of segs) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[seg];
  }
  return cur;
}

function checkPaths(paths: string[]): string[][] {
  const split = paths.map((p) => p.split("."));
  for (let i = 0; i < split.length; i++) {
    const a = split[i]!;
    if (a.some((s) => s === ""))
      fail(
        "op-invalid",
        `"${paths[i]}" isn't a field path; use dot-separated names like path.speed.`,
      );
    if (a[0] === "id")
      fail("op-invalid", "An entity's id can't be set by update; use the rename op.");
    if (a[0] === "b")
      fail(
        "op-invalid",
        "An entity's behavior can't change; remove it and add a new entity instead.",
      );
    for (let j = 0; j < split.length; j++) {
      const b = split[j]!;
      if (i !== j && a.length <= b.length && a.every((s, k) => s === b[k])) {
        fail(
          "op-invalid",
          `The update names both "${paths[i]}" and "${paths[j]}"; set or unset each field once.`,
        );
      }
    }
  }
  return split;
}

function referencesTo(w: Work, id: string): string[] {
  const out: string[] = [];
  for (const rec of w.entities) {
    for (const { field } of REFERENCE_FIELDS[rec.def.b] ?? []) {
      const v = getPath(rec.def, field.split("."));
      if (v === id || (Array.isArray(v) && v.includes(id))) out.push(rec.def.id);
    }
  }
  return out;
}

// ─── Ops ─────────────────────────────────────────────────

function applyOp(w: Work, op: SceneOp, i: number): void {
  switch (op.op) {
    case "add": {
      const input = op.entity as unknown as Json;
      const givenId = input.id as string | undefined;
      let entity: Json;
      if (givenId !== undefined) {
        checkNewId(w, givenId);
        entity = clone(input);
      } else {
        const id = freeId(w, String(input.b));
        const rest = clone(input);
        delete rest.id;
        entity = { id, ...rest };
      }
      if ("shape" in entity) entity.shape = storeShape(entity.shape, entity.b === "cloud");
      const def = entity as EntityDef;
      validateEntity(def, inEntity(i));
      const index = insertIndex(op.index, w.entities.length, "entities");
      w.entities.splice(index, 0, { def, orig: null, origId: null });
      w.entitiesTouched = true;
      w.created.push(def.id);
      return;
    }
    case "addBulk": {
      const bucket = w.buckets.get(op.key)!;
      const values: BulkValue[] =
        op.key === "anchor"
          ? op.points.map((p) => clone(p))
          : op.shapes.map((s) => storeShape(s, op.key === "cloud"));
      const index = insertIndex(op.index, bucket.length, op.key);
      bucket.splice(index, 0, ...values.map((value): Slot => ({ value, orig: null })));
      w.touchedBuckets.add(op.key);
      return;
    }
    case "update": {
      const set = op.set ?? {};
      const unset = op.unset ?? [];
      const setKeys = Object.keys(set);
      if (setKeys.length === 0 && unset.length === 0)
        fail("op-invalid", `update of ${op.ref} has nothing to set or unset.`);
      const split = checkPaths([...setKeys, ...unset]);
      const t = resolve(w, op.ref);
      if (t.kind === "bulk") {
        const field = t.key === "anchor" ? "at" : "shape";
        if (unset.length > 0 || setKeys.length !== 1 || setKeys[0] !== field) {
          fail(
            "op-invalid",
            `${op.ref} is a bulk entry, which holds only \`${field}\`; promote it to an entity to give it other fields.`,
            {
              hint: `{ "op": "promote", "ref": "${op.ref}", "id": "..." }`,
            },
          );
        }
        t.slot.value =
          field === "at" ? checkPt(set.at, op.ref) : storeShape(set.shape, t.key === "cloud");
        w.touchedBuckets.add(t.key);
        return;
      }
      const next = clone(t.rec.def) as unknown as Json;
      unset.forEach((_, k) => unsetPath(next, split[setKeys.length + k]!));
      setKeys.forEach((path, k) => {
        const value =
          path === "shape" ? storeShape(set[path], next.b === "cloud") : clone(set[path]);
        setPath(next, split[k]!, value, path);
      });
      validateEntity(next as EntityDef, inSet(i));
      t.rec.def = next as EntityDef;
      w.entitiesTouched = true;
      return;
    }
    case "move": {
      const targets = [...new Set(op.refs)].map((r) => resolve(w, r));
      for (const t of targets) markTouched(w, t);
      for (const t of targets) translateTarget(t, op.by);
      return;
    }
    case "place": {
      const t = resolve(w, op.ref);
      const spot = spotOf(t, op.ref, op.anchor ?? "center");
      markTouched(w, t);
      translateTarget(t, [Math.round(op.at[0] - spot[0]), Math.round(op.at[1] - spot[1])]);
      return;
    }
    case "remove": {
      const targets = [...new Set(op.refs)].map((r) => resolve(w, r));
      for (const t of targets) {
        if (t.kind === "bulk") {
          const bucket = w.buckets.get(t.key)!;
          bucket.splice(bucket.indexOf(t.slot), 1);
        } else {
          w.entities.splice(w.entities.indexOf(t.rec), 1);
        }
        markTouched(w, t);
      }
      return;
    }
    case "rename": {
      const rec = resolveEntity(w, op.from);
      if (op.from === op.to) fail("op-invalid", `rename from "${op.from}" to itself does nothing.`);
      checkNewId(w, op.to);
      const next = clone(rec.def);
      next.id = op.to;
      rec.def = next;
      for (const other of w.entities) {
        for (const { field } of REFERENCE_FIELDS[other.def.b] ?? []) {
          const segs = field.split(".");
          const v = getPath(other.def, segs);
          if (v === op.from || (Array.isArray(v) && v.includes(op.from))) {
            const rewritten = clone(other.def) as unknown as Json;
            setPath(
              rewritten,
              segs,
              Array.isArray(v) ? v.map((x) => (x === op.from ? op.to : x)) : op.to,
              field,
            );
            other.def = rewritten as EntityDef;
          }
        }
      }
      w.entitiesTouched = true;
      return;
    }
    case "promote": {
      if (!op.ref.startsWith("~"))
        fail(
          "op-invalid",
          `${op.ref} is already an entity; promote takes a bulk reference such as ~solid:3.`,
        );
      const t = resolve(w, op.ref);
      if (t.kind !== "bulk") return;
      checkNewId(w, op.id);
      const [b, material] = t.key.split(":") as [Behavior, string | undefined];
      const def = (
        t.key === "anchor"
          ? { id: op.id, b, at: clone(t.slot.value) }
          : material
            ? { id: op.id, b, shape: clone(t.slot.value), material }
            : { id: op.id, b, shape: clone(t.slot.value) }
      ) as EntityDef;
      validateEntity(def, () => `/ops/${i}`);
      const bucket = w.buckets.get(t.key)!;
      bucket.splice(bucket.indexOf(t.slot), 1);
      w.touchedBuckets.add(t.key);
      if (t.slot.orig !== null) w.promoted.set(bulkId(t.key, t.slot.orig), op.id);
      w.entities.push({ def, orig: null, origId: null });
      w.entitiesTouched = true;
      w.created.push(op.id);
      return;
    }
    case "demote": {
      const rec = resolveEntity(w, op.id);
      const def = rec.def;
      const allowed: Partial<Record<Behavior, string[]>> = {
        solid: ["id", "b", "shape", "material"],
        cloud: ["id", "b", "shape"],
        anchor: ["id", "b", "at"],
      };
      const keys = allowed[def.b];
      if (!keys)
        fail(
          "op-invalid",
          `Only solid, cloud and anchor entities can be demoted; ${def.id} is a ${def.b}.`,
          { entityIds: [def.id] },
        );
      const extra = Object.keys(def).filter((k) => !keys.includes(k));
      if (extra.length > 0) {
        fail(
          "op-invalid",
          `${def.id} has ${extra.join(", ")}, which a bulk entry can't hold; unset ${extra.length === 1 ? "it" : "them"} first.`,
          {
            entityIds: [def.id],
          },
        );
      }
      const refs = referencesTo(w, def.id);
      if (refs.length > 0)
        fail("op-invalid", `${def.id} is still referenced by ${refs.join(", ")}.`, {
          entityIds: [def.id, ...refs],
        });
      const key = (def.b === "solid" && def.material ? `solid:${def.material}` : def.b) as BulkKey;
      w.entities.splice(w.entities.indexOf(rec), 1);
      w.entitiesTouched = true;
      const slot: Slot = { value: clone("at" in def ? def.at : def.shape), orig: null };
      if (rec.origId !== null) slot.demotedFrom = rec.origId;
      w.buckets.get(key)!.push(slot);
      w.touchedBuckets.add(key);
      return;
    }
    case "setSpawn": {
      const index = op.index ?? 0;
      if (index >= w.spawn.length) w.spawn.push(clone(op.at));
      else w.spawn[index] = clone(op.at);
      return;
    }
    case "removeSpawn": {
      if (op.index >= w.spawn.length) {
        fail(
          "ref-not-found",
          `There's no spawn at index ${op.index}; the scene has ${w.spawn.length}.`,
        );
      }
      w.spawn.splice(op.index, 1);
      return;
    }
    case "setScene": {
      if (op.set.name !== undefined) w.name = op.set.name;
      if (op.set.bounds !== undefined) {
        const [minX, minY, maxX, maxY] = op.set.bounds;
        if (minX >= maxX || minY >= maxY)
          fail(
            "op-invalid",
            "bounds must be [minX, minY, maxX, maxY] with min below max on both axes.",
          );
        w.bounds = clone(op.set.bounds);
      }
      return;
    }
    default: {
      const unknown: never = op;
      fail("op-invalid", `Unknown op at index ${i}: ${JSON.stringify(unknown)}`);
    }
  }
}

function checkPt(v: unknown, ref: Ref): Pt {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n))) {
    fail("op-invalid", `${ref}: at must be [x, y] in integer pixels.`, { got: JSON.stringify(v) });
  }
  return [v[0], v[1]];
}

function markTouched(w: Work, t: Target): void {
  if (t.kind === "bulk") w.touchedBuckets.add(t.key);
  else w.entitiesTouched = true;
}

// ─── Inverse ─────────────────────────────────────────────

function entityTranslation(o: EntityDef, c: EntityDef): Pt | null {
  const anchor = (e: EntityDef): Pt | undefined => {
    if (e.b === "mover") return e.path?.pts?.[0];
    if ("at" in e) return e.at;
    return typeof e.shape?.[1] === "number"
      ? [e.shape[1] as number, e.shape[2] as number]
      : undefined;
  };
  const a = anchor(o);
  const b = anchor(c);
  if (!a || !b || o.b !== c.b) return null;
  const d: Pt = [a[0] - b[0], a[1] - b[1]];
  if (d[0] === 0 && d[1] === 0) return null;
  return same(translateEntity(c, d), o) ? d : null;
}

function bulkTranslation(key: BulkKey, o: BulkValue, c: BulkValue): Pt | null {
  const d: Pt =
    key === "anchor"
      ? [(o[0] as number) - (c[0] as number), (o[1] as number) - (c[1] as number)]
      : [(o[1] as number) - (c[1] as number), (o[2] as number) - (c[2] as number)];
  if (d[0] === 0 && d[1] === 0) return null;
  const moved = key === "anchor" ? addPt(c as Pt, d) : translateTuple(c as ShapeTuple, d);
  return same(moved, o) ? d : null;
}

const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const isStructured = (v: unknown) => v !== null && typeof v === "object";

/**
 * Set and unset paths that turn `c` back into `o` with the same key order,
 * or null when only replacing the whole value can restore the order.
 */
function restorePaths(o: Json, c: Json): { set: Json; unset: string[] } | null {
  const out = { set: {} as Json, unset: [] as string[] };
  const walk = (ov: unknown, cv: unknown, prefix: string): boolean => {
    if (same(ov, cv)) return true;
    const join = (k: string | number) => (prefix ? `${prefix}.${k}` : String(k));
    if (isObj(ov) && isObj(cv) && keyOrderRestorable(ov, cv)) {
      for (const k of Object.keys(cv)) if (!(k in ov)) out.unset.push(join(k));
      for (const k of Object.keys(ov)) {
        if (k in cv) walk(ov[k], cv[k], join(k));
        else out.set[join(k)] = clone(ov[k]);
      }
      return true;
    }
    if (
      Array.isArray(ov) &&
      Array.isArray(cv) &&
      ov.length === cv.length &&
      ov.some(isStructured)
    ) {
      ov.forEach((item, k) => walk(item, cv[k], join(k)));
      return true;
    }
    if (!prefix) return false;
    out.set[prefix] = clone(ov);
    return true;
  };
  return walk(o, c, "") ? out : null;
}

/** Unsetting `c`'s extra keys and appending `o`'s missing ones gives `o`'s order. */
function keyOrderRestorable(o: Json, c: Json): boolean {
  const ok = Object.keys(o);
  const restored = [...Object.keys(c).filter((k) => k in o), ...ok.filter((k) => !(k in c))];
  return restored.every((k, i) => k === ok[i]);
}

function buildInverse(start: SceneDefinition, w: Work): SceneOp[] {
  const ops: SceneOp[] = [];

  const sceneSet: { name?: string; bounds?: SceneDefinition["bounds"] } = {};
  if (w.name !== start.name) sceneSet.name = start.name;
  if (!same(w.bounds, start.bounds)) sceneSet.bounds = clone(start.bounds);
  if (Object.keys(sceneSet).length > 0) ops.push({ op: "setScene", set: sceneSet });

  const removeRefs: Ref[] = [];
  const moves = new Map<string, { by: Pt; refs: Ref[] }>();
  const updates: SceneOp[] = [];
  const readds: SceneOp[] = [];
  const addMove = (ref: Ref, by: Pt) => {
    const k = by.join(",");
    const group = moves.get(k) ?? { by, refs: [] };
    group.refs.push(ref);
    moves.set(k, group);
  };

  const startEnts = start.entities ?? [];
  const replaced = new Set<number>();
  const survivors = w.entities.filter((r) => r.orig !== null);
  for (const rec of w.entities) if (rec.orig === null) removeRefs.push(rec.def.id);
  for (const rec of survivors) {
    const original = startEnts[rec.orig!]!;
    const current = clone(rec.def);
    current.id = original.id;
    if (same(original, current)) continue;
    const d = entityTranslation(original, current);
    if (d) {
      addMove(original.id, d);
      continue;
    }
    const restore = restorePaths(original as unknown as Json, current as unknown as Json);
    if (!restore) {
      replaced.add(rec.orig!);
      removeRefs.push(rec.def.id);
      continue;
    }
    const op: SceneOp = { op: "update", ref: original.id };
    if (Object.keys(restore.set).length > 0) op.set = restore.set;
    if (restore.unset.length > 0) op.unset = restore.unset;
    updates.push(op);
  }

  const renames = survivors.filter((r) => !replaced.has(r.orig!) && r.def.id !== r.origId);
  const renameOps: SceneOp[] = [];
  if (renames.length > 0) {
    const held = new Set(survivors.filter((r) => !replaced.has(r.orig!)).map((r) => r.def.id));
    if (renames.every((r) => !held.has(r.origId!))) {
      for (const r of renames) renameOps.push({ op: "rename", from: r.def.id, to: r.origId! });
    } else {
      const taken = new Set([...held, ...startEnts.map((e) => e.id)]);
      let n = 1;
      const temps = renames.map(() => {
        while (taken.has(`tmp-${n}`)) n++;
        taken.add(`tmp-${n}`);
        return `tmp-${n}`;
      });
      renames.forEach((r, k) => renameOps.push({ op: "rename", from: r.def.id, to: temps[k]! }));
      renames.forEach((r, k) => renameOps.push({ op: "rename", from: temps[k]!, to: r.origId! }));
    }
  }

  const surviving = new Set(survivors.filter((r) => !replaced.has(r.orig!)).map((r) => r.orig!));
  startEnts.forEach((e, i) => {
    if (!surviving.has(i))
      readds.push({ op: "add", entity: clone(e) as unknown as EntityInput, index: i });
  });

  for (const key of BULK_KEYS) {
    if (!w.touchedBuckets.has(key)) continue;
    const original = bucketValues(start, key);
    const slots = w.buckets.get(key)!;
    const field = key === "anchor" ? "at" : "shape";
    slots.forEach((s, i) => {
      const ref = bulkId(key, i);
      if (s.orig === null) {
        removeRefs.push(ref);
        return;
      }
      const o = original[s.orig]!;
      if (same(o, s.value)) return;
      const d = bulkTranslation(key, o, s.value);
      if (d) addMove(ref, d);
      else updates.push({ op: "update", ref, set: { [field]: clone(o) } });
    });
    const kept = new Set(slots.filter((s) => s.orig !== null).map((s) => s.orig!));
    let run: { index: number; values: BulkValue[] } | null = null;
    const flush = () => {
      if (!run) return;
      readds.push(
        key === "anchor"
          ? { op: "addBulk", key, points: run.values as Pt[], index: run.index }
          : {
              op: "addBulk",
              key: key as ShapeBulkKey,
              shapes: run.values as ShapeTuple[],
              index: run.index,
            },
      );
      run = null;
    };
    original.forEach((v, i) => {
      if (kept.has(i)) {
        flush();
        return;
      }
      if (run) run.values.push(clone(v));
      else run = { index: i, values: [clone(v)] };
    });
    flush();
  }

  if (removeRefs.length > 0) ops.push({ op: "remove", refs: removeRefs });
  ops.push(...renameOps);
  for (const { by, refs } of moves.values()) ops.push({ op: "move", refs, by });
  ops.push(...updates, ...readds);

  const o = start.spawn;
  const f = w.spawn;
  for (let i = 0; i < Math.min(o.length, f.length); i++) {
    if (!same(o[i], f[i])) ops.push({ op: "setSpawn", index: i, at: clone(o[i]!) });
  }
  for (let i = f.length; i < o.length; i++)
    ops.push({ op: "setSpawn", index: i, at: clone(o[i]!) });
  for (let i = f.length - 1; i >= o.length; i--) ops.push({ op: "removeSpawn", index: i });

  return ops;
}

/**
 * Where each start-of-batch ref ended up when it changed: a bulk entry whose
 * index shifted, was promoted, or an entity renamed or demoted. `null` when
 * it was removed.
 */
function refRemap(start: SceneDefinition, w: Work): Record<Ref, Ref | null> {
  const out: Record<Ref, Ref | null> = {};
  for (const key of w.touchedBuckets) {
    const finalIndex = new Map<number, number>();
    w.buckets.get(key)!.forEach((s, i) => {
      if (s.orig !== null) finalIndex.set(s.orig, i);
      if (s.demotedFrom !== undefined) out[s.demotedFrom] = bulkId(key, i);
    });
    const startLen = bucketValues(start, key).length;
    for (let i = 0; i < startLen; i++) {
      const from = bulkId(key, i);
      const j = finalIndex.get(i);
      if (j === undefined) out[from] = w.promoted.get(from) ?? null;
      else if (j !== i) out[from] = bulkId(key, j);
    }
  }
  if (w.entitiesTouched) {
    const surviving = new Map<string, string>();
    for (const rec of w.entities) if (rec.origId !== null) surviving.set(rec.origId, rec.def.id);
    for (const e of start.entities ?? []) {
      const to = surviving.get(e.id);
      if (to === undefined) {
        if (!(e.id in out)) out[e.id] = null;
      } else if (to !== e.id) out[e.id] = to;
    }
  }
  return out;
}

function touchedRefs(start: SceneDefinition, w: Work): Ref[] {
  const out: Ref[] = [];
  const startEnts = start.entities ?? [];
  for (const rec of w.entities) {
    if (rec.orig === null || !same(rec.def, startEnts[rec.orig])) out.push(rec.def.id);
  }
  for (const key of w.touchedBuckets) {
    const original = bucketValues(start, key);
    w.buckets.get(key)!.forEach((s, i) => {
      if (s.orig === null || !same(s.value, original[s.orig])) out.push(bulkId(key, i));
    });
  }
  return out;
}

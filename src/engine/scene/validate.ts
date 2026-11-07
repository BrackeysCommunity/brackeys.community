import { z } from "zod";

import type { RegisteredType, Registry } from "../game/types";
import { bulkId } from "./expand";
import { comparePointers } from "./format";
import { sceneHash } from "./hash";
import { jsonPointer, lineAt, makeIssue } from "./issues";
import {
  childEntity,
  issueOnSource,
  localChild,
  mapResolvedBatch,
  NO_CHILD_EDITS,
  resolveSceneDetailed,
  splitOverridePath,
} from "./resolve";
import { entitySchemaFor, geometryFields, sceneRegistry, unknownGameIssue } from "./schema";
import { aabb, aabbUnion, convexHull, isConvex, translateShape } from "./shape-geometry";
import { parseShape } from "./shapes";
import type {
  Aabb,
  EntityDef,
  IssueCode,
  OpBatch,
  PathDef,
  PrefabLibrary,
  Pt,
  Ref,
  SceneDefinition,
  SceneIssue,
  SceneOp,
  ShapeObj,
  ShapeTuple,
} from "./types";

export type ValidateOptions = {
  lines?: ReadonlyMap<string, number>;
  /** The prefabs the scene's instances name; an instance whose prefab isn't here is `prefab-unknown`. */
  prefabs?: PrefabLibrary;
};

type Located<T> = { field: string; pointer: string; value: T };

/** One bulk entry or entity, with its geometry fields read through its type's schema. */
type Item = {
  ref: Ref;
  pointer: string;
  type: RegisteredType;
  shapes: (Located<ShapeTuple> & { schema: z.core.$ZodType })[];
  points: Located<Pt>[];
  paths: Located<PathDef>[];
};

function items(def: SceneDefinition, registry: Registry): Item[] {
  const list: Item[] = [];
  for (const b of registry.bulkKeys) {
    const rows = def[b.key];
    if (!Array.isArray(rows)) continue;
    const type = registry.types.get(b.type)!;
    rows.forEach((value, i) => {
      const pointer = jsonPointer([b.key, i]);
      const at = { field: b.field, pointer, value };
      const schema = type.shape[b.field];
      list.push({
        ref: bulkId(b.key, i),
        pointer,
        type,
        shapes: b.form === "shape" && schema ? [{ ...at, schema }] : [],
        points: b.form === "point" ? [at] : [],
        paths: [],
      });
    });
  }
  (def.entities ?? []).forEach((e, i) => {
    const type = registry.types.get(e.type);
    if (!type) return;
    const pointer = jsonPointer(["entities", i]);
    const item: Item = { ref: e.id, pointer, type, shapes: [], points: [], paths: [] };
    for (const { field, kind } of geometryFields(type)) {
      const value = e[field];
      if (value === undefined) continue;
      const at = { field, pointer: `${pointer}${jsonPointer([field])}`, value };
      if (kind === "shape") {
        const schema = type.shape[field];
        if (schema) item.shapes.push({ ...(at as Located<ShapeTuple>), schema });
      } else if (kind === "point") item.points.push(at as Located<Pt>);
      else item.paths.push(at as Located<PathDef>);
    }
    list.push(item);
  });
  return list;
}

const isInt = (n: number) => Number.isInteger(n);
const SEVERITY_RANK = { error: 0, warn: 1, info: 2 } as const;

const samePt = (a: Pt | undefined, b: Pt | undefined) =>
  a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];

function dedupe(pts: readonly Pt[], closed: boolean): Pt[] {
  const out = pts.filter((p, i) => i === 0 || !samePt(p, pts[i - 1]));
  while (closed && out.length > 1 && samePt(out[0], out[out.length - 1])) out.pop();
  return out;
}

function firstRepeat(pts: readonly Pt[], closed: boolean): number {
  for (let i = 1; i < pts.length; i++) if (samePt(pts[i], pts[i - 1])) return i;
  if (closed && pts.length > 1 && samePt(pts[pts.length - 1], pts[0])) return pts.length - 1;
  return -1;
}

function roundTuple(t: ShapeTuple): ShapeTuple {
  const [tag, ...nums] = t;
  const positive =
    tag === "box" ? [2, 3] : tag === "circle" ? [2] : tag === "capsule" ? [2, 3] : [];
  return [
    tag,
    ...nums.map((n, i) => (positive.includes(i) ? Math.max(1, Math.round(n)) : Math.round(n))),
  ] as ShapeTuple;
}

const roundPt = ([x, y]: Pt): Pt => [Math.round(x), Math.round(y)];

function center(b: Aabb): Pt {
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

const pointBox = ([x, y]: Pt): Aabb => ({ minX: x, minY: y, maxX: x, maxY: y });

/** An item's extent: its shapes and points, carried along each path when it has one. */
function extent(
  shapes: readonly ShapeObj[],
  points: readonly Pt[],
  paths: readonly PathDef[],
): Aabb | undefined {
  let box: Aabb | undefined;
  const add = (b: Aabb) => (box = box ? aabbUnion(box, b) : b);
  for (const p of points) add(pointBox(p));
  if (paths.length === 0) for (const s of shapes) add(aabb(s));
  for (const path of paths) {
    for (const p of path.pts) {
      if (shapes.length === 0) add(pointBox(p));
      for (const s of shapes) add(aabb(translateShape(s, p)));
    }
  }
  return box;
}

/**
 * Structural checks over a parsed scene, judged by the registry its `game`
 * picks (`sceneRegistry`). On the document itself: ids (entities and
 * instances share them), groups, instances and their overrides. On its
 * resolved view (`resolveScene`, so instance children and group members
 * are checked where they land): references (each type's `refs`) and the
 * geometry of every registered shape, point and path field (polys, chains,
 * paths, integer pixels, bounds), then the game's `registry.validators`. No
 * physics. Each issue names the entity (bulk entries by their `~key:index`
 * reference, instance children as `<instance>/<child>`, pointing at the
 * instance) and carries a `fix` batch when one is mechanical; fixes are
 * written against the document, and those that use a `~` reference carry
 * `base`. Errors come first, then warnings, then info; within a severity,
 * engine and game issues merge in document order of their `path`
 * (`comparePointers`).
 */
export function validateScene(
  source: SceneDefinition,
  registry: Registry,
  opts: ValidateOptions = {},
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const withLine = (issue: SceneIssue): SceneIssue => {
    if (!opts.lines || issue.path === undefined || issue.line !== undefined) return issue;
    const line = lineAt(opts.lines, issue.path);
    return line === undefined ? issue : { ...issue, line };
  };
  const r = sceneRegistry(source.game, registry);
  if (!r) return [withLine(unknownGameIssue(source.game!, registry))];

  let hash: string | undefined;
  const base = () => (hash ??= sceneHash(source));
  const batch = (label: string, ops: SceneOp[], refs: Ref[]): OpBatch =>
    refs.some((ref) => ref.startsWith("~")) ? { label, base: base(), ops } : { label, ops };

  validateSource(source, r, opts.prefabs, (code, fields) =>
    issues.push(withLine(makeIssue(code, fields))),
  );

  const resolved = resolveSceneDetailed(source, r, opts.prefabs);
  const def = resolved.def;
  const toSource = issueOnSource(source, resolved.origins, (fix) =>
    mapResolvedBatch(source, fix, r, opts.prefabs, NO_CHILD_EDITS),
  );
  const push = (code: IssueCode, fields: Partial<SceneIssue> & { message: string }) =>
    issues.push(withLine(toSource(makeIssue(code, fields))));

  const entities = def.entities ?? [];
  const [minX, minY, maxX, maxY] = def.bounds;

  // references
  const targetable = (targets: readonly string[], hit: EntityDef) => {
    const base = r.types.get(hit.type)?.base;
    return targets.includes(hit.type) || (base !== undefined && targets.includes(base));
  };
  entities.forEach((e, i) => {
    for (const { field, targets } of r.types.get(e.type)?.refs ?? []) {
      const value = e[field];
      const refs = Array.isArray(value) ? value : value === undefined ? [] : [value];
      refs.forEach((target, k) => {
        const path = jsonPointer(
          Array.isArray(value) ? ["entities", i, field, k] : ["entities", i, field],
        );
        const hit = entities.find((t) => t.id === target);
        const remove: SceneOp = Array.isArray(value)
          ? { op: "update", ref: e.id, set: { [field]: value.filter((_, j) => j !== k) } }
          : { op: "update", ref: e.id, unset: [field] };
        if (!hit) {
          push("dangling-ref", {
            message: `${e.id}.${field} names "${String(target)}", which doesn't exist`,
            path,
            entityIds: [e.id],
            fix: batch(`Remove ${e.id}.${field} reference`, [remove], [e.id]),
          });
        } else if (!targetable(targets, hit)) {
          push("ref-type", {
            message: `${e.id}.${field} targets ${hit.id}, a ${hit.type}; it can target ${targets.join(" or ")}`,
            path,
            entityIds: [e.id, hit.id],
            expected: targets.join(" | "),
            got: hit.type,
            fix: batch(`Remove ${e.id}.${field} reference`, [remove], [e.id]),
          });
        }
      });
    }
  });

  // geometry
  for (const item of items(def, r)) {
    const { ref, pointer, type } = item;
    const parsed: ShapeObj[] = [];

    for (const { field, pointer: at, value, schema } of item.shapes) {
      const shape = parseShape(value);
      if (!shape.ok) continue;
      const obj = shape.shape;
      parsed.push(obj);

      if (obj.type === "poly" && obj.pts[0] && !isConvex(obj.pts)) {
        const chain: ShapeTuple = ["chain", ...obj.pts.flat(), ...obj.pts[0]];
        const canChain = z.safeParse(schema, chain).success;
        const hull = convexHull(obj.pts);
        const hullTuple: ShapeTuple | undefined =
          hull.length >= 3 ? ["poly", ...hull.flat()] : undefined;
        const fixWith = canChain ? chain : hullTuple;
        push("poly-invalid", {
          message: `${ref}'s poly isn't a simple convex polygon (non-convex, self-intersecting or zero area)`,
          path: at,
          entityIds: [ref],
          at: center(aabb(obj)),
          hint: canChain
            ? "Convert it to a chain of the same outline, or split it into convex polys."
            : hullTuple
              ? `Split it into convex polys, or take its convex hull; ${type.type}'s ${field} can't be a chain.`
              : `Its points lie on one line; give it area, or remove it. ${type.type}'s ${field} can't be a chain.`,
          fix: fixWith
            ? batch(
                canChain ? `Convert ${ref} to a chain` : `Replace ${ref} with its convex hull`,
                [{ op: "update", ref, set: { [field]: fixWith } }],
                [ref],
              )
            : undefined,
        });
      }

      if (obj.type === "chain") {
        const k = firstRepeat(obj.pts, false);
        const repeated = obj.pts[k];
        if (repeated) {
          const pts = dedupe(obj.pts, false);
          push("chain-invalid", {
            message: `${ref}'s chain repeats point ${k} at [${repeated[0]}, ${repeated[1]}], a zero-length segment`,
            path: at,
            entityIds: [ref],
            at: [repeated[0], repeated[1]],
            fix:
              pts.length >= 2
                ? batch(
                    `Drop the repeated point in ${ref}`,
                    [{ op: "update", ref, set: { [field]: ["chain", ...pts.flat()] } }],
                    [ref],
                  )
                : undefined,
          });
        }
      }
    }

    for (const { field, pointer: at, value: path } of item.paths) {
      if (path.pts.length < 2 || !(path.speed > 0)) {
        const few = path.pts.length < 2;
        push("path-invalid", {
          message: few
            ? `${ref}'s ${field} has ${path.pts.length} point${path.pts.length === 1 ? "" : "s"}; it needs at least 2`
            : `${ref}'s ${field} speed is ${path.speed}; it must be > 0 px/s`,
          path: few ? `${at}/pts` : `${at}/speed`,
          entityIds: [ref],
          expected: few ? ">= 2 points" : "> 0",
          got: few ? String(path.pts.length) : String(path.speed),
        });
      }
      const closed = path.mode === "loop";
      const k = firstRepeat(path.pts, closed);
      const repeated = path.pts[k];
      if (repeated) {
        const pts = dedupe(path.pts, closed);
        push("path-degenerate", {
          message: `${ref}'s ${field} repeats [${repeated[0]}, ${repeated[1]}] at point ${k}; the runtime skips it`,
          path: `${at}/pts/${k}`,
          entityIds: [ref],
          at: [repeated[0], repeated[1]],
          fix:
            pts.length >= 2
              ? batch(
                  `Drop the repeated point in ${ref}'s ${field}`,
                  [{ op: "update", ref, set: { [`${field}.pts`]: pts } }],
                  [ref],
                )
              : undefined,
        });
      }
    }

    // integer pixels
    const set: Record<string, unknown> = {};
    let firstBad: string | undefined;
    const flag = (field: string, bad: string, value: unknown) => {
      firstBad ??= bad;
      set[field] = value;
    };
    for (const { field, pointer: at, value } of item.shapes) {
      const k = value.findIndex((n, i) => i > 0 && typeof n === "number" && !isInt(n));
      if (k > 0) flag(field, `${at}/${k}`, roundTuple(value));
    }
    for (const { field, pointer: at, value } of item.points) {
      if (!(isInt(value[0]) && isInt(value[1])))
        flag(field, `${at}/${isInt(value[0]) ? 1 : 0}`, roundPt(value));
    }
    for (const { field, pointer: at, value } of item.paths) {
      const k = value.pts.findIndex((p) => !(isInt(p[0]) && isInt(p[1])));
      if (k >= 0) flag(`${field}.pts`, `${at}/pts/${k}`, value.pts.map(roundPt));
    }
    if (firstBad !== undefined) {
      push("non-integer", {
        message: `${ref} has a coordinate that isn't a whole pixel (${Object.keys(set).join(", ")})`,
        path: firstBad,
        entityIds: [ref],
        fix: batch(`Round ${ref} to whole pixels`, [{ op: "update", ref, set }], [ref]),
      });
    }

    // bounds
    if (type.loads === false) continue;
    const box = extent(
      parsed,
      item.points.map((p) => p.value),
      item.paths.map((p) => p.value),
    );
    if (box && (box.minX < minX || box.minY < minY || box.maxX > maxX || box.maxY > maxY)) {
      const grown = aabbUnion({ minX, minY, maxX, maxY }, box);
      push("out-of-bounds", {
        message: `${ref} reaches outside the scene bounds [${minX}, ${minY}, ${maxX}, ${maxY}]`,
        path: pointer,
        entityIds: [ref],
        at: center(box),
        fix: batch(
          `Grow bounds to fit ${ref}`,
          [
            {
              op: "setScene",
              set: {
                bounds: [
                  Math.floor(grown.minX),
                  Math.floor(grown.minY),
                  Math.ceil(grown.maxX),
                  Math.ceil(grown.maxY),
                ],
              },
            },
          ],
          [],
        ),
      });
    }
  }

  for (const validator of r.validators) {
    for (const issue of validator(def, { registry: r, lines: opts.lines })) {
      issues.push(withLine(toSource(issue)));
    }
  }

  return issues
    .map((issue, i) => ({ issue, i }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] ||
        comparePointers(a.issue.path, b.issue.path) ||
        a.i - b.i,
    )
    .map(({ issue }) => issue);
}

type Push = (code: IssueCode, fields: Partial<SceneIssue> & { message: string }) => void;

const RESERVED_OVERRIDE_FIELDS = ["id", "type", "group"];

/** Checks on the document itself: ids, groups, instances and overrides. */
function validateSource(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  push: Push,
): void {
  const entities = def.entities ?? [];
  const instances = def.instances ?? [];

  // ids: entities and instances share them
  const owners = [
    ...entities.map((e, i) => ({ id: e.id, path: jsonPointer(["entities", i, "id"]) })),
    ...instances.map((e, i) => ({ id: e.id, path: jsonPointer(["instances", i, "id"]) })),
  ];
  const ids = new Set(owners.map((o) => o.id));
  const seen = new Set<string>();
  for (const { id, path } of owners) {
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    let n = 2;
    while (ids.has(`${id}-${n}`)) n++;
    push("dup-id", {
      message: `two entities have the id "${id}"`,
      path,
      entityIds: [id],
      hint: `Give the later "${id}" a new id, e.g. "${id}-${n}".`,
    });
  }

  // groups
  const declared = new Set(Object.keys(def.groups ?? {}));
  const members: { id: string; group: string; path: string }[] = [
    ...entities.flatMap((e, i) =>
      typeof e.group === "string"
        ? [{ id: e.id, group: e.group, path: jsonPointer(["entities", i, "group"]) }]
        : [],
    ),
    ...instances.flatMap((e, i) =>
      typeof e.group === "string"
        ? [{ id: e.id, group: e.group, path: jsonPointer(["instances", i, "group"]) }]
        : [],
    ),
  ];
  for (const { id, group, path } of members) {
    if (declared.has(group)) continue;
    push("dangling-ref", {
      message: `${id}.group names "${group}", which isn't declared in groups`,
      path,
      entityIds: [id],
      hint: `Declare it: { "op": "setGroup", "id": "${group}", "at": [0, 0] }.`,
      fix: {
        label: `Declare group ${group}`,
        ops: [{ op: "setGroup", id: group, at: [0, 0] }],
      },
    });
  }

  // instances and overrides
  instances.forEach((inst, i) => {
    const prefab = prefabs?.get(inst.prefab);
    if (!prefab) {
      const known = [...(prefabs?.keys() ?? [])];
      push("prefab-unknown", {
        message: `${inst.id} places prefab "${inst.prefab}", which ${known.length > 0 ? `isn't one of ${known.join(", ")}` : "doesn't exist"}`,
        path: jsonPointer(["instances", i, "prefab"]),
        entityIds: [inst.id],
        got: inst.prefab,
        ...(known.length > 0 ? { expected: known.join(" | ") } : {}),
      });
      return;
    }
    const unused = (path: string, why: string) =>
      push("unused-override", {
        message: `${inst.id}'s override "${path}" ${why}`,
        path: jsonPointer(["instances", i, "overrides", path]),
        entityIds: [inst.id],
        fix: {
          label: `Drop ${inst.id}'s override ${path}`,
          ops: [{ op: "revertOverride", ref: inst.id, paths: [path] }],
        },
      });
    const children = new Set<string>();
    for (const path of Object.keys(inst.overrides ?? {})) {
      const split = splitOverridePath(path);
      if (!split) continue;
      const child = localChild(prefab, { ...inst, overrides: {} }, split.child, registry);
      if (!child) {
        unused(path, `names no child of prefab "${inst.prefab}"`);
        continue;
      }
      const top = split.field.split(".")[0]!;
      const type = registry.types.get(
        child.kind === "entity" ? child.def.type : (registry.bulkKey(child.key)?.type ?? ""),
      );
      const fields: (string | undefined)[] =
        child.kind === "bulk"
          ? [registry.bulkKey(child.key)?.field]
          : [...Object.keys(type?.shape ?? {}), "name", "layer", "off"];
      if (RESERVED_OVERRIDE_FIELDS.includes(top) || !fields.includes(top)) {
        unused(path, `names no field "${top}" ${split.child} can have`);
        continue;
      }
      children.add(split.child);
    }
    for (const ref of children) {
      const child = localChild(prefab, inst, ref, registry);
      const entity = child && childEntity(child, registry);
      const schema = entity && entitySchemaFor(registry, entity.type);
      const result = schema?.safeParse({ ...entity, id: "child" });
      if (!result || result.success) continue;
      const first = result.error.issues[0]!;
      push("schema", {
        message: `${inst.id}'s overrides leave ${ref} invalid: ${first.path.join(".") || "entity"}: ${first.message}`,
        path: jsonPointer(["instances", i, "overrides"]),
        entityIds: [inst.id],
      });
    }
  });
}

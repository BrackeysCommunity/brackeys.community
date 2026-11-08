import { z } from "zod";

import { BEHAVIOR_NAME_PATTERN, BEHAVIORS_FIELD, type BehaviorName } from "../game/behaviors";
import type { RegisteredType, Registry } from "../game/types";
import { schemaRefSites, type RefSite } from "../project/refs";
import type { AssetKindName, ProjectView } from "../project/types";
import { closest } from "./did-you-mean";
import { bulkId } from "./expand";
import { isInstanceOverrideField } from "./field-path";
import { comparePointers } from "./format";
import { sceneHash } from "./hash";
import { jsonPointer, lineAt, makeIssue, pointerSegments } from "./issues";
import { prefabsUsedBy } from "./prefab";
import {
  CHILD_SEPARATOR,
  childEntity,
  issueOnSource,
  localChild,
  localChildren,
  mapResolvedBatch,
  NO_CHILD_EDITS,
  parseChildRef,
  resolvePrefab,
  resolveScene,
  resolveSceneDetailed,
  splitOverridePath,
} from "./resolve";
import {
  entitySchemaFor,
  fieldKind,
  geometryFields,
  sceneRegistry,
  unknownGameIssue,
} from "./schema";
import { aabb, aabbUnion, convexHull, isConvex, translateShape } from "./shape-geometry";
import { parseShape } from "./shapes";
import { composeDihedral, type Dihedral } from "./transform";
import {
  PREFAB_KIND,
  SCENE_FORMAT_VERSION,
  type Aabb,
  type EntityDef,
  type InstanceDef,
  type IssueCode,
  type OpBatch,
  type PathDef,
  type Prefab,
  type PrefabLibrary,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type ShapeObj,
  type ShapeTuple,
} from "./types";

export type ValidateOptions = {
  lines?: ReadonlyMap<string, number>;
  /**
   * The prefabs the scene's instances name. An instance whose prefab, or a
   * prefab nested in it, isn't here is `prefab-unknown`; one whose prefab
   * reaches itself is `prefab-cycle`; nesting past `PREFAB_MAX_DEPTH` is
   * `prefab-depth`.
   */
  prefabs?: PrefabLibrary;
  /**
   * The prefab this scene is a view of (`prefabScene`, a prefab doc's
   * `readDoc`). The view counts as one level of nesting, an instance that
   * reaches it is `prefab-cycle`, and its variant base is checked too.
   */
  prefab?: string;
  /**
   * The project the scene belongs to. With it, an asset id (asset fields of
   * types, behaviors and settings, and the `assets` header) that isn't live
   * is `asset-missing` and one of the wrong kind `asset-kind`; without it,
   * asset ids aren't checked.
   */
  project?: ProjectView;
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
      if (!geometryShaped(kind, value)) continue;
      const at = { field, pointer: `${pointer}${jsonPointer([field])}`, value };
      if (kind === "shape") {
        const schema = type.shape[field];
        if (schema) item.shapes.push({ ...(at as Located<ShapeTuple>), schema });
      } else if (kind === "point") item.points.push(at as Located<Pt>);
      else if (kind === "path") item.paths.push(at as Located<PathDef>);
    }
    list.push(item);
  });
  return list;
}

/**
 * Whether a geometry field's value has its kind's shape, so the geometry
 * checks can read it; an override or param can set anything, which the
 * schema check reports instead.
 */
function geometryShaped(kind: string, value: unknown): boolean {
  if (kind === "shape") return Array.isArray(value);
  if (kind === "point")
    return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";
  if (kind === "path")
    return (
      isRecord(value) &&
      Array.isArray(value.pts) &&
      value.pts.every((p) => Array.isArray(p) && p.length >= 2)
    );
  return value !== undefined;
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
 * instances share them), layers, `settings.grid`, the `assets` header,
 * groups, instances (their prefabs resolved through nesting and variant
 * bases by `resolvePrefab`, every variant's base known and sharing no
 * child id with it), their params (each one the prefab exposes) and
 * overrides (never of a grid field), a prefab view's params (each target
 * naming a child), and grids
 * under a turned or flipped instance or group (square cells only). On its resolved view
 * (`resolveScene`, so instance children and group members are checked
 * where they land): references (each type's `refs`; a child ref
 * `<instance>/<child>` is `ref-child-unknown` when the instance's prefab
 * lacks the child), behavior blocks
 * (registered, allowed by the type, their `requires` carried, their fields
 * valid), grid fields (only with `settings.grid`), asset ids when
 * `opts.project` is given, and the
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

  validateSource(source, r, opts.prefabs, opts.prefab, (code, fields) =>
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

  // references; a child ref's first segment is one of the document's instances
  const childRefTarget = (target: string): InstanceDef | "unresolved" | undefined => {
    const split = parseChildRef(target);
    const inst = split && source.instances?.find((n) => n.id === split.instance);
    if (!inst) return undefined;
    const prefabs = opts.prefabs;
    const resolves =
      inst.prefab !== opts.prefab &&
      prefabs?.has(inst.prefab) === true &&
      resolvePrefab(inst.prefab, prefabs, r).ok;
    return resolves ? inst : "unresolved";
  };
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
        const child = hit || typeof target !== "string" ? undefined : childRefTarget(target);
        if (child === "unresolved") return;
        if (child) {
          const candidates = entities.filter(
            (t) => t.id.startsWith(`${child.id}/`) && targetable(targets, t),
          );
          const guess = closest(
            target as string,
            candidates.map((t) => t.id),
          );
          const replace: SceneOp = Array.isArray(value)
            ? {
                op: "update",
                ref: e.id,
                set: { [field]: value.map((v, j) => (j === k ? guess : v)) },
              }
            : { op: "update", ref: e.id, set: { [field]: guess } };
          push("ref-child-unknown", {
            message: `${e.id}.${field} names "${String(target)}", but prefab "${child.prefab}" of ${child.id} has no such child${guess ? `; did you mean "${guess}"?` : ""}`,
            path,
            entityIds: [e.id],
            got: String(target),
            ...(candidates.length > 0 ? { expected: candidates.map((t) => t.id).join(" | ") } : {}),
            fix: guess
              ? batch(`Point ${e.id}.${field} at ${guess}`, [replace], [e.id])
              : batch(`Remove ${e.id}.${field} reference`, [remove], [e.id]),
          });
        } else if (!hit) {
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

  // behaviors
  entities.forEach((e, i) => {
    const type = r.types.get(e.type);
    if (type) checkBehaviors(r, type, e, jsonPointer(["entities", i]), push, batch);
  });

  // grid fields need the scene's grid to size their cells
  if (!isRecord(source.settings?.grid)) {
    entities.forEach((e, i) => {
      for (const field of gridFields(r, e.type)) {
        if (e[field] === undefined) continue;
        push("grid-invalid", {
          message: `${e.id}.${field} is a grid field, but the scene has no settings.grid to size its cells`,
          path: jsonPointer(["entities", i, field]),
          entityIds: [e.id],
          hint: 'Give the scene a grid with setSettings (e.g. { "grid": { "kind": "square", "cell": [32, 32] } }), or unset the field.',
        });
      }
    });
  }

  // assets
  const project = opts.project;
  if (project) {
    const check = (sites: readonly RefSite[], owner: string, entityIds: string[]) => {
      for (const site of sites) {
        const issue = assetIssue(project, site, owner, entityIds);
        if (!issue) continue;
        const { code, ...fields } = issue;
        push(code, fields);
      }
    };
    entities.forEach((e, i) => {
      const type = r.types.get(e.type);
      if (type) check(entityAssetSites(r, type, e, jsonPointer(["entities", i])), e.id, [e.id]);
    });
    check(schemaRefSites(r.settings, source.settings ?? {}, "/settings"), "", []);
    check(
      (source.assets ?? []).map((id, k) => ({
        pointer: jsonPointer(["assets", k]),
        id,
        kinds: [],
      })),
      "",
      [],
    );
  }

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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The asset ids an entity names: its type's fields and its registered behaviors' blocks. */
function entityAssetSites(
  registry: Registry,
  type: RegisteredType,
  entity: EntityDef,
  at: string,
): RefSite[] {
  const sites = new Map<string, RefSite>();
  for (const site of schemaRefSites(type.shape, entity, at)) sites.set(site.pointer, site);
  const blocks = entity[BEHAVIORS_FIELD];
  if (isRecord(blocks)) {
    for (const [name, block] of Object.entries(blocks)) {
      const behavior = registry.behaviors.get(name);
      if (!behavior) continue;
      const pointer = `${at}${jsonPointer([BEHAVIORS_FIELD, name])}`;
      for (const site of schemaRefSites(behavior.shape, block, pointer))
        sites.set(site.pointer, site);
    }
  }
  return [...sites.values()];
}

/** A type's grid fields, in declaration order; none for an unregistered type. */
function gridFields(registry: Registry, type: string): string[] {
  const t = registry.types.get(type);
  return t ? geometryFields(t).flatMap((f) => (f.kind === "grid" ? [f.field] : [])) : [];
}

const showValue = (v: unknown): string => (v === undefined ? "missing" : JSON.stringify(v));

type MakeBatch = (label: string, ops: SceneOp[], refs: Ref[]) => OpBatch;

/**
 * An entity's behavior blocks against the registry and its type's rules:
 * `behavior-unknown`, `behavior-forbidden`, `behavior-missing` (a carried
 * behavior's `requires`, counting the type's required blocks), and `schema`
 * for a block's fields once the type's defaults are under them.
 */
function checkBehaviors(
  registry: Registry,
  type: RegisteredType,
  e: EntityDef,
  at: string,
  push: Push,
  batch: MakeBatch,
): void {
  const raw = e[BEHAVIORS_FIELD];
  const blocks = isRecord(raw) ? raw : {};
  const loads = type.loads !== false;
  const rules = registry.behaviorRules(type.type);
  const allowed = new Set<BehaviorName>(loads ? rules.allowed : []);
  const pointer = (name: string, ...rest: (string | number)[]) =>
    `${at}${jsonPointer([BEHAVIORS_FIELD, name, ...rest])}`;
  const unset = (name: string): OpBatch => {
    let op: SceneOp;
    if (BEHAVIOR_NAME_PATTERN.test(name)) {
      op = { op: "update", ref: e.id, unset: [`${BEHAVIORS_FIELD}.${name}`] };
    } else {
      const rest = Object.fromEntries(Object.entries(blocks).filter(([k]) => k !== name));
      op =
        Object.keys(rest).length === 0
          ? { op: "update", ref: e.id, unset: [BEHAVIORS_FIELD] }
          : { op: "update", ref: e.id, set: { [BEHAVIORS_FIELD]: rest } };
    }
    return batch(`Unset ${e.id}'s ${name} block`, [op], [e.id]);
  };

  for (const name of Object.keys(blocks)) {
    if (!registry.behaviors.has(name)) {
      const candidates = loads
        ? [...allowed].filter((n) => !(n in blocks))
        : registry.behaviorNames.filter((n) => !(n in blocks));
      const guess = closest(name, candidates);
      push("behavior-unknown", {
        message: `${e.id} carries behavior "${name}", which isn't registered${guess ? `; did you mean "${guess}"?` : ""}`,
        path: pointer(name),
        entityIds: [e.id],
        got: name,
        ...(registry.behaviorNames.length > 0
          ? { expected: registry.behaviorNames.join(" | ") }
          : {}),
        fix: unset(name),
      });
    } else if (!allowed.has(name)) {
      push("behavior-forbidden", {
        message: loads
          ? `${e.id} is a ${type.type}, which doesn't allow behavior "${name}"`
          : `${e.id} is a ${type.type}, which never loads, so it carries no behaviors`,
        path: pointer(name),
        entityIds: [e.id],
        got: name,
        ...(allowed.size > 0 ? { expected: [...allowed].join(" | ") } : {}),
        fix: unset(name),
      });
    }
  }

  const carried = new Set<BehaviorName>(loads ? rules.required.keys() : []);
  for (const name of Object.keys(blocks))
    if (registry.behaviors.has(name) && allowed.has(name)) carried.add(name);
  const order = registry.behaviorNames.filter((n) => carried.has(n));

  for (const name of order) {
    const behavior = registry.behaviors.get(name)!;
    for (const need of behavior.requires ?? []) {
      if (carried.has(need)) continue;
      const addable = allowed.has(need) && registry.behaviors.has(need);
      push("behavior-missing", {
        message: `${e.id}'s behavior "${name}" requires "${need}", which ${e.id} doesn't carry${addable ? "" : ` and its type ${type.type} doesn't allow`}`,
        path: pointer(name),
        entityIds: [e.id],
        expected: need,
        fix: addable
          ? batch(
              `Add ${need} to ${e.id}`,
              [{ op: "update", ref: e.id, set: { [`${BEHAVIORS_FIELD}.${need}`]: {} } }],
              [e.id],
            )
          : undefined,
      });
    }
  }

  for (const name of order) {
    const behavior = registry.behaviors.get(name)!;
    const block = blocks[name];
    if (block !== undefined && !isRecord(block)) {
      push("schema", {
        message: `${e.id}.${BEHAVIORS_FIELD}.${name} must be an object of the behavior's fields; got ${showValue(block)}`,
        path: pointer(name),
        entityIds: [e.id],
        expected: "object",
        got: Array.isArray(block) ? "array" : typeof block,
      });
      continue;
    }
    const base = rules.required.get(name) ?? rules.defaults.get(name) ?? {};
    const merged: Record<string, unknown> = { ...base, ...block };
    const result = z.strictObject(behavior.shape).safeParse(merged);
    if (result.success) continue;
    for (const issue of result.error.issues) {
      const path = issue.path.map((s) => (typeof s === "number" ? s : String(s)));
      if (issue.code === "unrecognized_keys") {
        const known = Object.keys(behavior.shape);
        for (const key of issue.keys) {
          const guess = closest(key, known);
          push("schema", {
            message: `${e.id}.${BEHAVIORS_FIELD}.${name} has no field "${key}"${guess ? `; did you mean "${guess}"?` : ""}`,
            path: pointer(name, ...path, key),
            entityIds: [e.id],
            got: key,
            ...(known.length > 0 ? { expected: known.join(" | ") } : {}),
          });
        }
        continue;
      }
      const field = [BEHAVIORS_FIELD, name, ...path].join(".");
      let got: unknown = merged;
      for (const s of path)
        got = isRecord(got) || Array.isArray(got) ? (got as never)[s] : undefined;
      push("schema", {
        message: `${e.id}.${field}: ${issue.message}`,
        path: pointer(name, ...path),
        entityIds: [e.id],
        ...("expected" in issue && typeof issue.expected === "string"
          ? { expected: issue.expected }
          : {}),
        got: showValue(got),
      });
    }
  }
}

const kindsLabel = (kinds: readonly AssetKindName[]) =>
  kinds.length > 0 ? kinds.join(" or ") : "asset";

/**
 * `asset-missing` for an id no live asset has, `asset-kind` for a live one
 * of a kind the site doesn't take; both suggest the closest live id of the
 * site's kinds. `owner` is the entity whose field it is ("" for settings and
 * the header).
 */
function assetIssue(
  project: ProjectView,
  site: RefSite,
  owner: string,
  entityIds: string[],
): (Partial<SceneIssue> & { code: IssueCode; message: string }) | undefined {
  const fits = (kind: AssetKindName) => site.kinds.length === 0 || site.kinds.includes(kind);
  const live = project.byId.get(site.id);
  if (live && fits(live.kind)) return undefined;
  const what = kindsLabel(site.kinds);
  const segments = pointerSegments(site.pointer);
  const field = (owner ? segments.slice(2) : segments).join(".");
  const where = owner ? `${owner}.${field}` : field;
  const guess = closest(
    site.id,
    [...project.byId.values()].filter((e) => e.id !== site.id && fits(e.kind)).map((e) => e.id),
  );
  const suggest = guess ? `; did you mean "${guess}"?` : "";
  const common = {
    path: site.pointer,
    entityIds,
    ...(site.kinds.length > 0 ? { expected: what } : {}),
  };
  if (live) {
    return {
      code: "asset-kind",
      message: `${where} names "${site.id}", a ${live.kind}; it takes a ${what}${suggest}`,
      ...common,
      got: live.kind,
    };
  }
  const trashed = project.deleted.some((e) => e.id === site.id && fits(e.kind));
  return {
    code: "asset-missing",
    message: `${where} names ${what} "${site.id}", ${trashed ? "which is in the trash" : "which the project doesn't have"}${suggest}`,
    ...common,
    got: site.id,
  };
}

const isNonNegInt = (n: unknown): n is number => typeof n === "number" && isInt(n) && n >= 0;

/** `settings.grid` beyond its shape: whole-pixel cells, a hex side that fits its axis, a whole-pixel origin. */
function validateGrid(grid: Record<string, unknown>, push: Push): void {
  const at = (...rest: (string | number)[]) => jsonPointer(["settings", "grid", ...rest]);
  const bad = (path: string, message: string, expected: string, got: unknown) =>
    push("grid-invalid", { message, path, expected, got: JSON.stringify(got) });
  const cell = Array.isArray(grid.cell) ? grid.cell : [];
  cell.forEach((n, k) => {
    if (!isNonNegInt(n) || n === 0)
      bad(
        at("cell", k),
        `the grid's cell ${k === 0 ? "width" : "height"} is ${JSON.stringify(n)}; it must be a positive whole number of px`,
        "a positive integer",
        n,
      );
  });
  if (grid.kind === "hex") {
    const axis = grid.stagger === "x" ? 0 : 1;
    const span: unknown = cell[axis];
    const side = grid.side;
    const max = isNonNegInt(span) && span > 0 ? span : undefined;
    if (!isNonNegInt(side) || (max !== undefined && side > max))
      bad(
        at("side"),
        `the hex grid's side is ${JSON.stringify(side)}; it must be a whole number of px from 0 to the cell ${axis === 0 ? "width" : "height"}${max !== undefined ? ` (${max})` : ""}`,
        max !== undefined ? `an integer in [0, ${max}]` : "a non-negative integer",
        side,
      );
  }
  const origin = Array.isArray(grid.origin) ? grid.origin : [];
  origin.forEach((n, k) => {
    if (typeof n !== "number" || !isInt(n))
      bad(
        at("origin", k),
        `the grid's origin ${k === 0 ? "x" : "y"} is ${JSON.stringify(n)}; it must be a whole number of px`,
        "an integer",
        n,
      );
  });
}

const RESERVED_OVERRIDE_FIELDS = ["id", "type", "group"];

/** Checks on the document itself: ids, groups, instances, overrides and turned or flipped grids. */
function validateSource(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  self: string | undefined,
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

  // layers
  const layers = registry.layers.map((l) => l.name);
  const layered = [
    ...entities.map((e, i) => ({ id: e.id, layer: e.layer, path: ["entities", i] as const })),
    ...instances.map((e, i) => ({ id: e.id, layer: e.layer, path: ["instances", i] as const })),
  ];
  for (const { id, layer, path } of layered) {
    if (typeof layer !== "string" || layers.includes(layer)) continue;
    const guess = closest(layer, layers);
    push("layer-unknown", {
      message: `${id} is on layer "${layer}", which isn't one of ${layers.join(", ")}${guess ? `; did you mean "${guess}"?` : ""}`,
      path: jsonPointer([...path, "layer"]),
      entityIds: [id],
      expected: layers.join(" | "),
      got: layer,
      fix: {
        label: `Unset ${id}'s layer`,
        ops: [{ op: "update", ref: id, unset: ["layer"] }],
      },
    });
  }

  // settings
  const grid = def.settings?.grid;
  if (isRecord(grid)) validateGrid(grid, push);

  // the assets header
  const listed = new Set<string>();
  (def.assets ?? []).forEach((id, k) => {
    if (!listed.has(id)) {
      listed.add(id);
      return;
    }
    push("schema", {
      message: `the assets header lists "${id}" more than once`,
      path: jsonPointer(["assets", k]),
      expected: "unique ids",
      got: id,
      hint: "List each asset id once: the header is sorted and unique.",
    });
  });

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
  if (self !== undefined && prefabs) validateView(def, registry, prefabs, self, push);
  instances.forEach((inst, i) => {
    const prefab = prefabs?.get(inst.prefab);
    const nesting =
      inst.prefab === self
        ? makeIssue("prefab-cycle", { message: `prefab "${self}" contains itself` })
        : prefab && prefabs
          ? self === undefined
            ? nestingIssue(inst.prefab, prefabs, registry)
            : nestingIssue(self, viewHolder(self, prefabs, [inst]), registry)
          : null;
    if (nesting) {
      push(nesting.code, {
        message: `${inst.id} places prefab "${inst.prefab}": ${nesting.message}`,
        path: jsonPointer(["instances", i, "prefab"]),
        entityIds: [inst.id],
        got: inst.prefab,
      });
      return;
    }
    if (!prefab || !prefabs) {
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
    const prefabPath = jsonPointer(["instances", i, "prefab"]);
    const reached = prefabsUsedBy({ ...def, instances: [inst] }, prefabs);
    const lost = reached.flatMap((id) => {
      const base = prefabs.get(id)?.base;
      return base !== undefined && !prefabs.has(base) ? [{ id, base }] : [];
    });
    if (lost.length > 0) {
      for (const { id, base } of lost)
        push("variant-base-unknown", {
          message: `${inst.id} places prefab "${inst.prefab}", which reaches variant "${id}", whose base "${base}" isn't a prefab in the project`,
          path: prefabPath,
          entityIds: [inst.id],
          got: base,
          hint: `Open prefab "${id}" and point it at an existing base with setPrefabBase, or clear its base.`,
        });
      return;
    }
    for (const id of reached) {
      const clashes = variantClashes(prefabs.get(id)!, prefabs, registry);
      if (clashes.length === 0) continue;
      push("dup-id", {
        message: `${inst.id} places prefab "${inst.prefab}", which reaches variant "${id}", whose ${clashes.map((c) => `"${c}"`).join(", ")} ${clashes.length === 1 ? "clashes" : "clash"} with a child of its base "${prefabs.get(id)!.base}"`,
        path: prefabPath,
        entityIds: [inst.id],
        hint: `Open prefab "${id}" and give its clashing children new ids.`,
      });
    }
    const resolved = resolvePrefab(inst.prefab, prefabs, registry);
    const exposed = resolved.ok ? Object.keys(resolved.prefab.params) : [];
    if (resolved.ok)
      for (const name of Object.keys(inst.params ?? {})) {
        if (exposed.includes(name)) continue;
        const guess = closest(name, exposed);
        push("param-unknown", {
          message: `${inst.id} sets param "${name}", which prefab "${inst.prefab}" doesn't expose${guess ? `; did you mean "${guess}"?` : ""}`,
          path: jsonPointer(["instances", i, "params", name]),
          entityIds: [inst.id],
          got: name,
          ...(exposed.length > 0 ? { expected: exposed.join(" | ") } : {}),
          fix: {
            label: `Clear ${inst.id}'s param ${name}`,
            ops: [{ op: "setParam", ref: inst.id, name, value: null }],
          },
        });
      }
    const local = localChildren(prefab, { ...inst, overrides: {} }, registry, prefabs);
    const nested = nestedInstanceRefs(local.map((c) => c.child));
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
    const children = new Map<Ref, { path: string; what: string }>();
    const byOverrides = { path: jsonPointer(["instances", i, "overrides"]), what: "overrides" };
    for (const path of Object.keys(inst.overrides ?? {})) {
      const split = splitOverridePath(path);
      if (!split) continue;
      const child = local.find((c) => c.child === split.child);
      if (!child) {
        if (nested.has(split.child) && isInstanceOverrideField(split.field)) continue;
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
          : [...Object.keys(type?.shape ?? {}), "name", "layer", "off", "z", BEHAVIORS_FIELD];
      if (RESERVED_OVERRIDE_FIELDS.includes(top) || !fields.includes(top)) {
        unused(path, `names no field "${top}" ${split.child} can have`);
        continue;
      }
      const schema = child.kind === "entity" ? type?.shape[top] : undefined;
      if (schema && fieldKind(schema) === "grid") {
        push("grid-invalid", {
          message: `${inst.id}'s override "${path}" names ${split.child}'s grid field ${top}; grid fields can't be overridden`,
          path: jsonPointer(["instances", i, "overrides", path]),
          entityIds: [inst.id],
          hint: `Paint the cells in prefab "${inst.prefab}" instead, and drop the override.`,
          fix: {
            label: `Drop ${inst.id}'s override ${path}`,
            ops: [{ op: "revertOverride", ref: inst.id, paths: [path] }],
          },
        });
        continue;
      }
      children.set(split.child, byOverrides);
    }
    if (resolved.ok)
      for (const name of Object.keys(inst.params ?? {}))
        for (const target of resolved.prefab.params[name]?.targets ?? []) {
          const split = splitOverridePath(target);
          if (!split || children.has(split.child)) continue;
          if (local.some((c) => c.child === split.child))
            children.set(split.child, {
              path: jsonPointer(["instances", i, "params", name]),
              what: `param ${name}`,
            });
        }
    for (const [ref, from] of children) {
      const child = localChild(prefab, inst, ref, registry, prefabs);
      const entity = child && childEntity(child, registry);
      const schema = entity && entitySchemaFor(registry, entity.type);
      const result = schema?.safeParse({ ...entity, id: "child" });
      if (!result || result.success) continue;
      const first = result.error.issues[0]!;
      push("schema", {
        message: `${inst.id}'s ${from.what} leave${from.what === "overrides" ? "" : "s"} ${ref} invalid: ${first.path.join(".") || "entity"}: ${first.message}`,
        path: from.path,
        entityIds: [inst.id],
      });
    }
  });

  validateGridTransforms(def, registry, prefabs, push);
}

/** The nested instances a list of child refs passes through: `room-1/door-1/panel` gives `room-1` and `room-1/door-1`. */
function nestedInstanceRefs(refs: Iterable<Ref>): Set<Ref> {
  const out = new Set<Ref>();
  for (const ref of refs) {
    const segs = ref.split(CHILD_SEPARATOR);
    for (let k = 1; k < segs.length; k++) out.add(segs.slice(0, k).join(CHILD_SEPARATOR));
  }
  return out;
}

/** The children of prefab `id` by their refs relative to it; none when it doesn't resolve. */
function prefabChildRefs(id: string, prefabs: PrefabLibrary, registry: Registry): Ref[] {
  const res = resolvePrefab(id, prefabs, registry);
  return res.ok ? res.prefab.children.map((c) => c.child) : [];
}

/** The ids of a variant's own entities and instances that a child of its base already has. */
function variantClashes(
  own: Pick<Prefab, "base" | "entities" | "instances">,
  prefabs: PrefabLibrary,
  registry: Registry,
): string[] {
  if (own.base === undefined || !prefabs.has(own.base)) return [];
  const taken = new Set(
    prefabChildRefs(own.base, prefabs, registry).map((ref) => ref.split(CHILD_SEPARATOR)[0]!),
  );
  return [...own.entities.map((e) => e.id), ...(own.instances ?? []).map((n) => n.id)].filter(
    (id) => taken.has(id),
  );
}

/**
 * A prefab view's header, read from the library's copy of `self`: its
 * variant base (a prefab in the library, resolvable, sharing no id with the
 * view's own children) and its params' targets, each naming a child of the
 * view or of its base.
 */
function validateView(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary,
  self: string,
  push: Push,
): void {
  const own = prefabs.get(self);
  if (!own) return;
  const baseRefs: Ref[] = [];
  const base = own.base;
  if (base !== undefined && !prefabs.has(base)) {
    const known = [...prefabs.keys()].filter((id) => id !== self);
    const guess = closest(base, known);
    push("variant-base-unknown", {
      message: `prefab "${self}"'s base "${base}" isn't a prefab in the project${guess ? `; did you mean "${guess}"?` : ""}`,
      path: "/base",
      got: base,
      ...(known.length > 0 ? { expected: known.join(" | ") } : {}),
      fix: guess
        ? { label: `Base ${self} on ${guess}`, ops: [{ op: "setPrefabBase", base: guess }] }
        : { label: `Clear ${self}'s base`, ops: [{ op: "setPrefabBase", base: null }] },
    });
  } else if (base !== undefined) {
    const issue = nestingIssue(self, viewHolder(self, prefabs, []), registry);
    if (issue)
      push(issue.code, { message: `prefab "${self}"'s base: ${issue.message}`, path: "/base" });
    const chain = prefabsUsedBy(
      { ...def, instances: [{ id: "base", prefab: base, at: [0, 0] }] },
      prefabs,
    );
    const lost = chain.flatMap((id) => {
      const b = prefabs.get(id)?.base;
      return b !== undefined && !prefabs.has(b) ? [{ id, base: b }] : [];
    });
    for (const l of lost)
      push("variant-base-unknown", {
        message: `prefab "${self}"'s base "${base}" reaches variant "${l.id}", whose base "${l.base}" isn't a prefab in the project`,
        path: "/base",
        got: l.base,
        hint: `Open prefab "${l.id}" and point it at an existing base with setPrefabBase, or clear its base.`,
      });
    if (!issue && lost.length === 0) {
      baseRefs.push(...prefabChildRefs(base, prefabs, registry));
      const clashes = new Set(
        variantClashes(
          { base, entities: def.entities ?? [], instances: def.instances ?? [] },
          prefabs,
          registry,
        ),
      );
      const owners = [
        ...(def.entities ?? []).map((e, i) => ({ id: e.id, path: ["entities", i, "id"] })),
        ...(def.instances ?? []).map((n, i) => ({ id: n.id, path: ["instances", i, "id"] })),
      ];
      for (const { id, path } of owners) {
        if (!clashes.has(id)) continue;
        push("dup-id", {
          message: `prefab "${self}"'s child "${id}" has the id of a child of its base "${base}"`,
          path: jsonPointer(path),
          entityIds: [id],
          hint: `A variant keeps every child of its base; give "${id}" a new id, or override the base's "${id}" instead.`,
        });
      }
    }
  }

  const params = Object.entries(own.params ?? {});
  if (params.length === 0) return;
  const resolved = resolveScene(def, registry, prefabs);
  const children = new Set<Ref>([
    ...(resolved.entities ?? []).map((e) => e.id),
    ...registry.bulkKeys.flatMap(({ key }) => {
      const rows = def[key];
      return Array.isArray(rows) ? rows.map((_, i) => bulkId(key, i)) : [];
    }),
    ...baseRefs,
  ]);
  const nested = nestedInstanceRefs(children);
  for (const [name, param] of params) {
    param.targets.forEach((target, k) => {
      const split = splitOverridePath(target);
      if (
        split &&
        (children.has(split.child) ||
          (nested.has(split.child) && isInstanceOverrideField(split.field)))
      )
        return;
      const rest = param.targets.filter((_, j) => j !== k);
      push("unused-override", {
        message: `prefab "${self}"'s param "${name}" targets "${target}", which names no child of the prefab`,
        path: jsonPointer(["params", name, "targets", k]),
        hint: `Drop the target with exposeParam, or point it at a child: \`<childId>.<field.path>\`.`,
        fix: {
          label: `Drop target ${target} from param ${name}`,
          ops: [
            {
              op: "exposeParam",
              name,
              param: rest.length > 0 ? { ...param, targets: rest } : null,
            },
          ],
        },
      });
    });
  }
}

const NESTING_CODES: readonly IssueCode[] = ["prefab-unknown", "prefab-cycle", "prefab-depth"];

/** Why prefab `id` can't be resolved, when the reason is a missing nested prefab, a cycle or the depth. */
function nestingIssue(id: string, prefabs: PrefabLibrary, registry: Registry): SceneIssue | null {
  const res = resolvePrefab(id, prefabs, registry);
  return !res.ok && NESTING_CODES.includes(res.issue.code) ? res.issue : null;
}

/**
 * The library with prefab view `self` holding only `instances` (and its
 * base when `instances` is empty), so resolving `self` judges those
 * instances one level down from the view.
 */
function viewHolder(
  self: string,
  prefabs: PrefabLibrary,
  instances: readonly InstanceDef[],
): PrefabLibrary {
  const own = prefabs.get(self);
  const holder: Prefab = {
    kind: PREFAB_KIND,
    v: SCENE_FORMAT_VERSION,
    ...(own?.game !== undefined ? { game: own.game } : {}),
    id: self,
    entities: [],
    ...(instances.length > 0
      ? { instances: [...instances] }
      : own?.base !== undefined
        ? { base: own.base }
        : {}),
  };
  return new Map([...prefabs, [self, holder]]);
}

const IDENTITY: Dihedral = { rot: 0, flip: false };
const dihedralOf = (t: { rot?: number; flip?: boolean } | undefined): Dihedral => ({
  rot: (t?.rot ?? 0) as Dihedral["rot"],
  flip: t?.flip === true,
});
const isTurned = (d: Dihedral) => d.rot !== 0 || d.flip;

/**
 * The grid children of prefab `id` that end up turned or flipped under `d`
 * (the instance's transform and its group's), through nested instances and
 * a variant's base; refs relative to the instance.
 */
function turnedGridChildren(
  id: string,
  d: Dihedral,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  seen: ReadonlySet<string>,
): Ref[] {
  const prefab = prefabs?.get(id);
  if (!prefab || seen.has(id)) return [];
  const inside = new Set([...seen, id]);
  const out: Ref[] = [];
  if (isTurned(d))
    for (const e of prefab.entities)
      if (gridFields(registry, e.type).some((f) => e[f] !== undefined)) out.push(e.id);
  for (const nested of prefab.instances ?? []) {
    const inner = composeDihedral(d, dihedralOf(nested));
    for (const ref of turnedGridChildren(nested.prefab, inner, registry, prefabs, inside))
      out.push(`${nested.id}/${ref}`);
  }
  if (prefab.base !== undefined)
    out.push(...turnedGridChildren(prefab.base, d, registry, prefabs, inside));
  return out;
}

/**
 * A turned or flipped instance or group over an entity with a grid field
 * remaps its cells, which only a square grid with square cells can do.
 */
function validateGridTransforms(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  push: Push,
): void {
  const grid = def.settings?.grid;
  if (!isRecord(grid)) return;
  const cell = Array.isArray(grid.cell) ? grid.cell : [];
  if (grid.kind === "square" && cell[0] === cell[1]) return;
  const which =
    grid.kind === "square"
      ? `its cells are ${JSON.stringify(cell[0])}×${JSON.stringify(cell[1])}`
      : `it is a ${String(grid.kind)} grid`;
  const report = (path: string, owner: string, children: readonly Ref[]) =>
    push("grid-invalid", {
      message: `${owner} turns or flips ${children.length === 1 ? "a grid" : "grids"} (${children.join(", ")}), and the scene's grid can't turn or flip cells (${which})`,
      path,
      entityIds: [owner],
      hint: "Only a square grid with square cells (cell[0] === cell[1]) turns or flips; clear the rotation and mirror, or move the grid out.",
    });
  const transformPointer = (base: (string | number)[], t: Dihedral) =>
    jsonPointer([...base, t.rot !== 0 ? "rot" : "flip"]);

  const groups = def.groups ?? {};
  for (const [id, group] of Object.entries(groups)) {
    const d = dihedralOf(group);
    if (!isTurned(d)) continue;
    const members = (def.entities ?? []).filter(
      (e) => e.group === id && gridFields(registry, e.type).some((f) => e[f] !== undefined),
    );
    if (members.length > 0)
      report(
        transformPointer(["groups", id], d),
        id,
        members.map((e) => e.id),
      );
  }

  (def.instances ?? []).forEach((inst, i) => {
    const own = dihedralOf(inst);
    const groupD = inst.group === undefined ? IDENTITY : dihedralOf(groups[inst.group]);
    const total = composeDihedral(groupD, own);
    const children = turnedGridChildren(inst.prefab, total, registry, prefabs, new Set());
    if (children.length === 0) return;
    report(
      isTurned(own) ? transformPointer(["instances", i], own) : jsonPointer(["instances", i]),
      inst.id,
      children.map((c) => `${inst.id}/${c}`),
    );
  });
}

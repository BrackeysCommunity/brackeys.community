import { z } from "zod";

import { BEHAVIOR_NAME_PATTERN, BEHAVIORS_FIELD, type BehaviorName } from "../game/behaviors";
import { ANIM } from "../game/behaviors/anim";
import { BODY } from "../game/behaviors/body";
import { CHARACTER_SIDE_VIEW } from "../game/behaviors/character-side-view";
import { CHARACTER_TOP_DOWN } from "../game/behaviors/character-top-down";
import { COLLIDER } from "../game/behaviors/collider";
import { FORCE_AREA, forceAreaSensorMessage } from "../game/behaviors/force-area";
import { JOINT } from "../game/behaviors/joint";
import { NAV_AGENT } from "../game/behaviors/nav-agent";
import { OCCUPANT } from "../game/behaviors/occupant";
import { PATH_FOLLOW } from "../game/behaviors/path-follow";
import { SPAWNER } from "../game/behaviors/spawner";
import { SPRITE } from "../game/behaviors/sprite";
import {
  posableType,
  TWEEN,
  tweenBlockProblems,
  type TweenBlock,
  type TweenTarget,
} from "../game/behaviors/tween";
import { behaviorsConflict, isSpawnOnly, placeableTypes } from "../game/define";
import { ID_PATTERN, isPolygonField } from "../game/fields";
import { flowIssue, type SceneLibrary } from "../game/flow";
import { isCameraRegionType, needsPhysics } from "../game/primitives";
import { ENGINE_REGISTRY_ID, scopedRef, type RegisteredType, type Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { assetInfo, atlasFrameIssue } from "../project/asset-info";
import { animSpriteOf, clipLookupOf, sourceClipsIn } from "../project/clip-source";
import { isPlainObject } from "../project/kinds/define";
import { entityRefSites, headerAssetRefs } from "../project/kinds/fields";
import type { SceneListEntry } from "../project/kinds/scene-list";
import { kindsLabel, schemaRefSites, siteFits, type RefSite } from "../project/refs";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId, AssetKindName, ProjectView } from "../project/types";
import { parseBulkId } from "./bulk-ref";
import { closest, didYouMean, meantText } from "./did-you-mean";
import {
  behaviorBlocks,
  bulkId,
  resolveSettings,
  settingsSources,
  type SettingsSources,
} from "./expand";
import { isInstanceOverrideField } from "./field-path";
import { comparePointers } from "./format";
import { sceneHash } from "./hash";
import { jsonPointer, lineAt, makeIssue, pointerSegments } from "./issues";
import { isNavType } from "./nav-type";
import { prefabsUsedBy } from "./prefab";
import {
  CHILD_SEPARATOR,
  childEntity,
  issueOnSource,
  localChild,
  localChildren,
  type LocalChild,
  mapResolvedBatch,
  NO_CHILD_EDITS,
  parseChildRef,
  resolvePrefab,
  resolveScene,
  resolveSceneDetailed,
  sceneFrames,
  type SceneFrames,
  splitOverridePath,
} from "./resolve";
import {
  entitySchemaFor,
  fieldKind,
  geometryFields,
  gridFieldsOf,
  refineBlock,
  sceneRegistry,
  spawnOnlyHint,
  spawnOnlyMessage,
  unknownGameIssue,
} from "./schema";
import {
  aabb,
  aabbUnion,
  convexHull,
  isConvex,
  translateShape,
  walkPolygonIssues,
  type WalkPolygon,
} from "./shape-geometry";
import { parseShape } from "./shapes";
import {
  composeDihedral,
  dihedralOf,
  isIdentityTurn,
  turnOf,
  type Dihedral,
  type Transform2D,
} from "./transform";
import {
  PREFAB_KIND,
  SCENE_FORMAT_VERSION,
  type Aabb,
  type EntityDef,
  type GridSettings,
  type InstanceDef,
  type IssueCode,
  type OpBatch,
  PARENT_MAX_DEPTH,
  type PathDef,
  type Prefab,
  type PrefabLibrary,
  type Pt,
  type Ref,
  type ResolvedSettings,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type ShapeObj,
  type ShapeTuple,
} from "./types";
import { isWholePixel, roundLength, snapToPixel } from "./units";

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
   * reaches it is `prefab-cycle`, its variant base is checked too, and its
   * grid fields need no `settings.grid`.
   */
  prefab?: string;
  /**
   * The project the scene belongs to. With it, an asset id (asset fields of
   * types, behaviors and settings, and the `assets` header) that isn't live
   * is `asset-missing` and one of the wrong kind `asset-kind`, a sprite
   * without an asset `sprite-no-asset` and one naming a frame its atlas
   * lacks (or none) `asset-frame-unknown`, an `anim` block whose atlas
   * source has no tag named its `clip` `anim-clip-unknown`, and a sprite
   * whose asset lacks frames its atlas source plays `anim-atlas-mismatch`;
   * without it, asset ids aren't checked.
   */
  project?: ProjectView;
  /**
   * The project's runtime view, which reads its runtime docs. With it and
   * `project`, an `anim` block whose source is an animation is checked
   * against that animation's clips and atlas too.
   */
  runtime?: Pick<ProjectRuntimeView, "doc">;
  /**
   * The project's `game-settings` engine block. Settings resolve through it
   * and the game's world as `expandScene` resolves them, so the grid that
   * sizes grid fields, and that a turned or flipped instance over grid
   * children is judged against, is the scene's, else the game's
   * `world.grid`. A prefab view has no settings of its own and judges
   * against the grid these sources give; with none, each scene that places
   * the prefab judges it. Default `project.engine`, so a caller that hands
   * over the project's view judges physics and grids as Play does.
   */
  engine?: Readonly<Record<string, unknown>>;
  /** Overrides the sources `engine` and the game's world give, key by key. */
  settings?: SettingsSources;
};

type Located<T> = { field: string; pointer: string; value: T };

/** One bulk entry or entity, with its geometry fields read through its type's schema. */
type Item = {
  ref: Ref;
  pointer: string;
  /** Its index in `def.entities`; absent for a bulk entry. */
  index?: number;
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
    const item: Item = { ref: e.id, pointer, index: i, type, shapes: [], points: [], paths: [] };
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
      isPlainObject(value) &&
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

/** The index of a tuple's angle, which is whole degrees rather than whole pixels. */
const rotIndex = (tag: ShapeTuple[0]) => (tag === "box" || tag === "capsule" ? 5 : -1);

/** Whether a tuple's value at `i` is off the grid it keeps: whole px for a length, whole degrees for the angle. */
const offGrid = (t: ShapeTuple, i: number, ppm: number) => {
  const n = t[i];
  if (i === 0 || typeof n !== "number") return false;
  return i === rotIndex(t[0]) ? !isInt(n) : !isWholePixel(n, ppm);
};

/** A tuple on whole px (sizes at least one px) and whole degrees. */
function snapTuple(t: ShapeTuple, ppm: number): ShapeTuple {
  const [tag, ...nums] = t;
  const positive =
    tag === "box" ? [2, 3] : tag === "circle" ? [2] : tag === "capsule" ? [2, 3] : [];
  const rot = rotIndex(tag) - 1;
  return [
    tag,
    ...nums.map((n, i) =>
      i === rot
        ? Math.round(n)
        : positive.includes(i)
          ? Math.max(snapToPixel(1 / ppm, ppm), snapToPixel(n, ppm))
          : snapToPixel(n, ppm),
    ),
  ] as ShapeTuple;
}

/** The whole world px at or below `m`, as a written length; a pixel lower when rounding lifts it past `m`. */
function pixelFloor(m: number, ppm: number): number {
  const px = Math.floor(m * ppm);
  const out = roundLength(px / ppm);
  return out > m ? roundLength((px - 1) / ppm) : out;
}

/** The whole world px at or above `m`, as a written length. */
function pixelCeil(m: number, ppm: number): number {
  const px = Math.ceil(m * ppm);
  const out = roundLength(px / ppm);
  return out < m ? roundLength((px + 1) / ppm) : out;
}

const snapPt = ([x, y]: Pt, ppm: number): Pt => [snapToPixel(x, ppm), snapToPixel(y, ppm)];
const onPixels = ([x, y]: Pt, ppm: number) => isWholePixel(x, ppm) && isWholePixel(y, ppm);

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
 * instances (their prefabs resolved through nesting and variant
 * bases by `resolvePrefab`, every variant's base known and sharing no
 * child id with it), their params (each one the prefab exposes) and
 * overrides (never of a grid field), a prefab view's params (each target
 * naming a child), and grids
 * under a turned or flipped instance or parent (square cells only). On its resolved view
 * (`resolveScene`, so instance children and parented entities are checked
 * where they land): spawn-only types, which game code alone may make
 * (`unknown-type`), references (each type's `refs`; a child ref
 * `<instance>/<child>` is `ref-child-unknown` when the instance's prefab
 * lacks the child), behavior blocks
 * (registered, allowed by the type, their `requires` carried, their fields
 * valid), grid fields (only with a grid: the scene's, else the game's world's), asset ids and sprite
 * frames when `opts.project` is given, and the
 * geometry of every registered shape, point and path field (polys, chains,
 * paths, whole world pixels, bounds), then the game's `registry.validators`. No
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

  const sources = {
    ...settingsSources(r, opts.engine ?? opts.project?.engine),
    ...opts.settings,
  };
  const { grid, physics } = resolveSettings(
    opts.prefab === undefined ? source.settings : undefined,
    sources,
  );

  const pushSource: Push = (code, fields) => issues.push(withLine(makeIssue(code, fields)));
  const parented = [...(source.entities ?? []), ...(source.instances ?? [])].some(
    (item) => item.parent !== undefined,
  );
  const frames = parented ? sceneFrames(source, r, opts.prefabs) : undefined;
  validateSource(source, r, opts.prefabs, opts.prefab, pushSource, grid, frames);
  if (frames) checkParents(source, r, frames, pushSource);

  const resolved = resolveSceneDetailed(source, r, opts.prefabs);
  const def = resolved.def;
  const toSource = issueOnSource(source, resolved.origins, (fix) =>
    mapResolvedBatch(source, fix, r, opts.prefabs, NO_CHILD_EDITS),
  );
  const push = (code: IssueCode, fields: Partial<SceneIssue> & { message: string }) =>
    issues.push(withLine(toSource(makeIssue(code, fields))));

  const entities = def.entities ?? [];
  const [minX, minY, maxX, maxY] = def.bounds;
  const ppm = pxPerMetreOf(r);

  // types only game code spawns, which no scene or prefab may place
  entities.forEach((e, i) => {
    if (!isSpawnOnly(r, e.type)) return;
    push("unknown-type", {
      message: `${e.id}: ${spawnOnlyMessage(e.type)}`,
      path: jsonPointer(["entities", i, "type"]),
      entityIds: [e.id],
      expected: placeableTypes(r).join(" | "),
      got: e.type,
      hint: spawnOnlyHint(r),
    });
  });

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
            message: `${e.id}.${field} names "${String(target)}", but prefab "${child.prefab}" of ${child.id} has no such child${meantText(guess)}`,
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
  checkJoints(r, entities, push, batch);
  checkSpawners(r, entities, push);

  // grid fields need a grid to size their cells; a prefab view has no
  // settings, and the scene placing it sizes its cells instead
  if (opts.prefab === undefined && !isPlainObject(grid)) {
    entities.forEach((e, i) => {
      for (const field of gridFields(r, e.type)) {
        if (e[field] === undefined) continue;
        push("grid-invalid", {
          message: `${e.id}.${field} is a grid field, but the scene has no settings.grid, nor the game's world a grid, to size its cells`,
          path: jsonPointer(["entities", i, field]),
          entityIds: [e.id],
          hint: 'Give the scene a grid with setSettings (e.g. { "grid": { "kind": "square", "cell": [0.32, 0.32] } }), or unset the field.',
        });
      }
    });
  }

  // what loading needs from the scene's settings: physics for some types
  // and for riders, a grid for occupants; a prefab view is judged by the
  // scene placing it
  if (opts.prefab === undefined) {
    if (physics === "none") {
      const fix = () =>
        batch(
          'Set the scene\'s physics to "rapier"',
          [{ op: "setSettings", set: { physics: "rapier" } }],
          [],
        );
      checkPhysics(r, def, push, fix);
    }
    checkNavAgents(r, entities, push);
    if (!isPlainObject(grid)) {
      entities.forEach((e, i) => {
        if (e.off || !(OCCUPANT.name in behaviorBlocks(r, e.type, e[BEHAVIORS_FIELD]))) return;
        push("grid-invalid", {
          message: `${e.id} has the ${OCCUPANT.name} behavior, but the scene has no settings.grid, nor the game's world a grid, for it to occupy`,
          path: jsonPointer(["entities", i, BEHAVIORS_FIELD, OCCUPANT.name]),
          entityIds: [e.id],
          hint: `Give the scene a grid with setSettings (e.g. { "grid": { "kind": "square", "cell": [0.32, 0.32] } }), or drop ${e.id}'s ${OCCUPANT.name} behavior.`,
        });
      });
    }
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
      if (r.types.has(e.type))
        check(entityRefSites(r, e, jsonPointer(["entities", i])), e.id, [e.id]);
    });
    check(schemaRefSites(r.settings, source.settings ?? {}, "/settings"), "", []);
    check(headerAssetRefs(source.assets), "", []);
    entities.forEach((e, i) => {
      if (!r.types.has(e.type)) return;
      const at = jsonPointer(["entities", i]);
      checkSprite(r, project, e, at, push);
      checkAnim(r, project, opts.runtime, e, at, push);
    });
  }

  let storedItems: Map<number, Item> | undefined;
  const storedItem = (index: number) =>
    (storedItems ??= new Map(
      items(source, r).flatMap((it) => (it.index === undefined ? [] : [[it.index, it]])),
    )).get(index);

  const wholePixels = (item: Item, report: Push) => {
    const { ref } = item;
    const set: Record<string, unknown> = {};
    let firstBad: string | undefined;
    const flag = (field: string, bad: string, value: unknown) => {
      firstBad ??= bad;
      set[field] = value;
    };
    for (const { field, pointer: at, value } of item.shapes) {
      const k = value.findIndex((_, i) => offGrid(value, i, ppm));
      if (k > 0) flag(field, `${at}/${k}`, snapTuple(value, ppm));
    }
    for (const { field, pointer: at, value } of item.points) {
      if (!onPixels(value, ppm))
        flag(field, `${at}/${isWholePixel(value[0], ppm) ? 1 : 0}`, snapPt(value, ppm));
    }
    for (const { field, pointer: at, value } of item.paths) {
      const k = value.pts.findIndex((p) => !onPixels(p, ppm));
      if (k >= 0)
        flag(
          `${field}.pts`,
          `${at}/pts/${k}`,
          value.pts.map((p) => snapPt(p, ppm)),
        );
    }
    if (firstBad !== undefined) {
      report("non-integer", {
        message: `${ref} has a length that isn't a whole world pixel at ${ppm} px per metre (${Object.keys(set).join(", ")})`,
        path: firstBad,
        entityIds: [ref],
        fix: batch(`Snap ${ref} to whole pixels`, [{ op: "update", ref, set }], [ref]),
      });
    }
  };

  // geometry
  for (const item of items(def, r)) {
    const { ref, pointer, type } = item;
    const parsed: ShapeObj[] = [];

    for (const { field, pointer: at, value, schema } of item.shapes) {
      const shape = parseShape(value);
      if (!shape.ok) continue;
      const obj = shape.shape;
      parsed.push(obj);

      if (obj.type === "poly" && obj.pts[0] && !isPolygonField(schema) && !isConvex(obj.pts)) {
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
            : `${ref}'s ${field} speed is ${path.speed}; it must be > 0 m/s`,
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

    // whole world pixels, judged on the stored values under a frame off the quarter turns
    const origin = item.index === undefined ? undefined : resolved.origins[item.index];
    if (!origin?.transform || origin.transform.rot % 90 === 0) wholePixels(item, push);
    else if (origin.kind === "entity") {
      const stored = storedItem(origin.index);
      if (stored) wholePixels(stored, pushSource);
    }

    // bounds
    if (type.loads === false) continue;
    const raw = extent(
      parsed,
      item.points.map((p) => p.value),
      item.paths.map((p) => p.value),
    );
    // Edges at the file's length precision: 3.68 + 0.16 sits on 3.84, not past it.
    const box = raw && {
      minX: roundLength(raw.minX),
      minY: roundLength(raw.minY),
      maxX: roundLength(raw.maxX),
      maxY: roundLength(raw.maxY),
    };
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
                  pixelFloor(grown.minX, ppm),
                  pixelFloor(grown.minY, ppm),
                  pixelCeil(grown.maxX, ppm),
                  pixelCeil(grown.maxY, ppm),
                ],
              },
            },
          ],
          [],
        ),
      });
    }
  }

  checkNav(r, entities, push);

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

/**
 * Whether entities of `type` can be in the tree, as a parent or a child:
 * nav areas, camera regions and types that never load (notes) can't. An
 * unregistered type is reported as such, not here.
 */
export function canBeInTree(type: RegisteredType | undefined): boolean {
  return (
    type === undefined || !(type.loads === false || isNavType(type) || isCameraRegionType(type))
  );
}

/** What a `parent` link names: a document entity or instance, an instance's child or nested instance, a bulk entry, nothing, or a child of an instance whose prefab doesn't resolve (reported as such). */
type ParentTarget =
  | { kind: "entity" | "child"; type: RegisteredType | undefined; what: string }
  | { kind: "instance" | "bulk" | "missing" | "unresolved" };

const isTurnBound = (kind: string) => kind === "side" || kind === "grid";

/** The side and grid fields `e` sets: what turns only by quarter turns. */
function turnBoundFields(r: Registry, e: EntityDef): string[] {
  const shape = r.types.get(e.type)?.shape ?? {};
  return Object.keys(shape).filter((f) => e[f] !== undefined && isTurnBound(fieldKind(shape[f]!)));
}

/**
 * The tree's checks on the document: a parent that doesn't exist
 * (`dangling-ref`), one that is or sits on a type that can't be in the tree
 * (`parent-type`), a chain that comes back round (`parent-cycle`), one more
 * than `PARENT_MAX_DEPTH` levels deep (`parent-depth`), and a side or grid
 * field under a step off the quarter turns, which leaves it unturned
 * (`quarter-turn-only`). Each fix is one `reparent`: to the root for a
 * missing parent, a cycle or a type that can't be a child, else to the
 * nearest ancestor that clears the issue. A child of an instance counts one
 * level below the instance; the levels inside a prefab are judged in it.
 */
function checkParents(def: SceneDefinition, r: Registry, frames: SceneFrames, push: Push): void {
  type Item = { id: string; parent: Ref; at: (string | number)[]; type?: RegisteredType };
  const entities = new Map<string, EntityDef>();
  const instances = new Map<string, InstanceDef>();
  for (const e of def.entities ?? []) if (!entities.has(e.id)) entities.set(e.id, e);
  for (const n of def.instances ?? []) if (!instances.has(n.id)) instances.set(n.id, n);
  const items: Item[] = [];
  (def.entities ?? []).forEach((e, i) => {
    if (typeof e.parent === "string")
      items.push({ id: e.id, parent: e.parent, at: ["entities", i], type: r.types.get(e.type) });
  });
  (def.instances ?? []).forEach((n, i) => {
    if (typeof n.parent === "string")
      items.push({ id: n.id, parent: n.parent, at: ["instances", i] });
  });

  const target = (ref: Ref): ParentTarget => {
    const e = entities.get(ref);
    if (e) return { kind: "entity", type: r.types.get(e.type), what: e.type };
    if (instances.has(ref)) return { kind: "instance" };
    if (parseBulkId(ref.slice(ref.lastIndexOf(CHILD_SEPARATOR) + 1))) return { kind: "bulk" };
    const split = parseChildRef(ref);
    const inst = split && instances.get(split.instance);
    if (!inst) return { kind: "missing" };
    const placed = frames.placed(inst);
    if (!placed) return { kind: "unresolved" };
    const child = placed.find((c) => c.def.id === ref);
    if (child) return { kind: "child", type: r.types.get(child.def.type), what: child.def.type };
    const nested = nestedInstanceRefs(placed.map((c) => c.def.id));
    return nested.has(ref) ? { kind: "instance" } : { kind: "missing" };
  };
  /** Why `t` can't be a parent: the type it is, or "bulk entry"; undefined when it can. */
  const cantParent = (t: ParentTarget): string | undefined =>
    t.kind === "bulk"
      ? "bulk entry"
      : (t.kind === "entity" || t.kind === "child") && !canBeInTree(t.type)
        ? t.what
        : undefined;
  const canParent = (t: ParentTarget) =>
    t.kind !== "missing" && t.kind !== "unresolved" && cantParent(t) === undefined;
  /** The next link up: an instance's child sits under its instance. */
  const up = (ref: Ref): Ref | undefined =>
    entities.has(ref) || instances.has(ref) ? frames.parentOf(ref) : parseChildRef(ref)?.instance;
  const ancestors = function* (ref: Ref | undefined) {
    for (let at = ref; at !== undefined; at = up(at)) yield at;
  };
  const reparent = (id: string, parent: Ref | null): OpBatch => ({
    label: parent === null ? `Move ${id} to the root` : `Reparent ${id} under ${parent}`,
    ops: [{ op: "reparent", refs: [id], parent }],
  });
  const pointer = (item: Item) => jsonPointer([...item.at, "parent"]);

  // the link itself: something to point at, of a type the tree takes
  const linked = new Map<string, Ref>();
  for (const item of items) {
    const { id, parent } = item;
    if (!canBeInTree(item.type)) {
      push("parent-type", {
        message: `${id} is a ${item.type!.type}, which can't be in the tree, but its parent is ${parent}`,
        path: pointer(item),
        entityIds: [id],
        got: item.type!.type,
        fix: reparent(id, null),
      });
      continue;
    }
    const t = target(parent);
    if (t.kind === "unresolved") continue;
    if (t.kind === "missing") {
      const split = parseChildRef(parent);
      const inst = split && instances.get(split.instance);
      const placed = inst && frames.placed(inst);
      if (inst && placed) {
        const candidates = placed.map((c) => c.def.id).filter((c) => canParent(target(c)));
        const guess = closest(parent, candidates);
        push("ref-child-unknown", {
          message: `${id}.parent names "${parent}", but prefab "${inst.prefab}" of ${inst.id} has no such child${meantText(guess)}`,
          path: pointer(item),
          entityIds: [id],
          got: parent,
          ...(candidates.length > 0 ? { expected: candidates.join(" | ") } : {}),
          fix: reparent(id, guess ?? null),
        });
        continue;
      }
      push("dangling-ref", {
        message: `${id}.parent names "${parent}", which doesn't exist`,
        path: pointer(item),
        entityIds: [id],
        hint: `Reparent ${id} under an existing entity or instance, or to the root.`,
        fix: reparent(id, null),
      });
      continue;
    }
    const bad = cantParent(t);
    if (bad !== undefined) {
      let to: Ref | null = null;
      for (const a of ancestors(t.kind === "bulk" ? undefined : up(parent)))
        if (canParent(target(a))) {
          to = a;
          break;
        }
      push("parent-type", {
        message: `${id}.parent names ${parent}, ${bad === "bulk entry" ? "a bulk entry" : `a ${bad}`}, which can't be a parent`,
        path: pointer(item),
        entityIds: [id, parent],
        got: bad,
        fix: reparent(id, to),
      });
      continue;
    }
    linked.set(id, parent);
  }

  // cycles, each reported once on the id the lenient read takes as a root
  const next = (id: string): string | undefined => {
    const p = linked.get(id);
    return p === undefined ? undefined : (parseChildRef(p)?.instance ?? p);
  };
  const state = new Map<string, "open" | "done">();
  const inCycle = new Set<string>();
  for (const start of linked.keys()) {
    const path: string[] = [];
    let id: string | undefined = start;
    while (id !== undefined && !state.has(id)) {
      state.set(id, "open");
      path.push(id);
      id = next(id);
    }
    if (id !== undefined && state.get(id) === "open") {
      const loop = path.slice(path.indexOf(id));
      const root = loop.reduce((a, b) => (b > a ? b : a));
      const k = loop.indexOf(root);
      const chain = [...loop.slice(k), ...loop.slice(0, k)];
      for (const c of chain) inCycle.add(c);
      const item = items.find((x) => x.id === root)!;
      push("parent-cycle", {
        message: `${root} is under itself: ${[...chain, root].join(" → ")}`,
        path: pointer(item),
        entityIds: chain,
        fix: reparent(root, null),
      });
    }
    for (const p of path) state.set(p, "done");
  }

  // depth, counted through the links the lenient read keeps
  const depths = new Map<Ref, number>();
  const depthOf = (ref: Ref): number => {
    const chain: Ref[] = [];
    let at: Ref | undefined = ref;
    let base = -1;
    while (at !== undefined) {
      const known = depths.get(at);
      if (known !== undefined) {
        base = known;
        break;
      }
      chain.push(at);
      at = up(at);
    }
    for (let i = chain.length - 1; i >= 0; i--) depths.set(chain[i]!, ++base);
    return depths.get(ref)!;
  };
  // each run past the limit is reported once, on its shallowest entity
  const itemOf = new Map(items.map((item) => [item.id, item]));
  const tooDeep = new Map<string, { item: Item; deepest: number }>();
  for (const item of items) {
    if (!linked.has(item.id) || inCycle.has(item.id)) continue;
    const d = depthOf(item.id);
    if (d <= PARENT_MAX_DEPTH) continue;
    let top = item;
    for (const a of ancestors(up(item.id))) {
      const above = itemOf.get(a);
      if (above && depthOf(a) > PARENT_MAX_DEPTH) top = above;
    }
    const hit = tooDeep.get(top.id);
    if (hit) hit.deepest = Math.max(hit.deepest, d);
    else tooDeep.set(top.id, { item: top, deepest: d });
  }
  for (const [id, { item, deepest }] of tooDeep) {
    const depth = depthOf(id);
    const wanted = Math.max(0, PARENT_MAX_DEPTH - (deepest - depth));
    let to: Ref | null = null;
    for (const a of ancestors(up(id)))
      if (depthOf(a) === wanted - 1) {
        to = a;
        break;
      }
    push("parent-depth", {
      message: `${id} sits ${depth} parent levels below its root; at most ${PARENT_MAX_DEPTH} are allowed`,
      path: pointer(item),
      entityIds: [id],
      got: String(depth),
      expected: `<= ${PARENT_MAX_DEPTH}`,
      fix: reparent(id, to),
    });
  }

  // side and grid fields turn only by quarter turns
  const quarterUnder = (ref: Ref) => quarterChain(frames.under(ref)) !== null;
  // Reparenting keeps an instance's world angle, so an instance gets no fix.
  const offQuarter = (item: Item, fields: readonly string[], what: string, fixable = true) => {
    let to: Ref | null = null;
    for (const a of ancestors(up(item.parent)))
      if (quarterUnder(a)) {
        to = a;
        break;
      }
    push("quarter-turn-only", {
      message: `${what} under ${item.parent}, whose frame turns off the quarter turns, so ${fields.length === 1 ? "it stays" : "they stay"} unturned (${fields.join(", ")})`,
      path: pointer(item),
      entityIds: [item.id],
      ...(fixable ? { fix: reparent(item.id, to) } : {}),
    });
  };
  for (const item of items) {
    if (!linked.has(item.id) || inCycle.has(item.id) || quarterUnder(item.parent)) continue;
    const e = entities.get(item.id);
    const inst = e ? undefined : instances.get(item.id);
    if (e) {
      const fields = turnBoundFields(r, e);
      if (fields.length > 0)
        offQuarter(
          item,
          fields,
          `${item.id} has ${fields.length === 1 ? "a side or grid field" : "side or grid fields"}, and sits`,
        );
    } else if (inst) {
      const fields = (frames.placed(inst) ?? []).flatMap((c) =>
        turnBoundFields(r, c.def).map((f) => `${c.def.id}.${f}`),
      );
      if (fields.length > 0)
        offQuarter(
          item,
          fields,
          `${item.id}'s children have side or grid fields, and it sits`,
          false,
        );
    }
  }
  (def.instances ?? []).forEach((inst, i) => {
    if (turnOf(inst)) return;
    const fields = (frames.placed(inst) ?? []).flatMap((c) =>
      turnBoundFields(r, c.def).map((f) => `${c.def.id}.${f}`),
    );
    if (fields.length > 0)
      push("quarter-turn-only", {
        message: `${inst.id} turns ${String(inst.rot)}°, off the quarter turns, and its children have side or grid fields, so ${fields.length === 1 ? "it stays" : "they stay"} unturned (${fields.join(", ")})`,
        path: jsonPointer(["instances", i, "rot"]),
        entityIds: [inst.id],
      });
  });
}

/** `physics-required` on each loadable entry whose type needs physics, in a scene whose physics is "none". */
function checkPhysics(r: Registry, def: SceneDefinition, push: Push, fix: () => OpBatch): void {
  const message = (what: string) => `${what}, but the scene's physics resolves to "none"`;
  for (const b of r.bulkKeys) {
    const rows = def[b.key];
    const type = r.types.get(b.type);
    if (!Array.isArray(rows) || !type || !needsPhysics(type)) continue;
    rows.forEach((_, i) => {
      const ref = bulkId(b.key, i);
      push("physics-required", {
        message: message(`${ref} is a ${b.type}, which needs physics`),
        path: jsonPointer([b.key, i]),
        entityIds: [ref],
        fix: fix(),
      });
    });
  }
  (def.entities ?? []).forEach((e, i) => {
    const type = r.types.get(e.type);
    if (e.off || !type) return;
    const blocks = behaviorBlocks(r, e.type, e[BEHAVIORS_FIELD]);
    for (const [name, what] of [
      [BODY.name, "a dynamic body"],
      [JOINT.name, "a joint"],
    ] as const) {
      const block = blocks[name];
      if (!block || (name === BODY.name && block.kind !== "dynamic")) continue;
      push("physics-required", {
        message: message(`${e.id} has ${what}, which needs physics`),
        path: jsonPointer(["entities", i, BEHAVIORS_FIELD, name]),
        entityIds: [e.id],
        fix: fix(),
      });
    }
    if (needsPhysics(type))
      push("physics-required", {
        message: message(`${e.id} is a ${e.type}, which needs physics`),
        path: jsonPointer(["entities", i]),
        entityIds: [e.id],
        fix: fix(),
      });
  });
}

/** `nav-missing` on each entity carrying `nav-agent` in a scene with no walk area. */
function checkNavAgents(r: Registry, entities: readonly EntityDef[], push: Push): void {
  const walks = entities.some(
    (e) => !e.off && isNavType(r.types.get(e.type)) && e.mode !== "block",
  );
  if (walks) return;
  entities.forEach((e, i) => {
    if (e.off || !(NAV_AGENT.name in behaviorBlocks(r, e.type, e[BEHAVIORS_FIELD]))) return;
    push("nav-missing", {
      message: `${e.id} has the ${NAV_AGENT.name} behavior, but the scene has no walk area for it to walk`,
      path: jsonPointer(["entities", i, BEHAVIORS_FIELD, NAV_AGENT.name]),
      entityIds: [e.id],
    });
  });
}

/** `unknown-type` on a spawner whose `type` isn't a registered type that loads; spawn-only types are fine. */
function checkSpawners(r: Registry, entities: readonly EntityDef[], push: Push): void {
  entities.forEach((e, i) => {
    const type = behaviorBlocks(r, e.type, e[BEHAVIORS_FIELD])[SPAWNER.name]?.type;
    if (typeof type !== "string" || (r.types.get(type) && r.types.get(type)!.loads !== false))
      return;
    const loadable = r.typeNames.filter((t) => r.types.get(t)?.loads !== false);
    push("unknown-type", {
      message: `${e.id}'s spawner spawns "${type}", which ${r.types.has(type) ? "never loads" : "isn't a registered type"}${didYouMean(type, loadable)}`,
      path: jsonPointer(["entities", i, BEHAVIORS_FIELD, SPAWNER.name, "type"]),
      entityIds: [e.id],
      expected: loadable.join(" | "),
      got: type,
    });
  });
}

/**
 * Whether a joint can hold `e`: it carries a collider that isn't a sensor
 * (a `body` always comes with one), or its registered type declares
 * `ownsBody`. The runtime holds the same entities, by the non-sensor
 * collider on a body each one has.
 */
function holdsJoint(r: Registry, e: EntityDef): boolean {
  const blocks = behaviorBlocks(r, e.type, e[BEHAVIORS_FIELD]);
  const collider = blocks[COLLIDER.name];
  if (collider) return collider.sensor !== true;
  return r.types.get(e.type)?.ownsBody === true;
}

/** The primitive whose system runs `type`: its own name for a primitive, its base for a type with no system of its own. */
function primitiveOf(type: RegisteredType): string | undefined {
  if (type.origin === ENGINE_REGISTRY_ID) return type.type;
  return type.system ? undefined : type.base;
}

/**
 * Why a `path-follow` on an entity of `type` leaves something behind, or
 * null when it moves all of it: the type's own system places its body
 * (`ownsBody`: a solid, a prop, a follower) or builds a fixed trigger (a
 * sensor), or the entity's `collider` has no body or a static one, so it
 * stays where it was built. A collider on a kinematic or dynamic body moves.
 */
function pathFollowFixed(
  type: RegisteredType,
  collider: boolean,
  body: Record<string, unknown> | null,
): string | null {
  if (type.ownsBody) return `a ${type.type}'s own system places its body`;
  if (primitiveOf(type) === "sensor") return `a ${type.type}'s trigger stays where it was built`;
  if (!collider) return null;
  if (!body) return "its collider has no body, so it stays where it was built";
  const kind = body.kind ?? "dynamic";
  return kind === "static" ? "its collider's body is static, so it stays where it was built" : null;
}

/**
 * Each joint's `to` against the scene: `joint-self` when it names the
 * entity carrying it, `dangling-ref` when it names nothing, `joint-ref-type`
 * when what it names has no body to hold. Inside an instance, `to` may name
 * a sibling by its id within the prefab.
 */
function checkJoints(
  r: Registry,
  entities: readonly EntityDef[],
  push: Push,
  batch: MakeBatch,
): void {
  const byId = new Map(entities.map((e) => [e.id, e]));
  entities.forEach((e, i) => {
    const joint = behaviorBlocks(r, e.type, e[BEHAVIORS_FIELD])[JOINT.name];
    const to = joint?.to;
    if (typeof to !== "string") return;
    const path = jsonPointer(["entities", i, BEHAVIORS_FIELD, JOINT.name, "to"]);
    const targetId = scopedRef(e.id, to, (id) => byId.has(id));
    if (targetId === e.id) {
      push("joint-self", {
        message: `${e.id}'s joint links ${e.id} to itself`,
        path,
        entityIds: [e.id],
        got: to,
      });
      return;
    }
    const target = byId.get(targetId);
    if (!target) {
      push("dangling-ref", {
        message: `${e.id}.${BEHAVIORS_FIELD}.${JOINT.name}.to names "${to}", which doesn't exist`,
        path,
        entityIds: [e.id],
        fix: batch(
          `Unset ${e.id}'s ${JOINT.name} block`,
          [{ op: "update", ref: e.id, unset: [`${BEHAVIORS_FIELD}.${JOINT.name}`] }],
          [e.id],
        ),
      });
    } else if (!holdsJoint(r, target)) {
      push("joint-ref-type", {
        message: `${e.id}'s joint links to ${target.id}, a ${target.type} with no body to hold: give it a body or a collider that isn't a sensor`,
        path,
        entityIds: [e.id, target.id],
        got: target.type,
      });
    }
  });
}

/**
 * `nav-invalid` on each walk area or hole that breaks the rules the mesh
 * builder keeps: simple polygons, walk areas whose interiors don't overlap,
 * and every hole inside exactly one walk area.
 */
function checkNav(r: Registry, entities: readonly EntityDef[], push: Push): void {
  const areas: WalkPolygon[] = [];
  const holes: WalkPolygon[] = [];
  const where = new Map<string, { path: string; at: Pt }>();
  entities.forEach((e, i) => {
    if (e.off || !isNavType(r.types.get(e.type))) return;
    const shape = parseShape(e.shape);
    if (!shape.ok || shape.shape.type !== "poly") return;
    where.set(e.id, { path: jsonPointer(["entities", i, "shape"]), at: center(aabb(shape.shape)) });
    (e.mode === "block" ? holes : areas).push({ id: e.id, pts: shape.shape.pts });
  });
  if (areas.length === 0 && holes.length === 0) return;
  for (const issue of walkPolygonIssues(areas, holes).issues) {
    const last = where.get(issue.entityIds.at(-1) ?? "");
    push("nav-invalid", {
      message: issue.message,
      path: last?.path,
      entityIds: issue.entityIds,
      at: last?.at,
    });
  }
}

const gridFields = (registry: Registry, type: string): string[] =>
  gridFieldsOf(registry.types.get(type));

const showValue = (v: unknown): string => (v === undefined ? "missing" : JSON.stringify(v));

type MakeBatch = (label: string, ops: SceneOp[], refs: Ref[]) => OpBatch;

/** What an entity of `type` is to a tween: whether the type can be posed. */
function tweenTargetOf(type: RegisteredType): TweenTarget {
  return { type: type.type, posable: posableType(type) };
}

/**
 * An entity's behavior blocks against the registry and its type's rules:
 * `behavior-unknown`, `behavior-forbidden`, `behavior-missing` (a carried
 * behavior's `requires`, counting the type's required blocks),
 * `behavior-conflict` once per carried pair that conflicts,
 * `character-body-kind` for a character on a dynamic body, a
 * `behavior-conflict` warning for a `path-follow` that can't move what it
 * carries (`pathFollowFixed`) and doesn't already conflict, `schema` for
 * a block's fields once the type's defaults are under them, and
 * `tween-target-invalid` for a tween its entity can't play.
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
  const blocks = isPlainObject(raw) ? raw : {};
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
      push("behavior-unknown", {
        message: `${e.id} carries behavior "${name}", which isn't registered${didYouMean(name, candidates)}`,
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

  const conflicted = new Set<BehaviorName>();
  order.forEach((name, i) => {
    const behavior = registry.behaviors.get(name)!;
    for (const other of order.slice(i + 1)) {
      if (!behaviorsConflict(behavior, registry.behaviors.get(other)!)) continue;
      conflicted.add(name).add(other);
      const written = other in blocks ? other : name;
      push("behavior-conflict", {
        message: `${e.id} carries "${name}" and "${other}", which can't share an entity`,
        path: pointer(written),
        entityIds: [e.id],
        got: written,
      });
    }
  });

  const character = [CHARACTER_TOP_DOWN.name, CHARACTER_SIDE_VIEW.name].find((n) => carried.has(n));
  if (character && carried.has(BODY.name)) {
    const written = blocks[BODY.name];
    const body: Record<string, unknown> = {
      ...(rules.required.get(BODY.name) ?? rules.defaults.get(BODY.name)),
      ...(isPlainObject(written) ? written : {}),
    };
    if (body.kind === "dynamic") {
      const own = isPlainObject(written) && written.kind !== undefined;
      push("character-body-kind", {
        message: `${e.id} has a ${character} on a dynamic body: the controller and the physics solver would both move it`,
        path: own ? pointer(BODY.name, "kind") : pointer(BODY.name),
        entityIds: [e.id],
        expected: "kinematic",
        got: "dynamic",
        fix: batch(
          `Make ${e.id}'s body kinematic`,
          [
            {
              op: "update",
              ref: e.id,
              set: { [`${BEHAVIORS_FIELD}.${BODY.name}.kind`]: "kinematic" },
            },
          ],
          [e.id],
        ),
      });
    }
  }

  if (carried.has(PATH_FOLLOW.name) && !conflicted.has(PATH_FOLLOW.name)) {
    const written = blocks[BODY.name];
    const body = carried.has(BODY.name)
      ? {
          ...(rules.required.get(BODY.name) ?? rules.defaults.get(BODY.name)),
          ...(isPlainObject(written) ? written : {}),
        }
      : null;
    const why = pathFollowFixed(type, carried.has(COLLIDER.name), body);
    if (why)
      push("behavior-conflict", {
        severity: "warn",
        message: `${e.id}'s ${PATH_FOLLOW.name} moves its pose, but ${why}`,
        path: pointer(PATH_FOLLOW.name),
        entityIds: [e.id],
        got: PATH_FOLLOW.name,
        hint:
          type.ownsBody || primitiveOf(type) === "sensor"
            ? "Move it on a marker or decor whose collider rides a kinematic body, or use a follower's own path."
            : 'Give the collider a body of `kind` "kinematic" so the path moves the collider too, and carries what stands on it.',
      });
  }

  if (carried.has(FORCE_AREA.name) && carried.has(COLLIDER.name)) {
    const written = blocks[COLLIDER.name];
    const collider: Record<string, unknown> = {
      ...(rules.required.get(COLLIDER.name) ?? rules.defaults.get(COLLIDER.name)),
      ...(isPlainObject(written) ? written : {}),
    };
    if (collider.sensor !== true) {
      push("schema", {
        message: forceAreaSensorMessage(e.id),
        path: isPlainObject(written) ? pointer(COLLIDER.name, "sensor") : pointer(FORCE_AREA.name),
        entityIds: [e.id],
        expected: "true",
        got: showValue(collider.sensor ?? false),
        fix: batch(
          `Make ${e.id}'s collider a sensor`,
          [
            {
              op: "update",
              ref: e.id,
              set: { [`${BEHAVIORS_FIELD}.${COLLIDER.name}.sensor`]: true },
            },
          ],
          [e.id],
        ),
      });
    }
  }

  const groups = registry.collisionGroupNames;
  const groupIssue = (group: unknown, path: string, what: string, severity?: "warn") => {
    if (typeof group !== "string" || !ID_PATTERN.test(group) || groups.includes(group)) return;
    push("schema", {
      message: `${e.id}'s ${what} names collision group "${group}", which the game doesn't declare${didYouMean(group, groups)}`,
      path,
      entityIds: [e.id],
      expected: groups.join(" | "),
      got: group,
      hint: `Use one of the collision groups: ${groups.join(", ")}.`,
      ...(severity ? { severity } : {}),
    });
  };
  if (carried.has(COLLIDER.name)) {
    const written = blocks[COLLIDER.name];
    const own = isPlainObject(written) && "group" in written;
    const group = own
      ? written.group
      : (rules.required.get(COLLIDER.name) ?? rules.defaults.get(COLLIDER.name))?.group;
    groupIssue(group, own ? pointer(COLLIDER.name, "group") : pointer(COLLIDER.name), "collider");
  }
  if (carried.has(FORCE_AREA.name)) {
    const written = blocks[FORCE_AREA.name];
    const own = isPlainObject(written) && isPlainObject(written.affects);
    const affects = own
      ? written.affects
      : (rules.required.get(FORCE_AREA.name) ?? rules.defaults.get(FORCE_AREA.name))?.affects;
    const listed = isPlainObject(affects) ? affects.groups : undefined;
    if (Array.isArray(listed))
      listed.forEach((group, j) =>
        groupIssue(
          group,
          own ? pointer(FORCE_AREA.name, "affects", "groups", j) : pointer(FORCE_AREA.name),
          "force area",
          "warn",
        ),
      );
  }

  for (const name of order) {
    const behavior = registry.behaviors.get(name)!;
    const block = blocks[name];
    if (block !== undefined && !isPlainObject(block)) {
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
    const result = refineBlock(behavior, z.strictObject(behavior.shape)).safeParse(merged);
    if (result.success) {
      if (name === TWEEN.name) {
        const tweens = (result.data as TweenBlock).tweens;
        const target = tweenTargetOf(type);
        for (const { index, message } of tweenBlockProblems(
          e.id,
          tweens,
          target,
          carried.has(SPRITE.name),
        )) {
          push("tween-target-invalid", {
            message,
            path: pointer(name, "tweens", index),
            entityIds: [e.id],
          });
        }
      }
      continue;
    }
    for (const issue of result.error.issues) {
      const path = issue.path.map((s) => (typeof s === "number" ? s : String(s)));
      if (issue.code === "unrecognized_keys") {
        const known = Object.keys(behavior.shape);
        for (const key of issue.keys) {
          push("schema", {
            message: `${e.id}.${BEHAVIORS_FIELD}.${name} has no field "${key}"${didYouMean(key, known)}`,
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
        got = isPlainObject(got) || Array.isArray(got) ? (got as never)[s] : undefined;
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

/**
 * An entity's sprite block against its asset: `sprite-no-asset` without
 * one, `asset-frame-unknown` for an atlas with no frame or a frame its
 * meta lacks. A missing or wrong-kind asset is the asset checks'.
 */
function checkSprite(
  registry: Registry,
  project: ProjectView,
  e: EntityDef,
  at: string,
  push: Push,
): void {
  const block = behaviorBlocks(registry, e.type, e[BEHAVIORS_FIELD])[SPRITE.name];
  if (!block) return;
  const pointer = blockPointer(e, at, SPRITE.name);
  const asset = block.asset;
  if (typeof asset !== "string") {
    push("sprite-no-asset", {
      message: `${e.id}'s sprite has no asset, so only its fallback box draws`,
      path: pointer(),
      entityIds: [e.id],
    });
    return;
  }
  const issue = atlasFrameIssue(assetInfo(project, asset), block.frame, {
    who: `${e.id}'s sprite`,
    path: pointer("frame"),
    block: pointer(),
    entityIds: [e.id],
  });
  if (issue) push(issue.code, issue);
}

/**
 * A pointer into `e`'s `name` block when the entity writes one, else to the
 * entity, whose type's block it carries.
 */
function blockPointer(e: EntityDef, at: string, name: string) {
  const written = isPlainObject(e[BEHAVIORS_FIELD]) && Object.hasOwn(e[BEHAVIORS_FIELD], name);
  return (...rest: string[]) =>
    written ? `${at}${jsonPointer([BEHAVIORS_FIELD, name, ...rest])}` : at;
}

/**
 * An entity's anim block against its source: `anim-clip-unknown` for a
 * `clip` that isn't one of the source's clips (an animation's, or an
 * atlas's tags), with a did-you-mean, and `anim-atlas-mismatch` for a
 * sprite whose asset lacks frames the source plays (`animSpriteOf`). An
 * animation source is read through `runtime`, and isn't checked without
 * it; a missing or wrong-kind source or sprite asset is the asset checks'.
 */
function checkAnim(
  registry: Registry,
  project: ProjectView,
  runtime: Pick<ProjectRuntimeView, "doc"> | undefined,
  e: EntityDef,
  at: string,
  push: Push,
): void {
  const blocks = behaviorBlocks(registry, e.type, e[BEHAVIORS_FIELD]);
  const block = blocks[ANIM.name];
  const source = block?.source;
  if (typeof source !== "string") return;
  const lookup = clipLookupOf(project, runtime?.doc);
  const clip = typeof block?.clip === "string" ? block.clip : undefined;
  const clips = clip === undefined ? null : sourceClipsIn(lookup, source);
  if (clip !== undefined && clips && !clips.names.includes(clip)) {
    push("anim-clip-unknown", {
      message: `${e.id}'s anim plays clip "${clip}", which ${clips.what} "${source}" doesn't have${didYouMean(clip, clips.names)}`,
      path: blockPointer(e, at, ANIM.name)("clip"),
      entityIds: [e.id],
      got: clip,
      ...(clips.names.length > 0 ? { expected: clips.names.join(" | ") } : {}),
    });
  }
  const drawn = blocks[SPRITE.name]?.asset;
  if (typeof drawn !== "string" || !lookup.asset(drawn)) return;
  const needs = animSpriteOf(lookup, source, clip, drawn);
  if (!needs || needs.missing.length === 0) return;
  const shown = needs.missing.slice(0, 3).join(", ") + (needs.missing.length > 3 ? ", …" : "");
  push("anim-atlas-mismatch", {
    message: `${e.id}'s sprite draws "${drawn}", which lacks frames its anim plays from "${source}" (${shown}); set the sprite's asset to "${needs.atlas}"`,
    path: blockPointer(e, at, SPRITE.name)("asset"),
    entityIds: [e.id],
    got: drawn,
    expected: needs.atlas,
  });
}

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
  const fits = (kind: AssetKindName) => siteFits(site, kind);
  const live = project.byId.get(site.id);
  if (live && fits(live.kind)) return undefined;
  const what = kindsLabel(site);
  const segments = pointerSegments(site.pointer);
  const field = (owner ? segments.slice(2) : segments).join(".");
  const where = owner ? `${owner}.${field}` : field;
  const suggest = didYouMean(
    site.id,
    [...project.byId.values()].filter((e) => fits(e.kind)).map((e) => e.id),
  );
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

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * `settings.grid` beyond its shape, at `ppm` px per metre: cells of a
 * positive whole number of px, a hex side of whole px that fits its axis, an
 * origin on whole px. Tiles line up with art only on whole px.
 */
function validateGrid(grid: Record<string, unknown>, push: Push, ppm: number): void {
  const at = (...rest: (string | number)[]) => jsonPointer(["settings", "grid", ...rest]);
  const bad = (path: string, message: string, expected: string, got: unknown) =>
    push("grid-invalid", { message, path, expected, got: JSON.stringify(got) });
  const px = `1 px is ${roundLength(1 / ppm)} m at ${ppm} px per metre`;
  const cell = Array.isArray(grid.cell) ? grid.cell : [];
  cell.forEach((n, k) => {
    if (!isNum(n) || !(n > 0) || !isWholePixel(n, ppm) || Math.round(n * ppm) < 1)
      bad(
        at("cell", k),
        `the grid's cell ${k === 0 ? "width" : "height"} is ${JSON.stringify(n)} m; it must be a positive whole number of px (${px})`,
        "a positive whole number of px, in metres",
        n,
      );
  });
  if (grid.kind === "hex") {
    const axis = grid.stagger === "x" ? 0 : 1;
    const span: unknown = cell[axis];
    const side = grid.side;
    const max = isNum(span) && span > 0 && isWholePixel(span, ppm) ? span : undefined;
    if (!isNum(side) || side < 0 || !isWholePixel(side, ppm) || (max !== undefined && side > max))
      bad(
        at("side"),
        `the hex grid's side is ${JSON.stringify(side)} m; it must be a whole number of px from 0 to the cell ${axis === 0 ? "width" : "height"}${max !== undefined ? ` (${max} m)` : ""} (${px})`,
        max !== undefined
          ? `a whole number of px in [0, ${max}] m`
          : "a non-negative whole number of px, in metres",
        side,
      );
  }
  const origin = Array.isArray(grid.origin) ? grid.origin : [];
  origin.forEach((n, k) => {
    if (!isNum(n) || !isWholePixel(n, ppm))
      bad(
        at("origin", k),
        `the grid's origin ${k === 0 ? "x" : "y"} is ${JSON.stringify(n)} m; it must be a whole number of px (${px})`,
        "a whole number of px, in metres",
        n,
      );
  });
}

const RESERVED_OVERRIDE_FIELDS = ["id", "type", "parent"];

/** Checks on the document itself: ids, instances, overrides and turned or flipped grids. */
function validateSource(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  self: string | undefined,
  push: Push,
  grid: unknown,
  frames: SceneFrames | undefined,
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
    push("layer-unknown", {
      message: `${id} is on layer "${layer}", which isn't one of ${layers.join(", ")}${didYouMean(layer, layers)}`,
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
  const own = def.settings?.grid;
  if (isPlainObject(own)) validateGrid(own, push, pxPerMetreOf(registry));

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
        push("param-unknown", {
          message: `${inst.id} sets param "${name}", which prefab "${inst.prefab}" doesn't expose${didYouMean(name, exposed)}`,
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
      const verdict = judgeOverride(registry, local, nested, path, inst.prefab);
      if (verdict.kind === "unused") unused(path, verdict.why);
      else if (verdict.kind === "grid")
        push("grid-invalid", {
          message: `${inst.id}'s override "${path}" names ${verdict.child}'s grid field ${verdict.field}; grid fields can't be overridden`,
          path: jsonPointer(["instances", i, "overrides", path]),
          entityIds: [inst.id],
          hint: `Paint the cells in prefab "${inst.prefab}" instead, and drop the override.`,
          fix: {
            label: `Drop ${inst.id}'s override ${path}`,
            ops: [{ op: "revertOverride", ref: inst.id, paths: [path] }],
          },
        });
      else if (verdict.kind === "child") children.set(verdict.child, byOverrides);
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

  validateGridTransforms(
    def,
    registry,
    prefabs,
    frames,
    grid,
    self === undefined ? "the scene's grid" : "the game's grid",
    push,
  );
}

type OverrideVerdict =
  | { kind: "skip" }
  | { kind: "child"; child: Ref }
  | { kind: "unused"; why: string }
  | { kind: "grid"; child: Ref; field: string };

/**
 * What override `path` does to `children` (a prefab's, by refs relative to
 * it): names one of them and a field it can have, names a field of a nested
 * instance in `nested`, names nothing (`unused`), or names a grid field,
 * which can't be overridden. A path that isn't `childId.field` is `skip`:
 * the schema reports it.
 */
function judgeOverride(
  registry: Registry,
  children: readonly LocalChild[],
  nested: ReadonlySet<Ref>,
  path: string,
  prefab: string,
): OverrideVerdict {
  const split = splitOverridePath(path);
  if (!split) return { kind: "skip" };
  const child = children.find((c) => c.child === split.child);
  if (!child) {
    if (nested.has(split.child) && isInstanceOverrideField(split.field)) return { kind: "skip" };
    return { kind: "unused", why: `names no child of prefab "${prefab}"` };
  }
  const top = split.field.split(".")[0]!;
  const type = registry.types.get(
    child.kind === "entity" ? child.def.type : (registry.bulkKey(child.key)?.type ?? ""),
  );
  const fields: (string | undefined)[] =
    child.kind === "bulk"
      ? [registry.bulkKey(child.key)?.field, "off"]
      : [...Object.keys(type?.shape ?? {}), "name", "layer", "off", "z", BEHAVIORS_FIELD];
  if (RESERVED_OVERRIDE_FIELDS.includes(top) || !fields.includes(top))
    return { kind: "unused", why: `names no field "${top}" ${split.child} can have` };
  const schema = child.kind === "entity" ? type?.shape[top] : undefined;
  if (schema && fieldKind(schema) === "grid")
    return { kind: "grid", child: split.child, field: top };
  return { kind: "child", child: split.child };
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
 * A prefab's own overrides against its variant base's children:
 * `unused-override` for a path that names none of them (every path, when it
 * has no base), `grid-invalid` for a grid field. The fix drops the path
 * with a `revertOverride` that has no ref, a header op of the prefab's own
 * document.
 */
function validateVariantOverrides(
  registry: Registry,
  prefabs: PrefabLibrary,
  own: Prefab,
  base: string | undefined,
  push: Push,
): void {
  const paths = Object.keys(own.overrides ?? {});
  if (paths.length === 0) return;
  const resolved = base === undefined ? undefined : resolvePrefab(base, prefabs, registry);
  if (resolved && !resolved.ok) return;
  const children = resolved?.prefab.children ?? [];
  const nested = nestedInstanceRefs(children.map((c) => c.child));
  const drop = (path: string) => ({
    label: `Drop ${own.id}'s override ${path}`,
    ops: [{ op: "revertOverride", paths: [path] } satisfies SceneOp],
  });
  for (const path of paths) {
    const verdict: OverrideVerdict =
      base === undefined
        ? { kind: "unused", why: "has no base to override: the prefab isn't a variant" }
        : judgeOverride(registry, children, nested, path, base);
    const at = jsonPointer(["overrides", path]);
    if (verdict.kind === "unused")
      push("unused-override", {
        message: `prefab "${own.id}"'s override "${path}" ${verdict.why}`,
        path: at,
        fix: drop(path),
      });
    else if (verdict.kind === "grid")
      push("grid-invalid", {
        message: `prefab "${own.id}"'s override "${path}" names ${verdict.child}'s grid field ${verdict.field}; grid fields can't be overridden`,
        path: at,
        hint: `Paint the cells in prefab "${base ?? own.id}" instead, and drop the override.`,
        fix: drop(path),
      });
  }
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
  if (base === undefined) validateVariantOverrides(registry, prefabs, own, undefined, push);
  if (base !== undefined && !prefabs.has(base)) {
    const known = [...prefabs.keys()].filter((id) => id !== self);
    const guess = closest(base, known);
    push("variant-base-unknown", {
      message: `prefab "${self}"'s base "${base}" isn't a prefab in the project${meantText(guess)}`,
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
      validateVariantOverrides(registry, prefabs, own, base, push);
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

/**
 * The grid children of prefab `id` that end up turned or flipped under `d`
 * (the instance's transform and its parent chain's), through nested instances and
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
  if (!isIdentityTurn(d))
    for (const e of prefab.entities)
      if (gridFields(registry, e.type).some((f) => e[f] !== undefined)) out.push(e.id);
  for (const nested of prefab.instances ?? []) {
    const own = turnOf(nested);
    if (!own) continue;
    const inner = composeDihedral(d, own);
    for (const ref of turnedGridChildren(nested.prefab, inner, registry, prefabs, inside))
      out.push(`${nested.id}/${ref}`);
  }
  if (prefab.base !== undefined)
    out.push(...turnedGridChildren(prefab.base, d, registry, prefabs, inside));
  return out;
}

/**
 * A turned or flipped instance or parent chain over an entity with a
 * grid field remaps its cells, which only a square grid with square cells
 * can do. A chain off the quarter turns is `quarter-turn-only` instead.
 */
function validateGridTransforms(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  frames: SceneFrames | undefined,
  grid: unknown,
  whose: string,
  push: Push,
): void {
  if (!isPlainObject(grid)) return;
  const cell = Array.isArray(grid.cell) ? grid.cell : [];
  if (grid.kind === "square" && cell[0] === cell[1]) return;
  const which =
    grid.kind === "square"
      ? `its cells are ${JSON.stringify(cell[0])}×${JSON.stringify(cell[1])}`
      : `it is a ${String(grid.kind)} grid`;
  const report = (path: string, owner: string, children: readonly Ref[]) =>
    push("grid-invalid", {
      message: `${owner} turns or flips ${children.length === 1 ? "a grid" : "grids"} (${children.join(", ")}), and ${whose} can't turn or flip cells (${which})`,
      path,
      entityIds: [owner],
      hint: "Only a square grid with square cells (cell[0] === cell[1]) turns or flips; clear the rotation and mirror, or move the grid out.",
    });
  const transformPointer = (base: (string | number)[], t: Dihedral) =>
    jsonPointer([...base, t.rot !== 0 ? "rot" : "flip"]);

  const chainTurn = (item: EntityDef | InstanceDef): Dihedral =>
    (frames && quarterChain(frames.stepsFor(item))) || IDENTITY;

  (def.entities ?? []).forEach((e, i) => {
    const owner = frames?.parentOf(e.id);
    if (owner === undefined || isIdentityTurn(chainTurn(e))) return;
    if (gridFields(registry, e.type).some((f) => e[f] !== undefined))
      report(jsonPointer(["entities", i, "parent"]), owner, [e.id]);
  });

  (def.instances ?? []).forEach((inst, i) => {
    const own = turnOf(inst);
    if (!own) return;
    const total = composeDihedral(chainTurn(inst), own);
    const children = turnedGridChildren(inst.prefab, total, registry, prefabs, new Set());
    if (children.length === 0) return;
    report(
      !isIdentityTurn(own)
        ? transformPointer(["instances", i], own)
        : inst.parent !== undefined
          ? jsonPointer(["instances", i, "parent"])
          : jsonPointer(["instances", i]),
      inst.id,
      children.map((c) => `${inst.id}/${c}`),
    );
  });
}

/** The turn and flip a chain of steps applies, innermost first, or null when a step turns off the quarter turns. */
function quarterChain(steps: readonly Transform2D[]): Dihedral | null {
  let out = IDENTITY;
  for (const t of steps) {
    const d = dihedralOf(t);
    if (!d) return null;
    out = composeDihedral(d, out);
  }
  return out;
}

/** What `sublevelIssue` reads of a scene: its resolved settings. */
export type SublevelSettings = { settings: Pick<ResolvedSettings, "physics" | "grid" | "gravity"> };

export type SublevelJudgeOptions = {
  /** The attached scene's asset id. */
  scene: AssetId;
  /** The scene list in effect. */
  list: readonly SceneListEntry[];
  label: string;
  /** World offset, metres; default [0, 0]. */
  at?: Pt;
  /** Whether a label is attached already, or still has live entities. */
  taken?: (label: string) => boolean;
  /** The game's px per metre, which `at` and the cell are judged in. */
  pxPerMetre: number;
};

/** The repeat of a grid's lattice in whole px: a cell, or two staggered rows (columns) of hexes. */
function gridPeriodPx(grid: GridSettings, ppm: number): Pt {
  const [w, h] = grid.cell;
  if (grid.kind === "square") return [Math.round(w * ppm), Math.round(h * ppm)];
  return grid.stagger === "x"
    ? [Math.round((w + grid.side) * ppm), Math.round(h * ppm)]
    : [Math.round(w * ppm), Math.round((h + grid.side) * ppm)];
}

const samePx = (a: number, b: number, ppm: number) => Math.round(a * ppm) === Math.round(b * ppm);

/** Why `sub`'s grid moved by `at` doesn't lie on `main`'s, or null. */
function gridMismatch(
  main: GridSettings | null,
  sub: GridSettings | null,
  at: Pt,
  ppm: number,
): string | null {
  if (!main && !sub) return null;
  if (!main) return "it has a grid and the main scene has none";
  if (!sub) return "the main scene has a grid and it has none";
  if (main.kind !== sub.kind) return `its grid is ${sub.kind} and the main scene's is ${main.kind}`;
  if (!samePx(main.cell[0], sub.cell[0], ppm) || !samePx(main.cell[1], sub.cell[1], ppm))
    return `its cell [${sub.cell.join(", ")}] isn't the main scene's [${main.cell.join(", ")}]`;
  if (
    main.kind === "hex" &&
    sub.kind === "hex" &&
    (!samePx(main.side, sub.side, ppm) || main.stagger !== sub.stagger || main.index !== sub.index)
  )
    return "its hex side, stagger or index isn't the main scene's";
  if (!isWholePixel(at[0], ppm) || !isWholePixel(at[1], ppm))
    return `at [${at.join(", ")}] isn't a whole world pixel at ${ppm} px per metre`;
  const period = gridPeriodPx(main, ppm);
  const [mx, my] = main.origin ?? [0, 0];
  const [sx, sy] = sub.origin ?? [0, 0];
  const off = [Math.round((sx + at[0] - mx) * ppm), Math.round((sy + at[1] - my) * ppm)] as const;
  if (off[0] % period[0] !== 0 || off[1] % period[1] !== 0)
    return `at [${at.join(", ")}] doesn't put its cells on the main scene's (they repeat every ${period[0]} × ${period[1]} px)`;
  return null;
}

/**
 * Why the listed scene `opts.scene`, resolved to `sub`, can't attach beside
 * the main scene `main` as `opts.label` at `opts.at`, or null when it can.
 * Every refusal is `sublevel-invalid` with `detail.reason`: "unlisted" (by
 * `flowIssue`), "label" (malformed or taken), "physics", "grid" (shape,
 * cell size, or `at` off the main scene's cells, judged in whole px) or
 * "settings" (gravity). The one rule the runtime's attach and validation
 * both judge by.
 */
export function sublevelIssue(
  main: SublevelSettings,
  sub: SublevelSettings,
  opts: SublevelJudgeOptions,
): SceneIssue | null {
  const { scene, label } = opts;
  const unlisted = flowIssue(opts.list, scene, "attach");
  if (unlisted) return unlisted;
  const refuse = (reason: string, why: string) =>
    makeIssue("sublevel-invalid", {
      message: `"${scene}" can't attach as "${label}": ${why}`,
      entityIds: [scene],
      detail: { reason, scene, label },
    });
  if (!ID_PATTERN.test(label))
    return refuse("label", "the label isn't lowercase letters, digits and dashes");
  if (opts.taken?.(label)) return refuse("label", "the label is taken");
  const m = main.settings;
  const s = sub.settings;
  if (m.physics !== s.physics)
    return refuse("physics", `it runs on ${s.physics} and the main scene on ${m.physics}`);
  const grid = gridMismatch(m.grid, s.grid, opts.at ?? [0, 0], opts.pxPerMetre);
  if (grid) return refuse("grid", grid);
  if (m.gravity[0] !== s.gravity[0] || m.gravity[1] !== s.gravity[1])
    return refuse(
      "settings",
      `its gravity [${s.gravity.join(", ")}] isn't the main scene's [${m.gravity.join(", ")}]`,
    );
  return null;
}

/** A place a check or script names a sublevel: the scene it attaches, as what and where, and its pointer. */
export type SublevelUse = {
  scene: AssetId;
  label: string;
  at?: Pt;
  /** A JSON Pointer into the file that names it. */
  path: string;
  line?: number;
};

/**
 * `sublevel-invalid` for each use that `sublevelIssue` refuses beside the
 * main scene `main`, settings resolved as `expandScene` resolves them;
 * uses are judged in order, so a label an earlier use took is taken. A
 * listed scene the library holds no text for is `asset-missing`. No
 * checks file or input-script op names a sublevel yet: this is the rule
 * for when one does, kept off the public barrel until then.
 */
export function sublevelUseIssues(
  main: SceneDefinition,
  uses: readonly SublevelUse[],
  env: {
    registry: Registry;
    library: SceneLibrary;
    engine?: Readonly<Record<string, unknown>>;
  },
): SceneIssue[] {
  const sources = settingsSources(env.registry, env.engine);
  const at = (def: SceneDefinition) => ({ settings: resolveSettings(def.settings, sources) });
  const host = at(main);
  const taken = new Set<string>();
  const out: SceneIssue[] = [];
  for (const use of uses) {
    const where = { path: use.path, ...(use.line === undefined ? {} : { line: use.line }) };
    const listed = env.library.scenes.get(use.scene);
    const issue = listed
      ? sublevelIssue(host, at(listed.def), {
          scene: use.scene,
          list: env.library.list,
          label: use.label,
          ...(use.at ? { at: use.at } : {}),
          taken: (label) => taken.has(label),
          pxPerMetre: pxPerMetreOf(env.registry),
        })
      : (flowIssue(env.library.list, use.scene, "attach") ??
        makeIssue("asset-missing", {
          message: `"${use.scene}" is in the scene list, but the library holds no scene for it`,
          entityIds: [use.scene],
        }));
    taken.add(use.label);
    if (issue) out.push({ ...issue, ...where });
  }
  return out;
}

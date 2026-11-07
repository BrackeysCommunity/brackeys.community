import type { Collider, Shape } from "@dimforge/rapier2d";

import type { ColliderTag, PhysicalEnv, PhysicalHit, Registry } from "../game/types";
import { shapeColliderDesc, shapePose } from "../physics";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene, parseBulkId } from "../scene/expand";
import { comparePointers } from "../scene/format";
import { jsonPointer, lineAt, makeIssue } from "../scene/issues";
import { toSourceBatch } from "../scene/ops";
import { issueOnSource, resolveSceneDetailed } from "../scene/resolve";
import { fieldKind } from "../scene/schema";
import { aabb, centroid, translateShape } from "../scene/shape-geometry";
import type {
  Aabb,
  ExpandedScene,
  PrefabLibrary,
  Pt,
  Ref,
  RuntimeEntity,
  SceneDefinition,
  SceneIssue,
  ShapeObj,
} from "../scene/types";
import type { RapierModule, Vec2 } from "../types";

/** Penetration deeper than this counts as an overlap; touching doesn't. */
const OVERLAP_EPS = 0.01;
/** A swept shape is inset by this, so sliding flush along a surface isn't a hit; world geometry is whole pixels. */
const SWEEP_SKIN = 0.5;

type Tagged = { collider: Collider; tag: ColliderTag };

const vec = (x: number, y: number) => ({ x, y });
const rounded = (p: Vec2): Pt => [Math.round(p.x), Math.round(p.y)];

function worldPoint(collider: Collider, local: Vec2): Vec2 {
  const t = collider.translation();
  const r = collider.rotation();
  const c = Math.cos(r);
  const s = Math.sin(r);
  return vec(t.x + local.x * c - local.y * s, t.y + local.x * s + local.y * c);
}

/** `shape` as a Rapier query shape with its world pose. */
function queryShape(rapier: RapierModule, shape: ShapeObj) {
  const pose = shapePose(shape);
  return {
    shape: shapeColliderDesc(rapier, shape).shape as Shape,
    pos: vec(pose.x, pose.y),
    rot: pose.rotation,
  };
}

/** `shape` shrunk by `d` on every side (a poly toward its centroid); a chain is unchanged. */
function inset(shape: ShapeObj, d: number): ShapeObj {
  switch (shape.type) {
    case "box":
      return { ...shape, hw: Math.max(shape.hw - d, d), hh: Math.max(shape.hh - d, d) };
    case "circle":
    case "capsule":
      return { ...shape, r: Math.max(shape.r - d, d) };
    case "poly": {
      const [cx, cy] = centroid(shape.pts);
      const far = Math.max(...shape.pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
      const k = far > 2 * d ? 1 - d / far : 1;
      return {
        ...shape,
        pts: shape.pts.map(([x, y]): Pt => [cx + (x - cx) * k, cy + (y - cy) * k]),
      };
    }
    case "chain":
      return shape;
  }
}

/** Every tagged collider in the world that isn't gated off (collision groups 0), in handle order. */
function taggedColliders(env: Pick<PhysicalEnv, "physics" | "tags">): Tagged[] {
  const out: Tagged[] = [];
  for (const collider of env.physics.world.colliders.getAll()) {
    const tag = env.tags.get(collider.handle);
    if (tag && collider.collisionGroups() !== 0) out.push({ collider, tag });
  }
  return out;
}

/** A static solid: on a fixed body (or none) and not a sensor. */
const isStatic = ({ collider }: Tagged) =>
  !collider.isSensor() && (collider.parent()?.isFixed() ?? true);

/** The first of `candidates` that `shape` hits when swept by `by`, `toi` a fraction of `by`. */
function sweep(
  rapier: RapierModule,
  candidates: readonly Tagged[],
  shape: ShapeObj,
  by: Vec2,
  stopAtPenetration: boolean,
): (PhysicalHit & { toi: number }) | null {
  const length = Math.hypot(by.x, by.y);
  if (length === 0) return null;
  const q = queryShape(rapier, shape);
  const dir = vec(by.x / length, by.y / length);
  const still = vec(0, 0);
  let best: { c: Tagged; toi: number; witness: Vec2 } | null = null;
  for (const c of candidates) {
    const hit = c.collider.castShape(
      still,
      q.shape,
      q.pos,
      q.rot,
      dir,
      0,
      length,
      stopAtPenetration,
    );
    if (hit && (!best || hit.time_of_impact < best.toi))
      best = { c, toi: hit.time_of_impact, witness: hit.witness1 };
  }
  if (!best) return null;
  return {
    tag: best.c.tag,
    at: worldPoint(best.c.collider, best.witness),
    toi: best.toi / length,
  };
}

/**
 * Shape queries over a loaded runtime's world: the editor's edit world or a
 * headless one, never stepped. Null when nothing is loaded. Queries test the
 * colliders as they stand, so they need no query refresh.
 */
export function physicalEnv(runtime: SceneRuntimeHandle, def: SceneDefinition): PhysicalEnv | null {
  const scene = runtime.scene();
  if (!scene) return null;
  const { rapier, physics, tags, registry } = runtime.ctx;
  const all = () => taggedColliders({ physics, tags });
  const kept = (exclude: readonly string[] | undefined) => (c: Tagged) =>
    !exclude?.includes(c.tag.entityId);

  return {
    def,
    scene,
    registry,
    rapier,
    physics,
    tags,
    overlaps(shape, opts = {}) {
      const q = queryShape(rapier, shape);
      const hits: PhysicalHit[] = [];
      for (const c of all().filter(kept(opts.exclude))) {
        if (c.collider.isSensor() && !opts.sensors) continue;
        const contact = c.collider.contactShape(q.shape, q.pos, q.rot, 0);
        if (contact && contact.distance < -OVERLAP_EPS) {
          hits.push({ tag: c.tag, at: vec(contact.point1.x, contact.point1.y) });
        }
      }
      return hits;
    },
    cast(shape, by, opts = {}) {
      const candidates = all().filter((c) => !c.collider.isSensor() && kept(opts.exclude)(c));
      return sweep(rapier, candidates, shape, by, false);
    },
  };
}

// ─── The engine's checks ─────────────────────────────────

/** Where `ref` lives in the document: a bulk entry, or an entity (its `field` when given). */
function refPointer(def: SceneDefinition, ref: Ref, field?: string): string | undefined {
  const bulk = parseBulkId(ref);
  if (bulk) return jsonPointer([bulk.key, bulk.index]);
  const i = (def.entities ?? []).findIndex((e) => e.id === ref);
  if (i < 0) return undefined;
  return jsonPointer(field ? ["entities", i, field] : ["entities", i]);
}

const fmtPt = ([x, y]: Pt) => `[${x}, ${y}]`;

/** Types with the follower's fields: a shape local to the current point of a `path`. */
function followsPath(registry: Registry, e: RuntimeEntity): boolean {
  const fields = registry.types.get(e.type)?.shape;
  return (
    fields?.shape !== undefined &&
    fields.path !== undefined &&
    fieldKind(fields.shape) === "shape" &&
    fieldKind(fields.path) === "path"
  );
}

type FollowerEntity = RuntimeEntity<{
  shape: ShapeObj;
  path: { pts: Pt[]; mode: "loop" | "ping_pong" };
}>;

const isShapeObj = (v: unknown): v is ShapeObj =>
  v !== null && typeof v === "object" && "type" in v;

/**
 * The solid colliders riding `host`'s body (gated one-way ones too), each
 * with its entity's shape: world px with the host at its first path point.
 */
function ridersOf(env: PhysicalEnv, host: string): { id: string; shape: ShapeObj }[] {
  const ids = new Set<string>();
  for (const collider of env.physics.world.colliders.getAll()) {
    const tag = env.tags.get(collider.handle);
    if (tag?.carrier?.entityId === host && !collider.isSensor()) ids.add(tag.entityId);
  }
  return env.scene.entities.flatMap((e) =>
    ids.has(e.id) && isShapeObj(e.shape) ? [{ id: e.id, shape: e.shape }] : [],
  );
}

/**
 * Each follower's shape, and every solid riding it, swept along every path
 * segment (the loop's closing one too) into a static solid.
 */
function followerHitsSolid(env: PhysicalEnv): SceneIssue[] {
  const statics = taggedColliders(env).filter(isStatic);
  const out: SceneIssue[] = [];
  for (const e of env.scene.entities) {
    if (!followsPath(env.registry, e)) continue;
    const { id, shape, path } = e as FollowerEntity;
    const others = statics.filter((c) => c.tag.entityId !== id);
    const { pts } = path;
    const start = pts[0]!;
    const parts = [
      { id, at: (a: Pt) => translateShape(shape, a) },
      ...ridersOf(env, id).map((r) => ({
        id: r.id,
        at: (a: Pt) => translateShape(r.shape, [a[0] - start[0], a[1] - start[1]]),
      })),
    ];
    const segments = path.mode === "loop" && pts.length > 2 ? pts.length : pts.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const by = vec(b[0] - a[0], b[1] - a[1]);
      for (const part of parts) {
        const candidates = others.filter((c) => c.tag.entityId !== part.id);
        const hit = sweep(env.rapier, candidates, inset(part.at(a), SWEEP_SKIN), by, true);
        if (!hit) continue;
        const closing = i === pts.length - 1 ? "closing " : "";
        const at = rounded(hit.at);
        const who =
          part.id === id
            ? `${id}'s path runs into ${hit.tag.entityId} on its`
            : `${part.id}, riding ${id}, runs into ${hit.tag.entityId} on ${id}'s`;
        out.push(
          makeIssue("follower-hits-solid", {
            message: `${who} ${closing}segment ${i} (${fmtPt(a)} → ${fmtPt(b)}) at ${fmtPt(at)}`,
            path: `${refPointer(env.def, id) ?? ""}/path/pts/${i}`,
            entityIds: part.id === id ? [id, hit.tag.entityId] : [id, part.id, hit.tag.entityId],
            at,
          }),
        );
      }
    }
  }
  return out;
}

const mergeKey = ({ tag }: Tagged) => `${tag.type}|${tag.material ?? ""}|${tag.oneWay === true}`;

const UNBOUNDED: Aabb = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };

/** Pairs of static solids of one type, material and one-way-ness that overlap: they could be one shape. */
function solidOverlap(env: PhysicalEnv): SceneIssue[] {
  const shapes = new Map<string, ShapeObj>();
  for (const e of env.scene.entities) {
    const shape = e.shape as ShapeObj | undefined;
    if (shape && typeof shape === "object" && "type" in shape) shapes.set(e.id, shape);
  }
  const groups = new Map<string, { c: Tagged; box: Aabb }[]>();
  for (const c of taggedColliders(env).filter(isStatic)) {
    const shape = shapes.get(c.tag.entityId);
    const list = groups.get(mergeKey(c)) ?? [];
    list.push({ c, box: shape ? aabb(shape) : UNBOUNDED });
    groups.set(mergeKey(c), list);
  }

  const out: SceneIssue[] = [];
  for (const list of groups.values()) {
    list.sort((p, q) => p.box.minX - q.box.minX);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length && list[j]!.box.minX < a.box.maxX; j++) {
        const b = list[j]!;
        if (b.box.minY >= a.box.maxY || a.box.minY >= b.box.maxY) continue;
        if (a.c.tag.entityId === b.c.tag.entityId) continue;
        const contact = a.c.collider.contactCollider(b.c.collider, 0);
        if (!contact || contact.distance >= -OVERLAP_EPS) continue;
        const [first, second] = [a.c.tag.entityId, b.c.tag.entityId].sort((x, y) =>
          comparePointers(refPointer(env.def, x), refPointer(env.def, y)),
        ) as [string, string];
        const at = rounded(
          vec((contact.point1.x + contact.point2.x) / 2, (contact.point1.y + contact.point2.y) / 2),
        );
        out.push(
          makeIssue("solid-overlap", {
            message: `${second} overlaps ${first} by ${Math.round(-contact.distance)}px at ${fmtPt(at)}`,
            path: refPointer(env.def, second, "shape") ?? "",
            entityIds: [second, first],
            at,
          }),
        );
      }
    }
  }
  return out;
}

export type PhysicalOptions = {
  /** `pointerLines` of the scene's text, to give each issue a line. */
  lines?: ReadonlyMap<string, number>;
};

/**
 * The engine's physical checks (`follower-hits-solid`, `solid-overlap`),
 * then the registry's `physicalChecks`, in document order of their `path`.
 */
export function runPhysicalChecks(env: PhysicalEnv, opts: PhysicalOptions = {}): SceneIssue[] {
  const issues = [
    ...followerHitsSolid(env),
    ...solidOverlap(env),
    ...env.registry.physicalChecks.flatMap((check) => check.run(env)),
  ];
  const withLines = opts.lines
    ? issues.map((issue) => {
        if (issue.path === undefined || issue.line !== undefined) return issue;
        const line = lineAt(opts.lines!, issue.path);
        return line === undefined ? issue : { ...issue, line };
      })
    : issues;
  return withLines
    .map((issue, i) => [issue, i] as const)
    .sort(([a, i], [b, j]) => comparePointers(a.path, b.path) || i - j)
    .map(([issue]) => issue);
}

export type ValidatePhysicalOptions = PhysicalOptions & {
  rapier: RapierModule;
  scene: SceneDefinition;
  registry: Registry;
  /** The prefabs the scene's instances name. */
  prefabs?: PrefabLibrary;
};

/**
 * Loads `scene` into a headless world that is never stepped and runs the
 * physical checks over it. The checks see the resolved view (instances
 * inlined, groups applied); their issues come back pointing into the
 * document, with fixes mapped onto it. A scene for another game, or one
 * that doesn't expand or load, has none: `validateScene` reports why.
 */
export function validatePhysical(opts: ValidatePhysicalOptions): SceneIssue[] {
  const { rapier, scene: source, registry, prefabs } = opts;
  if (source.game !== undefined && source.game !== registry.id) return [];
  const resolved = resolveSceneDetailed(source, registry, prefabs);
  let scene: ExpandedScene;
  try {
    scene = expandScene(resolved.def, registry);
  } catch {
    return [];
  }
  const runtime = createSceneRuntime({ rapier, view: null, registry });
  try {
    if (!runtime.load(scene).ok) return [];
    const env = physicalEnv(runtime, resolved.def);
    if (!env) return [];
    const toSource = issueOnSource(source, resolved.origins, (fix) =>
      toSourceBatch(source, fix, registry, prefabs),
    );
    return runPhysicalChecks(env, opts).map(toSource);
  } finally {
    runtime.destroy();
  }
}

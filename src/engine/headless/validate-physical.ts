import { PhysicsRequiredError } from "../game/physics-of";
import type { ColliderTag, PhysicalCheck, PhysicalEnv, Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { createSceneRuntime } from "../runtime/runtime";
import type { SpaceHit } from "../runtime/space";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene, parseBulkId } from "../scene/expand";
import { comparePointers } from "../scene/format";
import { jsonPointer, lineAt, makeIssue } from "../scene/issues";
import { toSourceBatch } from "../scene/ops";
import { issueOnSource, resolveSceneDetailed } from "../scene/resolve";
import { fieldKind } from "../scene/schema";
import { aabb, aabbUnion, centroid, translateShape } from "../scene/shape-geometry";
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
import { snapToPixel } from "../scene/units";
import type { RapierModule, Vec2 } from "../types";

/** Penetration deeper than this counts as an overlap; touching doesn't. */
const OVERLAP_EPS = 0.0001;
/** A swept shape is inset by this, m, so sliding flush along a surface isn't a hit; world geometry is whole pixels. */
const SWEEP_SKIN = 0.005;
/**
 * A physical check that needs physics, skipped in a scene without it, is
 * reported under this code at `info`.
 */
const SKIPPED_CODE = "physics-skipped";

const vec = (x: number, y: number) => ({ x, y });
/** `p` on the game's nearest whole world px, for an issue's `at`. */
const rounded = (p: Vec2, registry: Registry): Pt => {
  const ppm = pxPerMetreOf(registry);
  return [snapToPixel(p.x, ppm), snapToPixel(p.y, ppm)];
};

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
      let far = 0;
      for (const [x, y] of shape.pts) {
        far = Math.max(far, Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)));
      }
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

const isShapeObj = (v: unknown): v is ShapeObj =>
  v !== null && typeof v === "object" && "type" in v;

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

/** A non-sensor collider found in the loaded world. */
type Solid = SpaceHit & {
  /** On a body that never moves: no follower, rider or Rapier body that isn't fixed. */
  fixed: boolean;
};

type World = Pick<PhysicalEnv, "def" | "scene" | "registry" | "physics" | "space">;

/** Where the loaded colliders can be: the bounds, every shape, and each follower at its path's start. */
function extentOf({ def, scene, registry }: World): ShapeObj {
  const [minX, minY, maxX, maxY] = def.bounds;
  let box: Aabb = { minX, minY, maxX, maxY };
  for (const e of scene.entities) {
    if (!isShapeObj(e.shape)) continue;
    const start = followsPath(registry, e) ? (e as FollowerEntity).path.pts[0] : undefined;
    box = aabbUnion(box, aabb(start ? translateShape(e.shape, start) : e.shape));
  }
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  return {
    type: "box",
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    hw: (box.maxX - box.minX) / 2 + pad,
    hh: (box.maxY - box.minY) / 2 + pad,
    rotDeg: 0,
  };
}

/**
 * Every non-sensor collider in the loaded world, by handle, on either
 * backend. The geometry world holds only static and kinematic colliders, and
 * the engine's kinematic ones are followers and what rides them.
 */
function solidsOf(world: World): Solid[] {
  const movers = new Set(
    world.scene.entities.filter((e) => followsPath(world.registry, e)).map((e) => e.id),
  );
  return world.space.overlaps(extentOf(world)).map((hit) => {
    const body = world.physics?.world.getCollider(hit.handle)?.parent();
    return {
      ...hit,
      fixed: !hit.tag.carrier && !movers.has(hit.tag.entityId) && (body ? body.isFixed() : true),
    };
  });
}

const unique = (ids: Iterable<string>) => [...new Set(ids)];

/**
 * Shape queries over a loaded runtime's world: the editor's edit world or a
 * headless one, never stepped, on Rapier or the geometry backend. Null when
 * nothing is loaded. Queries go through `ctx.space`, where touching isn't
 * overlapping.
 */
export function physicalEnv(runtime: SceneRuntimeHandle, def: SceneDefinition): PhysicalEnv | null {
  const scene = runtime.scene();
  if (!scene) return null;
  const { rapier, physics, tags, registry, space } = runtime.ctx;
  return {
    def,
    scene,
    registry,
    rapier,
    physics,
    tags,
    space,
    overlaps(shape, opts = {}) {
      return space
        .overlaps(inset(shape, OVERLAP_EPS), {
          sensors: opts.sensors === true,
          ...(opts.exclude && { exclude: opts.exclude }),
        })
        .map(({ tag, at }) => ({ tag, at }));
    },
    cast(shape, by, opts = {}) {
      const hit = space.sweep(shape, by, opts.exclude ? { exclude: opts.exclude } : {});
      return hit && { tag: hit.tag, at: hit.at, toi: hit.toi };
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

/**
 * Each follower's shape, and every solid riding it, swept along every path
 * segment (the loop's closing one too) into a static solid. Riders are in
 * world metres with the host at its first path point.
 */
function followerHitsSolid(env: PhysicalEnv, solids: readonly Solid[]): SceneIssue[] {
  const fixedIds = new Set(solids.filter((s) => s.fixed).map((s) => s.tag.entityId));
  const moving = unique(
    solids.filter((s) => !fixedIds.has(s.tag.entityId)).map((s) => s.tag.entityId),
  );
  const shapes = new Map<string, ShapeObj>();
  for (const e of env.scene.entities) if (isShapeObj(e.shape)) shapes.set(e.id, e.shape);
  const out: SceneIssue[] = [];
  for (const e of env.scene.entities) {
    if (!followsPath(env.registry, e)) continue;
    const { id, shape, path } = e as FollowerEntity;
    const { pts } = path;
    const start = pts[0]!;
    const riders = unique(
      solids.filter((s) => s.tag.carrier?.entityId === id).map((s) => s.tag.entityId),
    ).flatMap((rider) => {
      const own = shapes.get(rider);
      return own ? [{ id: rider, shape: own }] : [];
    });
    const parts = [
      { id, at: (a: Pt) => translateShape(shape, a) },
      ...riders.map((r) => ({
        id: r.id,
        at: (a: Pt) => translateShape(r.shape, [a[0] - start[0], a[1] - start[1]]),
      })),
    ];
    const segments = path.mode === "loop" && pts.length > 2 ? pts.length : pts.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const by = vec(b[0] - a[0], b[1] - a[1]);
      if (by.x === 0 && by.y === 0) continue;
      for (const part of parts) {
        const exclude = unique([...moving, id, part.id]);
        const hit = env.cast(inset(part.at(a), SWEEP_SKIN), by, { exclude });
        if (!hit) continue;
        const closing = i === pts.length - 1 ? "closing " : "";
        const at = rounded(hit.at, env.registry);
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

const mergeKey = (tag: ColliderTag) =>
  `${tag.type}|${tag.material ?? ""}|${tag.oneWay === true ? (tag.oneWaySide ?? "up") : ""}`;

/** The overlap of two boxes, or null when they only touch. */
function intersection(a: Aabb, b: Aabb): Aabb | null {
  const box = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
  return box.minX < box.maxX && box.minY < box.maxY ? box : null;
}

/**
 * Pairs of static solids of one type, material and one-way-ness that
 * overlap: they could be one shape. The depth and point come from the
 * overlap of the two shapes' bounding boxes.
 */
function solidOverlap(env: PhysicalEnv, solids: readonly Solid[]): SceneIssue[] {
  const statics = new Map<string, Set<string>>();
  for (const s of solids) {
    if (!s.fixed) continue;
    const keys = statics.get(s.tag.entityId) ?? new Set<string>();
    keys.add(mergeKey(s.tag));
    statics.set(s.tag.entityId, keys);
  }
  const shapes = new Map<string, ShapeObj>();
  for (const e of env.scene.entities) if (isShapeObj(e.shape)) shapes.set(e.id, e.shape);

  const seen = new Set<string>();
  const out: SceneIssue[] = [];
  for (const s of solids) {
    const id = s.tag.entityId;
    const shape = shapes.get(id);
    if (!shape || !s.fixed) continue;
    const key = mergeKey(s.tag);
    for (const hit of env.overlaps(shape, { exclude: [id] })) {
      const other = hit.tag.entityId;
      if (mergeKey(hit.tag) !== key || !statics.get(other)?.has(key)) continue;
      const [first, second] = [id, other].sort((x, y) =>
        comparePointers(refPointer(env.def, x), refPointer(env.def, y)),
      ) as [string, string];
      const pair = `${first}\u0000${second}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const otherShape = shapes.get(other);
      const box = otherShape ? intersection(aabb(shape), aabb(otherShape)) : null;
      const at = box
        ? rounded(vec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2), env.registry)
        : rounded(hit.at, env.registry);
      const depth = box
        ? ` by ${snapToPixel(Math.min(box.maxX - box.minX, box.maxY - box.minY), pxPerMetreOf(env.registry))} m`
        : "";
      out.push(
        makeIssue("solid-overlap", {
          message: `${second} overlaps ${first}${depth} at ${fmtPt(at)}`,
          path: refPointer(env.def, second, "shape") ?? "",
          entityIds: [second, first],
          at,
        }),
      );
    }
  }
  return out;
}

/** The info issue for a game check that needs physics, in a scene without it. */
function skipped(env: PhysicalEnv, check: PhysicalCheck): SceneIssue {
  return makeIssue(SKIPPED_CODE, {
    message: `physical check ${env.registry.id}/${check.id} needs physics and was skipped: the scene runs without it`,
    path: env.def.settings?.physics === undefined ? "" : jsonPointer(["settings", "physics"]),
  });
}

export type PhysicalOptions = {
  /** `pointerLines` of the scene's text, to give each issue a line. */
  lines?: ReadonlyMap<string, number>;
};

/**
 * The engine's physical checks (`follower-hits-solid`, `solid-overlap`),
 * then the registry's `physicalChecks`, in document order of their `path`.
 * All of them run on either backend, except a game check with
 * `needsPhysics`, which a scene without physics skips with an info issue.
 */
export function runPhysicalChecks(env: PhysicalEnv, opts: PhysicalOptions = {}): SceneIssue[] {
  const solids = solidsOf(env);
  const issues = [
    ...followerHitsSolid(env, solids),
    ...solidOverlap(env, solids),
    ...env.registry.physicalChecks.flatMap((check) =>
      check.needsPhysics === true && !env.physics ? [skipped(env, check)] : check.run(env),
    ),
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
  /** Needed for a scene that runs on Rapier; without one such a scene throws `PhysicsRequiredError`. */
  rapier?: RapierModule | null;
  scene: SceneDefinition;
  registry: Registry;
  /** The prefabs the scene's instances name; the game's `ctx.instantiate` places from them too. */
  prefabs?: PrefabLibrary;
  /** The project's `engine` block, which the scene's settings resolve through. */
  engine?: Readonly<Record<string, unknown>>;
};

/**
 * Loads `scene` into a headless world that is never stepped and runs the
 * physical checks over it: on Rapier, or on the geometry backend when the
 * scene runs without physics. The checks see the resolved view (instances
 * inlined, groups applied); their issues come back pointing into the
 * document, with fixes mapped onto it. A scene for another game, or one
 * that doesn't expand or load, has none: `validateScene` reports why.
 */
export function validatePhysical(opts: ValidatePhysicalOptions): SceneIssue[] {
  const { rapier, scene: source, registry, prefabs, engine } = opts;
  if (source.game !== undefined && source.game !== registry.id) return [];
  const resolved = resolveSceneDetailed(source, registry, prefabs);
  let scene: ExpandedScene;
  try {
    scene = expandScene(resolved.def, registry, engine ? { engine } : {});
  } catch {
    return [];
  }
  const physicsFree = scene.settings.physics === "none";
  if (!physicsFree && !rapier) throw new PhysicsRequiredError("physical validation");
  const runtime = createSceneRuntime({
    rapier: physicsFree ? null : rapier,
    view: null,
    registry,
    ...(prefabs ? { prefabs } : {}),
  });
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

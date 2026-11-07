import { PRIMITIVE_TYPES, type RegisteredType, type Registry } from "../game/types";
import { closest } from "./did-you-mean";
import { expandScene, isExpandedScene } from "./expand";
import { geometryFields } from "./schema";
import { aabb, aabbUnion, translateShape } from "./shape-geometry";
import type {
  Aabb,
  Bounds,
  ExpandedScene,
  PathDef,
  PrefabLibrary,
  Pt,
  Ref,
  RuntimeEntity,
  SceneDefinition,
  SceneIssue,
  ShapeObj,
} from "./types";

/** What part of the world a render covers. */
export type SceneRegionOptions = {
  /** A world rectangle `[x0, y0, x1, y1]`; wins over `around`. */
  region?: Bounds;
  /** Frame one entity (an id or a `~key:index` bulk ref) and everything within `margin` of it. */
  around?: Ref;
  /** World px around `around`'s box; default 128. */
  margin?: number;
  /** The prefabs a document's instances name; a document is drawn from its resolved view. */
  prefabs?: PrefabLibrary;
};

/** An entity as the renderers draw it: world geometry, with a path rider placed at its first point. */
export type DrawnEntity = {
  id: string;
  /** A bulk entry, `~key:index`. */
  bulk: boolean;
  type: RegisteredType;
  entity: RuntimeEntity;
  /** The base primitive the type behaves as: its `base`, or itself for a primitive. */
  base: string | undefined;
  /** World shape; for a path rider, its local shape placed at the path's first point. */
  shape?: ShapeObj;
  /** A path rider's local shape, to place at each waypoint. */
  localShape?: ShapeObj;
  at?: Pt;
  path?: PathDef;
  tags: readonly string[];
  /** World box of everything drawn for it, path waypoints included. */
  box: Aabb;
};

/** A world point as a tuple or as `{ x, y }` (what a playtest report's events carry). */
export type OverlayPoint = Pt | { x: number; y: number };

/**
 * What a render draws over the scene. A `PlaytestReport` fits as it is:
 * its `issues`, `trail`, `events` and `outcome` are these fields.
 */
export type SceneOverlay = {
  issues?: readonly Pick<SceneIssue, "severity" | "code" | "entityIds" | "at">[];
  /** The focus trail, oldest first. */
  trail?: readonly Pt[] | { pts: readonly Pt[] };
  events?: readonly { type: string; at: OverlayPoint; tick?: number; entityId?: string }[];
  outcome?: { result: string; at: OverlayPoint | null; tick?: number; cause?: string } | null;
};

export const DEFAULT_MARGIN = 128;

export function expandedOf(
  scene: SceneDefinition | ExpandedScene,
  registry: Registry,
  prefabs?: PrefabLibrary,
): ExpandedScene {
  return isExpandedScene(scene)
    ? scene
    : expandScene(scene as SceneDefinition, registry, { prefabs });
}

const isPrimitive = (name: string) => (PRIMITIVE_TYPES as readonly string[]).includes(name);

/** Every entity of `scene` with a registered type, in spawn order, with its world geometry. */
export function drawnEntities(scene: ExpandedScene, registry: Registry): DrawnEntity[] {
  const out: DrawnEntity[] = [];
  for (const e of scene.entities) {
    const type = registry.types.get(e.type);
    if (!type) continue;
    let local: ShapeObj | undefined;
    let at: Pt | undefined;
    let path: PathDef | undefined;
    for (const { field, kind } of geometryFields(type)) {
      const value = e[field];
      if (value === undefined) continue;
      if (kind === "shape") local ??= value as ShapeObj;
      else if (kind === "point") at ??= value as Pt;
      else if (kind === "path") path ??= value as PathDef;
    }
    const first = path?.pts[0];
    const shape = local && first ? translateShape(local, first) : local;
    let box: Aabb | undefined = shape ? aabb(shape) : undefined;
    if (local && path)
      for (const p of path.pts) box = aabbUnion(box!, aabb(translateShape(local, p)));
    if (at) {
      const pt = { minX: at[0], minY: at[1], maxX: at[0], maxY: at[1] };
      box = box ? aabbUnion(box, pt) : pt;
    }
    if (!box) continue;
    const tags = Array.isArray(e.tags)
      ? e.tags.filter((t): t is string => typeof t === "string")
      : [];
    out.push({
      id: e.id,
      bulk: e.id.startsWith("~"),
      type,
      entity: e,
      base: type.base ?? (isPrimitive(type.type) ? type.type : undefined),
      ...(shape ? { shape } : {}),
      ...(local && path ? { localShape: local } : {}),
      ...(at ? { at } : {}),
      ...(path ? { path } : {}),
      tags,
      box,
    });
  }
  return out;
}

export const overlaps = (b: Aabb, [x0, y0, x1, y1]: Bounds) =>
  b.maxX >= x0 && b.minX <= x1 && b.maxY >= y0 && b.minY <= y1;

/** The world rectangle a render covers: `region`, else `around` plus `margin`, else the scene's bounds. */
export function resolveRegion(
  scene: ExpandedScene,
  entities: readonly DrawnEntity[],
  opts: SceneRegionOptions,
): Bounds {
  if (opts.region) {
    const [x0, y0, x1, y1] = opts.region;
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
      throw new Error(`region [${opts.region.join(", ")}] must be finite with x1 > x0 and y1 > y0`);
    }
    return [x0, y0, x1, y1];
  }
  if (opts.around !== undefined) {
    const hit = entities.find((d) => d.id === opts.around);
    if (!hit) {
      const guess = closest(
        opts.around,
        entities.map((d) => d.id),
      );
      throw new Error(
        `no entity ${JSON.stringify(opts.around)} to frame${guess ? `; did you mean "${guess}"?` : ""}`,
      );
    }
    const m = Math.max(opts.margin ?? DEFAULT_MARGIN, 0);
    // A point with no margin still needs an area to draw.
    const w = hit.box.maxX - hit.box.minX < 1 ? 0.5 : 0;
    const h = hit.box.maxY - hit.box.minY < 1 ? 0.5 : 0;
    return [hit.box.minX - m - w, hit.box.minY - m - h, hit.box.maxX + m + w, hit.box.maxY + m + h];
  }
  const [x0, y0, x1, y1] = scene.bounds;
  return [x0, y0, x1, y1];
}

/** Text a renderer prints: two decimals at most, no `-0`. */
export function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Camera regions: areas that hold the camera's framing while a target is inside. */
import { DEFAULT_REGION_EASE } from "../game/defaults";
import { isCameraRegionType } from "../game/primitives";
import type { Registry } from "../game/types";
import { aabb, regionBox } from "../scene/shape-geometry";
import type { RuntimeEntity, ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";

/** A `camera-region` entity as the rig reads it, world metres. */
export type CameraRegion = {
  id: string;
  min: Vec2;
  max: Vec2;
  zoom?: number;
  /** Keep the view inside the box; default true. */
  clamp: boolean;
  /** Seconds to move into the region's framing. */
  ease: number;
};

export { DEFAULT_REGION_EASE };

const contains = (r: CameraRegion, p: Vec2) =>
  p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;

const area = (r: CameraRegion) => (r.max.x - r.min.x) * (r.max.y - r.min.y);

/**
 * The region the camera frames: the one holding the first target, the
 * smallest by area when several do, then the first in scene order; null
 * outside every region.
 */
export function regionFor(
  targets: readonly { at: Vec2 }[],
  regions: readonly CameraRegion[],
): CameraRegion | null {
  const first = targets[0];
  if (!first) return null;
  let best: CameraRegion | null = null;
  for (const r of regions) {
    if (!contains(r, first.at)) continue;
    if (!best || area(r) < area(best)) best = r;
  }
  return best;
}

/**
 * The camera regions among a scene's expanded entities, in scene order:
 * every entity whose type is `camera-region` or based on it.
 */
export function cameraRegionsOf(
  entities: readonly RuntimeEntity[],
  registry: Pick<Registry, "types">,
): CameraRegion[] {
  const out: CameraRegion[] = [];
  for (const e of entities) {
    if (!isCameraRegionType(registry.types.get(e.type))) continue;
    const shape = e.shape as ShapeObj | undefined;
    if (!shape) continue;
    const box = aabb(regionBox(shape));
    const region: CameraRegion = {
      id: e.id,
      min: { x: box.minX, y: box.minY },
      max: { x: box.maxX, y: box.maxY },
      clamp: e.clamp !== false,
      ease: typeof e.ease === "number" ? e.ease : DEFAULT_REGION_EASE,
    };
    if (typeof e.zoom === "number") region.zoom = e.zoom;
    out.push(region);
  }
  return out;
}

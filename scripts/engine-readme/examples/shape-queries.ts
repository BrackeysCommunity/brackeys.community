import {
  aabb,
  createSpatialHash,
  raycastShape,
  shapeAtPose,
  shapesIntersect,
  type ShapeObj,
} from "@jams/engine/scene";

/** A plank's shape in its own frame: 0.8 m long, 0.1 m thick, centred on its origin. */
const plank: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 0.4, hh: 0.05, rotDeg: 0 };

/** Two planks on a workbench: one lying flat, one stood on end by a quarter turn. */
const placed = new Map<string, ShapeObj>([
  ["flat", shapeAtPose(plank, { x: 1, y: 1, rot: 0 })],
  ["upright", shapeAtPose(plank, { x: 3, y: 1, rot: Math.PI / 2 })],
]);

/** What a saw blade at `blade` would cut, and where a laser fired right from `from` lands. */
export function workbench(blade: ShapeObj, from: [number, number]) {
  // Broad phase: boxes in 0.64 m cells; a query returns keys in insertion order.
  const hash = createSpatialHash<string>(0.64);
  for (const [id, shape] of placed) hash.insert(id, aabb(shape));
  const near = hash.query(aabb(blade));
  // Narrow phase, exact: the quarter-turned plank is a 0.1 × 0.8 m box, not a rounded one.
  const cuts = near.filter((id) => shapesIntersect(blade, placed.get(id)!));
  const upright = placed.get("upright")!;
  const laser = raycastShape(upright, from, [1, 0], 4);
  return {
    upright: aabb(upright),
    near,
    cuts,
    laser: laser && { at: from[0] + laser.toi * 4, normal: laser.normal },
  };
}

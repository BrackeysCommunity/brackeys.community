import {
  aabb,
  createSpatialHash,
  raycastShape,
  shapeAtPose,
  shapesIntersect,
  type ShapeObj,
} from "@jams/engine/scene";

/** A plank's shape in its own frame: 80 px long, 10 px thick, centred on its origin. */
const plank: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 40, hh: 5, rotDeg: 0 };

/** Two planks on a workbench: one lying flat, one stood on end by a quarter turn. */
const placed = new Map<string, ShapeObj>([
  ["flat", shapeAtPose(plank, { x: 100, y: 100, rot: 0 })],
  ["upright", shapeAtPose(plank, { x: 300, y: 100, rot: Math.PI / 2 })],
]);

/** What a saw blade at `blade` would cut, and where a laser fired right from `from` lands. */
export function workbench(blade: ShapeObj, from: [number, number]) {
  // Broad phase: boxes in 64 px cells; a query returns keys in insertion order.
  const hash = createSpatialHash<string>(64);
  for (const [id, shape] of placed) hash.insert(id, aabb(shape));
  const near = hash.query(aabb(blade));
  // Narrow phase, exact: the quarter-turned plank is a 10 × 80 box, not a rounded one.
  const cuts = near.filter((id) => shapesIntersect(blade, placed.get(id)!));
  const upright = placed.get("upright")!;
  const laser = raycastShape(upright, from, [1, 0], 400);
  return {
    upright: aabb(upright),
    near,
    cuts,
    laser: laser && { at: from[0] + laser.toi * 400, normal: laser.normal },
  };
}

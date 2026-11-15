import { createRegistry } from "@jams/engine/game";
import {
  applyOps,
  canDecompose,
  decomposeBatch,
  decomposePolygon,
  SCENE_FORMAT_VERSION,
  type Pt,
  type SceneDefinition,
} from "@jams/engine/scene";

/** An L-shaped ledge, in metres: concave, so one convex collider can't hold it. */
export const ledge: Pt[] = [
  [0, 0],
  [3, 0],
  [3, 0.5],
  [1, 0.5],
  [1, 2],
  [0, 2],
];

const cave: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "cave",
  bounds: [-1, -1, 5, 5],
  settings: { physics: "rapier" },
  entities: [{ id: "ledge", type: "solid", shape: ["poly", ...ledge.flat()] }],
};

export function splitLedge() {
  const registry = createRegistry(null);
  const split = decomposePolygon(ledge);
  if (!split.ok) throw new Error(split.issue.message);
  // The same edit the editor's "Split into convex pieces" and `vp run scene decompose` make.
  const batch = decomposeBatch(cave, "ledge", registry, { group: true });
  if (!batch.ok) throw new Error(batch.issue.message);
  const applied = applyOps(cave, batch.batch, registry);
  if (!applied.ok) throw new Error("the batch didn't apply");
  return {
    splits: canDecompose(ledge),
    // A square is already convex, so there's nothing to split.
    squareSplits: canDecompose([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
    pieces: split.pieces,
    area2: split.area2,
    ids: applied.def.entities?.map((e) => `${e.id}${e.parent ? ` in ${e.parent}` : ""}`),
    // A bow tie crosses itself: refused, with nothing written.
    bowTie: decomposePolygon([
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 1],
    ]),
  };
}

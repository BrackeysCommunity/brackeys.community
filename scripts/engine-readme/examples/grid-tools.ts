import {
  cellKey,
  fieldOfView,
  findPath,
  flowField,
  gridGeometry,
  lineOfSight,
  type Cell,
} from "@jams/engine/game";

/** A 12×8 hex board, Tiled's flat-top layout, with a rock wall down column 5 but for its last row. */
const hex = gridGeometry({
  kind: "hex",
  cell: [0.32, 0.28],
  side: 0.16,
  stagger: "x",
  index: "odd",
});
const bounds = { c0: 0, r0: 0, c1: 11, r1: 7 };
const rocks = new Set([0, 1, 2, 3, 4, 5, 6].map((r) => cellKey([5, r])));
const open = (c: Cell) => !rocks.has(cellKey(c));

export function scout() {
  // A*, integer costs (10 a step), the same path on every machine.
  const path = findPath(hex, [1, 1], [9, 1], { passable: open, bounds });
  // Every cell's cost to the nearest goal, and the neighbour to step to: one field, many walkers.
  const field = flowField(hex, [[9, 1]], { passable: open, bounds });
  // What [1, 1] sees within 6 steps; the rocks block sight.
  const seen = fieldOfView(hex, [1, 1], 6, (c) => !open(c));
  return {
    steps: path ? path.cells.length - 1 : null,
    cost: path?.cost ?? null,
    fromCorner: field.cost([0, 7]),
    nextFromCorner: field.next([0, 7]),
    seesAcross: seen.has(cellKey([8, 1])),
    clearShot: lineOfSight(hex, [1, 7], [9, 7], (c) => !open(c)),
    centre: hex.center([9, 1]),
  };
}

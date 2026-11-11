import { buildNavMesh, navContains, navNearest, navPath } from "@jams/engine/game";

type Ring = [number, number][];

/** A room with a table in it, and a corridor stitched on where they share the doorway's two corners. */
const room = {
  id: "room",
  pts: [
    [0, 0],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [0, 3],
  ] as Ring,
};
const corridor = {
  id: "corridor",
  pts: [
    [4, 1],
    [7, 1],
    [7, 2],
    [4, 2],
  ] as Ring,
};
const table = {
  id: "table",
  pts: [
    [1.5, 1],
    [2.5, 1],
    [2.5, 2],
    [1.5, 2],
  ] as Ring,
};

export function walkAround() {
  const { mesh, issues } = buildNavMesh([room, corridor], [table]);
  // The funnel's corners: round the table, through the doorway, to the end of the corridor.
  const path = navPath(mesh, [1, 1.5], [6.5, 1.5]);
  return {
    issues,
    path,
    onTable: navContains(mesh, [2, 1.5]),
    // A click outside the walk areas, moved to the closest walkable point.
    clickedOutside: navNearest(mesh, [5.5, 2.8]),
  };
}

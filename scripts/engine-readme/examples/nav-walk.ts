import { buildNavMesh, navContains, navNearest, navPath } from "@jams/engine/game";

type Ring = [number, number][];

/** A room with a table in it, and a corridor stitched on where they share the doorway's two corners. */
const room = {
  id: "room",
  pts: [
    [0, 0],
    [400, 0],
    [400, 100],
    [400, 200],
    [400, 300],
    [0, 300],
  ] as Ring,
};
const corridor = {
  id: "corridor",
  pts: [
    [400, 100],
    [700, 100],
    [700, 200],
    [400, 200],
  ] as Ring,
};
const table = {
  id: "table",
  pts: [
    [150, 100],
    [250, 100],
    [250, 200],
    [150, 200],
  ] as Ring,
};

export function walkAround() {
  const { mesh, issues } = buildNavMesh([room, corridor], [table]);
  // The funnel's corners: round the table, through the doorway, to the end of the corridor.
  const path = navPath(mesh, [100, 150], [650, 150]);
  return {
    issues,
    path,
    onTable: navContains(mesh, [200, 150]),
    // A click outside the walk areas, moved to the closest walkable point.
    clickedOutside: navNearest(mesh, [550, 280]),
  };
}

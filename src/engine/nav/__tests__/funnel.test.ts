// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { polygonSide } from "../../scene/shape-geometry";
import type { Pt } from "../../scene/types";
import { funnel } from "../funnel";
import { buildNavMesh, navPath } from "../navmesh";

describe("funnel", () => {
  it("goes straight through portals that don't bend it", () => {
    expect(
      funnel(
        [0, 0],
        [30, 0],
        [
          { left: [10, 5], right: [10, -5] },
          { left: [20, 5], right: [20, -5] },
        ],
      ),
    ).toEqual([
      [0, 0],
      [30, 0],
    ]);
  });

  it("bends around the corners that pinch it", () => {
    // A corridor stepping up (y-up): the walk bends round its inner corners.
    expect(
      funnel(
        [0, 0],
        [30, 20],
        [
          { left: [10, 10], right: [10, -5] },
          { left: [20, 40], right: [20, 25] },
        ],
      ),
    ).toEqual([
      [0, 0],
      [10, 10],
      [20, 25],
      [30, 20],
    ]);
    expect(
      funnel(
        [0, 0],
        [30, -30],
        [
          { left: [10, 10], right: [10, -5] },
          { left: [20, 10], right: [20, -5] },
        ],
      ),
    ).toEqual([
      [0, 0],
      [20, -5],
      [30, -30],
    ]);
  });

  it("returns from and to alone with no portals", () => {
    expect(funnel([1, 2], [3, 4], [])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("navPath through an L-shaped room around a pillar", () => {
  const room: Pt[] = [
    [0, 0],
    [100, 0],
    [100, 40],
    [40, 40],
    [40, 100],
    [0, 100],
  ];
  const pillar: Pt[] = [
    [50, 25],
    [60, 15],
    [70, 25],
    [70, 39],
    [50, 39],
  ];
  const { mesh, issues } = buildNavMesh(
    [{ id: "room", pts: room }],
    [{ id: "pillar", pts: pillar }],
  );

  it("hugs the pillar's corners and the room's inner corner", () => {
    expect(issues).toEqual([]);
    expect(navPath(mesh, [90, 5], [20, 90])).toEqual([
      [90, 5],
      [60, 15],
      [50, 25],
      [40, 40],
      [20, 90],
    ]);
  });

  it("walks back the same way", () => {
    expect(navPath(mesh, [20, 90], [90, 5])).toEqual([
      [20, 90],
      [40, 40],
      [50, 25],
      [60, 15],
      [90, 5],
    ]);
  });

  it("keeps every leg inside the room and out of the pillar", () => {
    const path = navPath(mesh, [95, 2], [5, 95])!;
    for (let i = 1; i < path.length; i++) {
      for (let k = 1; k < 10; k++) {
        const [ax, ay] = path[i - 1]!;
        const [bx, by] = path[i]!;
        const p: Pt = [ax + ((bx - ax) * k) / 10, ay + ((by - ay) * k) / 10];
        expect(polygonSide(p, room)).not.toBe(-1);
        expect(polygonSide(p, pillar)).not.toBe(1);
      }
    }
  });
});

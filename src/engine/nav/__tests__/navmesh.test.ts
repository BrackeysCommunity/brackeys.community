// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { Pt } from "../../scene/types";
import { buildNavMesh, navContains, navNearest, navPath } from "../navmesh";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe("buildNavMesh", () => {
  it("stitches areas that share an edge's exact endpoints", () => {
    const { mesh, issues } = buildNavMesh(
      [
        { id: "west", pts: rect(0, 0, 10, 10) },
        { id: "east", pts: rect(10, 0, 20, 10) },
      ],
      [],
    );
    expect(issues).toEqual([]);
    expect(mesh.triangles).toHaveLength(4);
    expect(mesh.areaOf).toEqual(["west", "west", "east", "east"]);
    const across = mesh.neighbors.some((ns, i) =>
      ns.some((j) => mesh.areaOf[i] === "west" && mesh.areaOf[j] === "east"),
    );
    expect(across).toBe(true);
    for (const [i, ns] of mesh.neighbors.entries()) {
      for (const j of ns) expect(mesh.neighbors[j]).toContain(i);
    }
    expect(navPath(mesh, [2, 5], [18, 5])).toEqual([
      [2, 5],
      [18, 5],
    ]);
  });

  it("leaves areas apart when their shared edge's corners don't match", () => {
    const { mesh } = buildNavMesh(
      [
        { id: "west", pts: rect(0, 0, 10, 10) },
        { id: "east", pts: rect(10, 5, 20, 15) },
      ],
      [],
    );
    expect(mesh.neighbors.flat().every((j) => mesh.areaOf[j] !== "east")).toBe(false);
    const westToEast = mesh.neighbors.some((ns, i) =>
      ns.some((j) => mesh.areaOf[i] === "west" && mesh.areaOf[j] === "east"),
    );
    expect(westToEast).toBe(false);
    expect(navPath(mesh, [2, 7], [18, 7])).toBeNull();
  });

  it("gives null between disconnected areas and for points off the mesh", () => {
    const { mesh } = buildNavMesh(
      [
        { id: "a", pts: rect(0, 0, 10, 10) },
        { id: "b", pts: rect(30, 0, 40, 10) },
      ],
      [],
    );
    expect(navPath(mesh, [5, 5], [35, 5])).toBeNull();
    expect(navPath(mesh, [5, 5], [20, 5])).toBeNull();
    expect(navPath(mesh, [1, 1], [9, 9])).toEqual([
      [1, 1],
      [9, 9],
    ]);
  });

  it("paths around a hole", () => {
    const { mesh, issues } = buildNavMesh(
      [{ id: "room", pts: rect(0, 0, 100, 100) }],
      [{ id: "pillar", pts: rect(40, 30, 60, 80) }],
    );
    expect(issues).toEqual([]);
    expect(navContains(mesh, [50, 50])).toBe(false);
    expect(navPath(mesh, [20, 50], [80, 50])).toEqual([
      [20, 50],
      [40, 30],
      [60, 30],
      [80, 50],
    ]);
    expect(navPath(mesh, [80, 50], [20, 50])).toEqual([
      [80, 50],
      [60, 30],
      [40, 30],
      [20, 50],
    ]);
  });

  it("reports and leaves out polygons that break the walk rules", () => {
    const bowtie: Pt[] = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ];
    const { mesh, issues } = buildNavMesh(
      [
        { id: "room", pts: rect(0, 0, 100, 100) },
        { id: "over", pts: rect(50, 50, 150, 150) },
        { id: "knot", pts: bowtie.map(([x, y]): Pt => [x + 200, y]) },
      ],
      [
        { id: "out", pts: rect(300, 0, 310, 10) },
        { id: "edge", pts: rect(0, 10, 10, 20) },
        { id: "ok", pts: rect(20, 20, 30, 30) },
        { id: "clash", pts: rect(25, 25, 35, 35) },
      ],
    );
    expect(issues.map((i) => i.entityIds)).toEqual([
      ["room", "over"],
      ["knot"],
      ["out"],
      ["edge"],
      ["ok", "clash"],
    ]);
    expect(new Set(mesh.areaOf)).toEqual(new Set(["room"]));
    expect(navContains(mesh, [25, 25])).toBe(false);
    expect(navContains(mesh, [32, 32])).toBe(true);
  });
});

describe("navContains / navNearest", () => {
  const { mesh } = buildNavMesh(
    [
      {
        id: "l",
        pts: [
          [0, 0],
          [100, 0],
          [100, 40],
          [40, 40],
          [40, 100],
          [0, 100],
        ],
      },
    ],
    [],
  );

  it("counts edges and corners as on the mesh", () => {
    expect(navContains(mesh, [0, 0])).toBe(true);
    expect(navContains(mesh, [70, 40])).toBe(true);
    expect(navContains(mesh, [20, 20])).toBe(true);
    expect(navContains(mesh, [70, 70])).toBe(false);
    expect(navContains(mesh, [-1, 5])).toBe(false);
  });

  it("returns the point itself on the mesh and the closest outline point off it", () => {
    expect(navNearest(mesh, [20, 20])).toEqual([20, 20]);
    expect(navNearest(mesh, [70, 50])).toEqual([70, 40]);
    expect(navNearest(mesh, [120, -10])).toEqual([100, 0]);
    expect(navNearest(mesh, [55, 60])).toEqual([40, 60]);
  });

  it("paths from a nearest point back onto the mesh", () => {
    const off: Pt = [73.3, 61.7];
    const near = navNearest(mesh, off);
    expect(navPath(mesh, near, [10, 90])).not.toBeNull();
  });

  it("has nothing to offer when empty", () => {
    const empty = buildNavMesh([], []).mesh;
    expect(navContains(empty, [0, 0])).toBe(false);
    expect(navNearest(empty, [3, 4])).toEqual([3, 4]);
    expect(navPath(empty, [0, 0], [1, 1])).toBeNull();
  });
});

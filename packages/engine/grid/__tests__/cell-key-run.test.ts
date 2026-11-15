import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_TILE_COST } from "../../project/kinds/tileset";
import { cellKey, cellKeyRun, DIAGONAL_COST, EDGE_COST, gridGeometry } from "../geometry";

describe("cellKeyRun", () => {
  it("gives each cell's key along the row, and throws when the run leaves the key range", () => {
    expect(cellKeyRun(-2, 5, 3)).toEqual([cellKey([-2, 5]), cellKey([-1, 5]), cellKey([0, 5])]);
    expect(cellKeyRun(3, 3, 0)).toEqual([]);
    expect(() => cellKeyRun(2 ** 20 - 2, 0, 3)).toThrow(RangeError);
  });
});

describe("path costs", () => {
  it("step and estimate in edge and diagonal costs, a plain tile costing one edge step", () => {
    const geo = gridGeometry({ kind: "square", cell: [1, 1] });
    expect(geo.stepCost([0, 0], [1, 0])).toBe(EDGE_COST);
    expect(geo.stepCost([0, 0], [1, 1])).toBe(DIAGONAL_COST);
    expect(geo.heuristic([0, 0], [3, 1])).toBe(2 * EDGE_COST + DIAGONAL_COST);
    expect(DEFAULT_TILE_COST).toBe(EDGE_COST);
  });
});

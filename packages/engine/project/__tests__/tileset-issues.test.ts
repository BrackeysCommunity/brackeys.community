import { describe, expect, it } from "vite-plus/test";

import { encodeRow, type GridCells } from "../../scene/grid";
import { tilePlacement } from "../../systems/tilemap";
import { DEFAULT_TILE_COST } from "../../tiles/chunks";
import { tileOffset } from "../../tiles/mesh";
import { tilemapIssues, tilesetSchema, type TilesetFile } from "../kinds/tileset";

const sheet: TilesetFile = { kind: "tileset", v: 1, image: "sheet", tile: [25, 25], columns: 2 };

describe("tileset cost", () => {
  it("accepts a step's cost and dearer, and refuses a cheaper one", () => {
    const withCost = (cost: number) => ({ ...sheet, tiles: [{ id: 0, cost }] });
    expect(tilesetSchema.safeParse(withCost(DEFAULT_TILE_COST)).success).toBe(true);
    expect(tilesetSchema.safeParse(withCost(30)).success).toBe(true);
    expect(tilesetSchema.safeParse(withCost(5)).success).toBe(false);
    expect(tilesetSchema.safeParse(withCost(0)).success).toBe(false);
  });
});

describe("tilemapIssues tile-unknown", () => {
  it("reports the row-major first cell even when a later chunk holds it", () => {
    const cells: GridCells = {
      "0,0": ["", encodeRow([5])],
      "1,0": [encodeRow([5])],
    };
    const issues = tilemapIssues(
      { id: "floor", tileset: "sheet", cells },
      sheet,
      {
        size: [50, 25],
      },
      null,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("cell (32, 0)");
  });
});

describe("tilemap at", () => {
  it("snaps an at between cells to the nearest cell", () => {
    const grid = { kind: "square" as const, cell: [0.25, 0.25] as [number, number] };
    expect(tilePlacement(grid, [0.1, 0], [1, 1]).offset).toEqual([0, 0]);
    expect(tilePlacement(grid, [0.15, -0.3], [1, 1]).offset).toEqual([1, -1]);
    expect(tileOffset(grid, [0.1, 0])).toEqual([0, 0]);
    expect(tileOffset(grid, [0.15, -0.3])).toEqual([1, -1]);
  });
});

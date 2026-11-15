import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { tileOffset } from "../../tiles/mesh";
import { sceneAsciiMap } from "../ascii";
import { tilemapGridCell } from "../render-geometry";
import { renderSceneSvg } from "../svg";
import { SCENE_FORMAT_VERSION, type GridSettings, type Pt, type SceneDefinition } from "../types";

const registry = createRegistry();
const square: GridSettings = { kind: "square", cell: [0.32, 0.32] };
const hex: GridSettings = {
  kind: "hex",
  cell: [0.32, 0.32],
  side: 0.16,
  stagger: "y",
  index: "odd",
};

const mapScene = (at: Pt, rows: string[], grid: GridSettings = square): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "tiles",
  bounds: [0, 0, 10.24, 7.68],
  settings: { grid },
  entities: [{ id: "map", type: "tilemap", at, tileset: "ts", cells: { "0,0": rows } }],
});

const cellTag = (svg: string, cell: string) =>
  new RegExp(`data-cell="${cell}"[^>]*/>`).exec(svg)?.[0] ?? "";

describe("tilemapGridCell", () => {
  it("picks the cell tileOffset does on square grids and every hex layout", () => {
    const grids: GridSettings[] = [
      square,
      { kind: "square", cell: [0.25, 0.5], origin: [0.1, -0.3] },
      ...(["x", "y"] as const).flatMap((stagger) =>
        (["odd", "even"] as const).map(
          (index): GridSettings => ({
            kind: "hex",
            cell: [0.32, 0.28],
            side: 0.14,
            stagger,
            index,
            origin: [0.05, 0.11],
          }),
        ),
      ),
    ];
    for (const grid of grids)
      for (let i = -40; i <= 40; i++)
        for (let j = -40; j <= 40; j++) {
          const at: Pt = [i * 0.037, j * 0.041];
          expect(tilemapGridCell(grid, at), JSON.stringify({ grid, at })).toEqual(
            tileOffset(grid, at),
          );
        }
  });
});

describe("schematic renders of a tilemap between cells", () => {
  it("draw its cells on the grid cell its at snaps to, as the runtime places them", () => {
    expect(tileOffset(square, [0.75, 0.6])).toEqual([2, 2]);
    const svg = renderSceneSvg(mapScene([0.75, 0.6], ["1,1"]), { registry });
    expect(cellTag(svg, "0,0")).toMatch(/x="64" y="64" width="32" height="32"/);
    expect(cellTag(svg, "1,0")).toMatch(/x="96" y="64"/);
  });

  it("stagger a hex map whose at is an odd row by the grid's own row parity", () => {
    const svg = renderSceneSvg(mapScene([0.16, 0.24], ["1", "1"], hex), { registry });
    expect(cellTag(svg, "0,0")).toContain('d="M32 24L48 32L48 48L32 56L16 48L16 32Z"');
    expect(cellTag(svg, "0,1")).toContain('d="M16 48L32 56L32 72L16 80L0 72L0 56Z"');
  });

  it("put the ascii map's tiles where an on-cell map's are", () => {
    const grid: GridSettings = { kind: "square", cell: [0.64, 0.64] };
    const tiles = (at: Pt) =>
      sceneAsciiMap(mapScene(at, ["1,1,1,1", "1,1,1,1"], grid), { registry }).lines.slice(2, 4);
    expect(tiles([0.95, 0.95])).toEqual(tiles([0.64, 0.64]));
    expect(tiles([0.64, 0.64])[0]!.slice(0, 6)).toBe(".::::.");
  });
});

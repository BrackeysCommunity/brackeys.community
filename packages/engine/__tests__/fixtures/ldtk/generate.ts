/**
 * Writes the LDtk sample (`sample.ldtk`, `tiles.png`): a small world in
 * LDtk 1.5's JSON shape, made by this script, CC0-1.0 (see README.md).
 * Run with `bun packages/engine/__tests__/fixtures/ldtk/generate.ts`.
 */
import { swatchPng } from "../../../tiles/import-ldtk";

export const SAMPLE_TILE_COLORS = ["#3b7d3b", "#8b5a2b", "#5a6b7d", "#d8c070"];

/** The sample's tileset image: four 8 px tiles in one row. */
export const sampleTilesPng = (): Uint8Array => swatchPng(SAMPLE_TILE_COLORS, 8);

/** Two 4 × 3 levels of 8 px cells: IntGrid with and without auto tiles, a tile layer, entities. */
export function sampleWorld(): Record<string, unknown> {
  const intGridValues = [
    { value: 1, identifier: "wall", color: "#404040" },
    { value: 2, identifier: "water", color: "#2060c0" },
  ];
  const layerDefs = [
    { uid: 1, identifier: "Things", type: "Entities", gridSize: 8 },
    { uid: 2, identifier: "Decor", type: "Tiles", gridSize: 8, tilesetDefUid: 10 },
    { uid: 3, identifier: "Collisions", type: "IntGrid", gridSize: 8, intGridValues },
    {
      uid: 4,
      identifier: "Ground",
      type: "IntGrid",
      gridSize: 8,
      intGridValues,
      autoTilesetDefUid: 10,
    },
  ];
  const base = { __cWid: 4, __cHei: 3, __gridSize: 8, __pxTotalOffsetX: 0, __pxTotalOffsetY: 0 };
  const entities = {
    ...base,
    __identifier: "Things",
    __type: "Entities",
    layerDefUid: 1,
    entityInstances: [
      {
        __identifier: "PlayerStart",
        iid: "aa11",
        px: [12, 20],
        width: 8,
        height: 16,
        fieldInstances: [
          { __identifier: "lives", __type: "Int", __value: 3 },
          { __identifier: "facing", __type: "String", __value: "left" },
        ],
      },
      {
        __identifier: "Coin",
        iid: "bb22",
        px: [28, 4],
        width: 8,
        height: 8,
        fieldInstances: [],
      },
      {
        __identifier: "Coin",
        iid: "cc33",
        px: [20, 4],
        width: 8,
        height: 8,
        fieldInstances: [{ __identifier: "value", __type: "Int", __value: 5 }],
      },
    ],
  };
  const decor = {
    ...base,
    __identifier: "Decor",
    __type: "Tiles",
    __tilesetDefUid: 10,
    layerDefUid: 2,
    gridTiles: [
      { px: [0, 0], src: [0, 0], f: 0, t: 0 },
      { px: [8, 0], src: [8, 0], f: 1, t: 1 },
      { px: [16, 8], src: [16, 0], f: 3, t: 2 },
    ],
  };
  const collisions = {
    ...base,
    __identifier: "Collisions",
    __type: "IntGrid",
    layerDefUid: 3,
    intGridCsv: [0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 1, 1],
    autoLayerTiles: [],
  };
  const ground = {
    ...base,
    __identifier: "Ground",
    __type: "IntGrid",
    __tilesetDefUid: 10,
    layerDefUid: 4,
    intGridCsv: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
    autoLayerTiles: [0, 1, 2, 3].map((c) => ({ px: [c * 8, 16], src: [24, 0], f: 0, t: 3 })),
  };
  const level = (uid: number, identifier: string, layerInstances: unknown[]) => ({
    uid,
    identifier,
    iid: `level-${uid}`,
    pxWid: 32,
    pxHei: 24,
    worldX: 0,
    worldY: 0,
    fieldInstances: [],
    layerInstances,
  });
  return {
    jsonVersion: "1.5.3",
    defs: {
      layers: layerDefs,
      entities: [
        { uid: 20, identifier: "PlayerStart" },
        { uid: 21, identifier: "Coin" },
      ],
      tilesets: [
        {
          uid: 10,
          identifier: "Terrain",
          relPath: "tiles.png",
          pxWid: 32,
          pxHei: 8,
          tileGridSize: 8,
          spacing: 0,
          padding: 0,
          __cWid: 4,
          __cHei: 1,
          customData: [
            { tileId: 3, data: '{"grass":true}' },
            { tileId: 1, data: "plank" },
          ],
          enumTags: [{ enumValueId: "Solid", tileIds: [3] }],
        },
      ],
    },
    levels: [
      level(100, "Level_0", [entities, decor, collisions, ground]),
      level(101, "Level_1", [collisions]),
      { uid: 102, identifier: "Far_Away", pxWid: 32, pxHei: 24, externalRelPath: "far.ldtkl" },
    ],
  };
}

export const sampleText = (): string => `${JSON.stringify(sampleWorld(), null, 2)}\n`;

if (import.meta.main) {
  const { writeFileSync } = await import("node:fs");
  const dir = new URL(".", import.meta.url);
  writeFileSync(new URL("sample.ldtk", dir), sampleText());
  writeFileSync(new URL("tiles.png", dir), sampleTilesPng());
}

import { decodeCell, FLIP_X, importTiled } from "@jams/engine/game";
import { projectView } from "@jams/engine/project";
import { readCell, type GridCells } from "@jams/engine/scene";

const empty = projectView({
  meta: { projectId: "cave", layout: 1, name: "Cave" },
  assets: {},
  history: {},
  code: {},
  build: {},
});

/** A 4×2 Tiled map with its tileset embedded: a floor, its last tile mirrored (Tiled's H flag). */
export const caveMap = {
  type: "map",
  orientation: "orthogonal",
  width: 4,
  height: 2,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [
    {
      firstgid: 1,
      name: "cave",
      image: "cave.png",
      tilewidth: 16,
      tileheight: 16,
      tilecount: 8,
      columns: 4,
      tiles: [{ id: 0, class: "rock" }],
    },
  ],
  layers: [
    {
      type: "tilelayer",
      name: "floor",
      width: 4,
      height: 2,
      data: [0, 0, 0, 0, 1, 1, 2, 0x80000000 | 2],
    },
  ],
};

/** Imports the map into scene `cave` as one batch, then tries it as an isometric map. */
export function importCave() {
  const opts = {
    scene: "cave",
    project: empty,
    pxPerMetre: 16,
    images: new Map([["cave.png", { sha256: "c".repeat(64), bytes: 120 }]]),
  };
  const { ops, notes } = importTiled(caveMap, new Map(), opts);
  const edit = ops.at(-1);
  const floor =
    edit?.op === "editScene"
      ? edit.ops.flatMap((o) => (o.op === "add" && o.entity.type === "tilemap" ? [o.entity] : []))
      : [];
  const cells = floor[0]?.cells as GridCells | undefined;
  const last = cells ? readCell(cells, 3, 1) : 0;
  const isometric = importTiled({ ...caveMap, orientation: "isometric" }, new Map(), opts);
  return {
    ops: ops.map((o) => o.op),
    warnings: notes.length,
    lastTile: decodeCell(last)?.id,
    mirrored: (last & FLIP_X) !== 0,
    refused: isometric.ops.length === 0 && isometric.notes.map((n) => n.code),
  };
}

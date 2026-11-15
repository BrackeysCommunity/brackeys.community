/**
 * Writes the docs' sample Tiled map beside this file: `cave.tmj`, an 8×4
 * cave, and its tileset image `cave.png`, four flat 16 px tiles (stone,
 * moss, and the lamp's two frames). Generated here, never downloaded
 * (licence: CC0-1.0, see LICENCE.txt). Run
 * `bun scripts/scene/examples/tiles/generate.ts`; readme-examples.test.ts
 * checks the committed files still match.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const TILE_PX = 16;
const FLIP_H = 0x80000000;

/** Stone, moss, the lamp's dim frame, the lamp's lit frame. */
const TILE_RGBA: readonly (readonly [number, number, number, number])[] = [
  [90, 90, 100, 255],
  [70, 140, 60, 255],
  [150, 110, 60, 255],
  [230, 200, 90, 255],
];

const STONE = 1;
const MOSS = 2;
const LAMP = 4;

export const CAVE_MAP = {
  type: "map",
  version: "1.10",
  tiledversion: "1.11.0",
  orientation: "orthogonal",
  renderorder: "right-down",
  infinite: false,
  width: 8,
  height: 4,
  tilewidth: TILE_PX,
  tileheight: TILE_PX,
  nextlayerid: 2,
  nextobjectid: 1,
  tilesets: [
    {
      firstgid: 1,
      name: "cave-tiles",
      image: "cave.png",
      imagewidth: TILE_PX * TILE_RGBA.length,
      imageheight: TILE_PX,
      tilewidth: TILE_PX,
      tileheight: TILE_PX,
      tilecount: TILE_RGBA.length,
      columns: TILE_RGBA.length,
      margin: 0,
      spacing: 0,
      tiles: [
        {
          id: 0,
          class: "stone",
          objectgroup: {
            type: "objectgroup",
            objects: [{ id: 1, x: 0, y: 0, width: TILE_PX, height: TILE_PX }],
          },
        },
        { id: 1, class: "moss" },
        {
          id: 3,
          class: "lamp",
          animation: [
            { tileid: 3, duration: 250 },
            { tileid: 2, duration: 250 },
          ],
        },
      ],
    },
  ],
  layers: [
    {
      id: 1,
      type: "tilelayer",
      name: "ground",
      width: 8,
      height: 4,
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      // An open row, a lamp, a row of moss, and a stone floor whose last tile is flipped.
      data: [
        ...Array<number>(8).fill(0),
        ...Array<number>(3).fill(0),
        LAMP,
        ...Array<number>(4).fill(0),
        ...Array<number>(8).fill(MOSS),
        ...Array<number>(7).fill(STONE),
        (STONE | FLIP_H) >>> 0,
      ],
    },
  ],
};

export const caveMapText = (): string => `${JSON.stringify(CAVE_MAP, null, 2)}\n`;

const u32 = (n: number): number[] => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, body: Uint8Array): number[] {
  const typed = Uint8Array.from([...type].map((c) => c.charCodeAt(0)).concat(...body));
  return [...u32(body.length), ...typed, ...u32(crc32(typed))];
}

/** A zlib stream of one stored (uncompressed) deflate block; `raw` must fit in 65 535 bytes. */
function storedZlib(raw: Uint8Array): Uint8Array {
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  const n = raw.length;
  return Uint8Array.from([
    0x78,
    0x01,
    1,
    n & 0xff,
    n >>> 8,
    ~n & 0xff,
    (~n >>> 8) & 0xff,
    ...raw,
    ...u32(((b << 16) | a) >>> 0),
  ]);
}

/**
 * The tileset image: one row of flat RGBA tiles, stored uncompressed so every runtime writes the
 * same bytes. Written here rather than with the engine's PNG writer because scripts/scene may only
 * import the engine's public entries.
 */
export function cavePng(): Uint8Array {
  const width = TILE_PX * TILE_RGBA.length;
  const height = TILE_PX;
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      raw.set(TILE_RGBA[Math.floor(x / TILE_PX)]!, y * stride + 1 + x * 4);
  const header = Uint8Array.from([...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", header),
    ...chunk("IDAT", storedZlib(raw)),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

if (import.meta.main) {
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, "cave.tmj"), caveMapText());
  writeFileSync(join(here, "cave.png"), cavePng());
}

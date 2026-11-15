/**
 * Writes the Tiled JSON fixtures beside this file: small maps made for the
 * importer's tests, generated here and never downloaded (licence: CC0-1.0).
 * Run `bun packages/engine/__tests__/fixtures/tiled/generate.ts`; the test
 * checks the committed files still match.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const H = 0x80000000;
const V = 0x40000000;
const D = 0x20000000;

const base64 = (gids: number[]): string => {
  const bytes = Buffer.alloc(gids.length * 4);
  gids.forEach((g, i) => bytes.writeUInt32LE(g >>> 0, i * 4));
  return bytes.toString("base64");
};

const terrain = {
  type: "tileset",
  version: "1.10",
  tiledversion: "1.11.0",
  name: "Terrain",
  image: "terrain.png",
  imagewidth: 64,
  imageheight: 32,
  tilewidth: 16,
  tileheight: 16,
  margin: 0,
  spacing: 0,
  columns: 4,
  tilecount: 8,
  tiles: [
    {
      id: 1,
      type: "ground",
      properties: [
        { name: "friction", type: "float", value: 0.5 },
        { name: "label", type: "string", value: "stone" },
      ],
      objectgroup: {
        type: "objectgroup",
        objects: [{ id: 1, x: 0, y: 8, width: 16, height: 8, rotation: 0 }],
      },
    },
    {
      id: 2,
      animation: [
        { tileid: 2, duration: 100 },
        { tileid: 3, duration: 150 },
      ],
    },
    {
      id: 5,
      objectgroup: {
        type: "objectgroup",
        objects: [
          {
            id: 1,
            x: 0,
            y: 16,
            polygon: [
              { x: 0, y: 0 },
              { x: 16, y: -16 },
              { x: 16, y: 0 },
            ],
          },
        ],
      },
    },
  ],
};

const props = {
  firstgid: 9,
  name: "Props",
  image: "props.png",
  imagewidth: 32,
  imageheight: 16,
  tilewidth: 16,
  tileheight: 16,
  columns: 2,
  tilecount: 2,
  tiles: [{ id: 1, properties: [{ name: "pickup", type: "bool", value: true }] }],
};

const sample = {
  type: "map",
  version: "1.10",
  orientation: "orthogonal",
  renderorder: "right-down",
  infinite: false,
  width: 4,
  height: 3,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [{ firstgid: 1, source: "terrain.tsj" }, props],
  layers: [
    {
      id: 1,
      type: "tilelayer",
      name: "Ground",
      width: 4,
      height: 3,
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      data: [0, 0, 3, 0, 2 | H, 2 | V, 2 | D, 2 | H | V | D, 2, 2, 6, 10],
    },
    {
      id: 2,
      type: "group",
      name: "Back",
      opacity: 0.5,
      visible: true,
      layers: [
        {
          id: 3,
          type: "tilelayer",
          name: "Detail",
          width: 4,
          height: 3,
          opacity: 1,
          visible: false,
          offsetx: 16,
          offsety: 0,
          encoding: "base64",
          data: base64([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4 | H]),
        },
      ],
    },
    {
      id: 4,
      type: "objectgroup",
      name: "Things",
      opacity: 1,
      visible: true,
      objects: [
        {
          id: 1,
          name: "start",
          type: "spawn",
          point: true,
          x: 24,
          y: 8,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
          properties: [{ name: "facing", type: "string", value: "left" }],
        },
        {
          id: 2,
          name: "goal",
          type: "exit",
          x: 32,
          y: 16,
          width: 16,
          height: 32,
          rotation: 0,
          visible: true,
          properties: [
            { name: "next", type: "string", value: "two" },
            { name: "score", type: "int", value: 3 },
          ],
        },
        { id: 3, name: "round", ellipse: true, x: 0, y: 0, width: 8, height: 8, rotation: 0 },
      ],
    },
    { id: 5, type: "imagelayer", name: "Sky", image: "back.png", opacity: 1, visible: true },
  ],
};

/** Two 16×16 chunks, one at negative coordinates: they land in grid chunks (-1,-1) and (0,0). */
const infinite = {
  type: "map",
  orientation: "orthogonal",
  infinite: true,
  width: 16,
  height: 16,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [{ firstgid: 1, source: "terrain.tsj" }],
  layers: [
    {
      id: 1,
      type: "tilelayer",
      name: "Ground",
      startx: -16,
      starty: -16,
      width: 32,
      height: 32,
      opacity: 1,
      visible: true,
      chunks: [
        {
          x: -16,
          y: -16,
          width: 16,
          height: 16,
          data: Array.from({ length: 256 }, (_, i) => (i === 255 ? 2 : i === 0 ? 3 | H : 0)),
        },
        {
          x: 0,
          y: 0,
          width: 16,
          height: 16,
          data: Array.from({ length: 256 }, (_, i) => (i % 17 === 0 ? 1 : 0)),
        },
      ],
    },
  ],
};

const hexMap = (staggeraxis: "x" | "y", staggerindex: "odd" | "even") => ({
  type: "map",
  orientation: "hexagonal",
  infinite: false,
  width: 3,
  height: 3,
  tilewidth: 28,
  tileheight: 32,
  hexsidelength: 16,
  staggeraxis,
  staggerindex,
  tilesets: [
    {
      firstgid: 1,
      name: "Hexes",
      image: "hexes.png",
      imagewidth: 56,
      imageheight: 32,
      tilewidth: 28,
      tileheight: 32,
      columns: 2,
      tilecount: 2,
    },
  ],
  layers: [
    {
      id: 1,
      type: "tilelayer",
      name: "Floor",
      width: 3,
      height: 3,
      opacity: 1,
      visible: true,
      data: [1, 2, 1, 2, 1 | H, 2, 1, 2, 1 | D],
    },
  ],
});

const isometric = {
  type: "map",
  orientation: "isometric",
  width: 2,
  height: 2,
  tilewidth: 32,
  tileheight: 16,
  tilesets: [],
  layers: [],
};

export const TILED_FIXTURES: Readonly<Record<string, unknown>> = {
  "terrain.tsj": terrain,
  "sample.tmj": sample,
  "infinite.tmj": infinite,
  "hex-y-odd.tmj": hexMap("y", "odd"),
  "hex-x-even.tmj": hexMap("x", "even"),
  "isometric.tmj": isometric,
};

export const fixtureText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

if (import.meta.main) {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const [name, value] of Object.entries(TILED_FIXTURES))
    writeFileSync(join(here, name), fixtureText(value));
}

/**
 * Generates the tactics game's art: `units.png` with its Aseprite JSON
 * (`units.json`, the hash export), `tiles.png` (the grass) and one
 * `tile-<kind>.png` per obstacle (walls, marsh, thicket). Each picture is pixel art
 * drawn on a 16 px grid and written at 3 px per art pixel, so one 48 px cell
 * is one metre at the game's px per metre. The PNGs are palette images whose
 * zlib stream uses stored blocks only, so the bytes are the same on every
 * runtime; rerunning this reproduces the committed files exactly.
 *
 *   bun src/games/tactics/art/make-art.ts [out-dir]
 *
 * It runs under Bun only: game code imports no Node built-ins, so it writes
 * through `Bun.write`.
 * New or changed files go into the project through `vp run scene assets import`.
 */

/** Screen px per art pixel. */
export const ART_SCALE = 3;
/** One frame or tile, art px. */
const ART_CELL = 16;
/** One frame or tile, screen px: one board cell. */
export const CELL_PX = ART_CELL * ART_SCALE;

type Rgb = number;
type Picture = { width: number; height: number; palette: readonly Rgb[]; pixels: Uint8Array };

// ─── PNG ─────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts)
    for (const byte of part) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) =>
  new Uint8Array([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A zlib stream of stored (uncompressed) deflate blocks: no compressor, so no runtime differences. */
function zlibStored(data: Uint8Array): Uint8Array {
  const MAX = 0xffff;
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let at = 0;
  do {
    const len = Math.min(MAX, data.length - at);
    const last = at + len >= data.length ? 1 : 0;
    parts.push(new Uint8Array([last, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff]));
    parts.push(data.subarray(at, at + len));
    at += len;
  } while (at < data.length);
  parts.push(u32(adler32(data)));
  return concat(parts);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  return concat([u32(data.length), name, data, u32(crc32([name, data]))]);
}

/** An 8-bit palette PNG; palette index 0 is fully transparent. */
export function encodePng(pic: Picture): Uint8Array {
  const { width, height, palette, pixels } = pic;
  const header = concat([u32(width), u32(height), new Uint8Array([8, 3, 0, 0, 0])]);
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((rgb, i) => {
    plte[i * 3] = (rgb >>> 16) & 0xff;
    plte[i * 3 + 1] = (rgb >>> 8) & 0xff;
    plte[i * 3 + 2] = rgb & 0xff;
  });
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", plte),
    chunk("tRNS", new Uint8Array([0])),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// ─── Drawing ─────────────────────────────────────────────

function blank(cols: number, rows: number, palette: readonly Rgb[]): Picture {
  const width = cols * CELL_PX;
  const height = rows * CELL_PX;
  return { width, height, palette, pixels: new Uint8Array(width * height) };
}

/** Paints one art pixel (a `ART_SCALE` square) at art coordinates. */
function plot(pic: Picture, ax: number, ay: number, index: number): void {
  for (let dy = 0; dy < ART_SCALE; dy++)
    for (let dx = 0; dx < ART_SCALE; dx++)
      pic.pixels[(ay * ART_SCALE + dy) * pic.width + ax * ART_SCALE + dx] = index;
}

/** Paints a 16 × 16 character map into the cell at `col`, one character per art pixel; `.` stays empty. */
function stamp(
  pic: Picture,
  col: number,
  map: readonly string[],
  key: Readonly<Record<string, number>>,
): void {
  if (map.length !== ART_CELL) throw new Error(`a map has ${map.length} rows, not ${ART_CELL}`);
  map.forEach((line, y) => {
    if (line.length !== ART_CELL) throw new Error(`map row ${y} is ${line.length} wide`);
    for (let x = 0; x < ART_CELL; x++) {
      const ch = line[x] ?? ".";
      if (ch === ".") continue;
      const index = key[ch];
      if (index === undefined) throw new Error(`map row ${y} uses ${JSON.stringify(ch)}`);
      plot(pic, col * ART_CELL + x, y, index);
    }
  });
}

// ─── The unit sheet ──────────────────────────────────────

const UNIT_PALETTE: readonly Rgb[] = [
  0x000000, // transparent
  0x1a1c2c, // outline
  0x3b5dc9, // blue
  0x41a6f6, // blue, light
  0xb13e53, // red
  0xef7d57, // red, light
  0xe8b796, // skin
  0x94b0c2, // steel
  0x566c86, // steel, dark
  0x8b5a2b, // wood
];

/** `M` and `L` are the side's colour and its light shade. */
const SIDE_INKS = {
  blue: { M: 2, L: 3 },
  red: { M: 4, L: 5 },
} as const;
const INKS = { o: 1, s: 6, g: 7, d: 8, w: 9 } as const;

const KNIGHT = [
  "................",
  ".....oooooo.....",
  "....oggggggo..o.",
  "....ogddddgo.ogo",
  "....oggggggo.ogo",
  ".....oooooo..ogo",
  "..ooo.oMMo...ogo",
  ".oLLLooMMMoooogo",
  ".oLMLoMMMMMoowo.",
  ".oLMLoMMMMMo.o..",
  ".oLLLoMLLMMo....",
  "..ooo.oMMMMo....",
  "......oMooMo....",
  "......oMooMo....",
  ".....oddo.oddo..",
  ".....oooo.oooo..",
];

const ARCHER = [
  "................",
  "......oooo..w...",
  ".....oMMMMo.gw..",
  "....oMMssMMog.w.",
  "....oMsoosMog.w.",
  ".....osssso.g.w.",
  "......oooo..g.w.",
  ".....oMMMMosg.w.",
  "....oMLMMMMog.w.",
  "....oMLMMMMog.w.",
  "....oMLMMMMog.w.",
  ".....oMMMMo.g.w.",
  "......oMoMo.g.w.",
  "......oMoMo.gw..",
  ".....owwowwow...",
  ".....oooooo.....",
];

const SCOUT = [
  "................",
  "................",
  "......oooo......",
  ".....oLLLLoo....",
  ".....oMMMMMMo...",
  ".....osoosso....",
  "......ossso.....",
  ".......ooo......",
  "......oMMMo..o..",
  ".....oMLMMMoog..",
  ".....oMLMMsoo...",
  "......oMMMo.....",
  "......oMoMo.....",
  ".....owo.owo....",
  ".....oo...oo....",
  "................",
];

/** Unit classes in sheet order, as the unit-class table names them. */
export const UNIT_ART_CLASSES = ["knight", "archer", "scout"] as const;
/** Sides in sheet order; each side's frames are a run, tagged with the side's name. */
export const UNIT_ART_SIDES = ["blue", "red"] as const;

const CLASS_MAPS: Readonly<Record<(typeof UNIT_ART_CLASSES)[number], readonly string[]>> = {
  knight: KNIGHT,
  archer: ARCHER,
  scout: SCOUT,
};

/** A unit frame's name: `<class>-<side>`. */
export const unitFrame = (unitClass: string, side: string) => `${unitClass}-${side}`;

/** Every frame of the unit sheet in file order: one per side and class, the sides in runs. */
export const UNIT_FRAMES: readonly string[] = UNIT_ART_SIDES.flatMap((side) =>
  UNIT_ART_CLASSES.map((c) => unitFrame(c, side)),
);

function unitSheet(): Picture {
  const pic = blank(UNIT_FRAMES.length, 1, UNIT_PALETTE);
  let col = 0;
  for (const side of UNIT_ART_SIDES)
    for (const c of UNIT_ART_CLASSES)
      stamp(pic, col++, CLASS_MAPS[c], { ...INKS, ...SIDE_INKS[side] });
  return pic;
}

/** The Aseprite JSON (hash export) of the unit sheet, laid out as the repo's formatter writes it. */
function unitSheetJson(width: number, height: number): string {
  const frames = UNIT_FRAMES.map((name, i) =>
    [
      `    "${name}": {`,
      `      "frame": { "x": ${i * CELL_PX}, "y": 0, "w": ${CELL_PX}, "h": ${CELL_PX} },`,
      `      "rotated": false,`,
      `      "trimmed": false,`,
      `      "spriteSourceSize": { "x": 0, "y": 0, "w": ${CELL_PX}, "h": ${CELL_PX} },`,
      `      "sourceSize": { "w": ${CELL_PX}, "h": ${CELL_PX} },`,
      `      "duration": 100`,
      `    }`,
    ].join("\n"),
  );
  const tags = UNIT_ART_SIDES.map((side, i) => {
    const from = i * UNIT_ART_CLASSES.length;
    const to = from + UNIT_ART_CLASSES.length - 1;
    return `      { "name": "${side}", "from": ${from}, "to": ${to}, "direction": "forward", "color": "#000000ff" }`;
  });
  return [
    "{",
    '  "frames": {',
    frames.join(",\n"),
    "  },",
    '  "meta": {',
    '    "app": "https://www.aseprite.org/",',
    '    "version": "1.3.7",',
    '    "image": "units.png",',
    '    "format": "I8",',
    `    "size": { "w": ${width}, "h": ${height} },`,
    '    "scale": "1",',
    '    "frameTags": [',
    tags.join(",\n"),
    "    ],",
    '    "layers": [{ "name": "units", "opacity": 255, "blendMode": "normal" }],',
    '    "slices": []',
    "  }",
    "}",
    "",
  ].join("\n");
}

// ─── The tiles ───────────────────────────────────────────

const TILE_PALETTE: readonly Rgb[] = [
  0x000000, // transparent
  0x38b764, // grass
  0x2f9e57, // grass, dark
  0x257179, // cell edge
  0x6fd17e, // tuft
];

/** Tufts on a cell, art px; the dark cells take them mirrored, so the checker doesn't read as stripes. */
const TUFTS: readonly [number, number][] = [
  [4, 4],
  [5, 3],
  [11, 9],
  [12, 8],
  [7, 12],
  [3, 10],
];

/** A 2 × 2 checker of grass cells with their edges drawn: it tiles the whole board. */
function tileSheet(): Picture {
  const pic = blank(2, 2, TILE_PALETTE);
  for (let cy = 0; cy < 2; cy++)
    for (let cx = 0; cx < 2; cx++) {
      const dark = (cx + cy) % 2 === 1;
      for (let y = 0; y < ART_CELL; y++)
        for (let x = 0; x < ART_CELL; x++) {
          const edge = x === 0 || y === 0;
          plot(pic, cx * ART_CELL + x, cy * ART_CELL + y, edge ? 3 : dark ? 2 : 1);
        }
      for (const [tx, ty] of TUFTS)
        plot(pic, cx * ART_CELL + (dark ? ART_CELL - tx : tx), cy * ART_CELL + ty, 4);
    }
  return pic;
}

// ─── The terrain ─────────────────────────────────────────

/** `e` is the board's cell edge, so walls and rough ground keep the grid lines the grass draws. */
const WALL = [
  "eeeeeeeeeeeeeeee",
  "ellllllllmllllll",
  "essssssdsmssssss",
  "emmmmmmmmmmmmmmm",
  "elllmllllllllmll",
  "esssmsssssdssmss",
  "esdsmssssssssmss",
  "emmmmmmmmmmmmmmm",
  "ellllllllmllllll",
  "esssssssdmssssds",
  "essssssssmssssss",
  "emmmmmmmmmmmmmmm",
  "elllmllllllllmll",
  "esssmssdsssssmss",
  "esdsmssssssssmss",
  "emmmmmmmmmmmmmmm",
];

const MARSH = [
  "eeeeeeeeeeeeeeee",
  "ebbbbbbbbbbbrbbb",
  "ebbwwwwbbbbbrbbb",
  "ebwwhwwwbbbrbrbb",
  "ebwwwwwwwbbbbbbb",
  "ebbwwwwwbbbbbbbb",
  "ebbbbbbbbbbwwwbb",
  "ebrbbbbbbbwwhwwb",
  "ebrbrbbbbwwwwwwb",
  "ebbbbbbbbbwwwwbb",
  "ebbbbwwwbbbbbbbb",
  "ebbbwwhwwbbbbrbb",
  "ebbbwwwwwbbbrbrb",
  "ebbbbwwwbbbbbbbb",
  "ebbbbbbbbbbbbbbb",
  "ebbbbbbbbbbbbbbb",
];

const THICKET = [
  "eeeeeeeeeeeeeeee",
  "eqkkkqqqqkkkkqqq",
  "ekgglkqqkgglggkq",
  "ekgllgkkgglllgkq",
  "ekggggkgggggggkq",
  "eqkggkgggkggggkq",
  "eqqkkggkkggkgkqq",
  "eqkkgglgkkkggkkq",
  "ekgglllggkgglgkq",
  "ekgggggggkggggkq",
  "eqkgggkggkgggkqq",
  "eqqkkkqkkkkkkqqq",
  "eqqqkkkqqqkgkqqq",
  "eqqkgglkqqkkqqqq",
  "eqqkggkqqqqqqqqq",
  "eqqqkkqqqqqqqqqq",
];

type TerrainArt = {
  map: readonly string[];
  palette: readonly Rgb[];
  key: Readonly<Record<string, number>>;
};

/** One board cell of each obstacle, drawn opaque so a sprite tiling it hides the grass below. */
const TERRAIN: Readonly<Record<string, TerrainArt>> = {
  wall: {
    map: WALL,
    palette: [0x000000, 0x257179, 0x333c57, 0x566c86, 0x94b0c2, 0x29366f],
    key: { e: 1, m: 2, s: 3, l: 4, d: 5 },
  },
  marsh: {
    map: MARSH,
    palette: [0x000000, 0x257179, 0x5a6b3c, 0x29366f, 0x41a6f6, 0xa7f070],
    key: { e: 1, b: 2, w: 3, h: 4, r: 5 },
  },
  thicket: {
    map: THICKET,
    palette: [0x000000, 0x257179, 0x38b764, 0x1a5c3a, 0x2f8f46, 0xa7f070],
    key: { e: 1, q: 2, k: 3, g: 4, l: 5 },
  },
};

/** The terrain textures' kinds, each drawn as `tile-<kind>.png`: one tileable board cell. */
export const TERRAIN_KINDS = Object.keys(TERRAIN);

/** The file a terrain kind's texture is written to. */
export const terrainFile = (kind: string) => `tile-${kind}.png`;

function terrainTile({ map, palette, key }: TerrainArt): Picture {
  const pic = blank(1, 1, palette);
  stamp(pic, 0, map, key);
  return pic;
}

// ─── Output ──────────────────────────────────────────────

/** The art files by name, as they sit in `art/`. */
export function makeArt(): ReadonlyMap<string, Uint8Array> {
  const units = unitSheet();
  return new Map([
    ["units.png", encodePng(units)],
    ["units.json", new TextEncoder().encode(unitSheetJson(units.width, units.height))],
    ["tiles.png", encodePng(tileSheet())],
    ...Object.entries(TERRAIN).map(
      ([kind, art]) => [terrainFile(kind), encodePng(terrainTile(art))] as const,
    ),
  ]);
}

/** The slice of Bun's API the command line uses; Bun creates missing folders. */
type BunWrite = { write(path: string, data: Uint8Array): Promise<number> };

if (import.meta.main) {
  const bun = (globalThis as { Bun?: BunWrite }).Bun;
  if (!bun)
    throw new Error("make-art writes files under Bun: bun src/games/tactics/art/make-art.ts");
  const out = (process.argv[2] ?? new URL(".", import.meta.url).pathname).replace(/\/?$/, "/");
  for (const [name, bytes] of makeArt()) {
    await bun.write(`${out}${name}`, bytes);
    console.log(`${out}${name} (${bytes.length} bytes)`);
  }
}

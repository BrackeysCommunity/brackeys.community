/**
 * The kitchen sink's generated media: `audio/clink.wav`, a short decaying
 * chime, and `fonts/kitchen.fnt` with its page `fonts/kitchen.png`, a 5×7
 * pixel face covering ASCII letters, digits, common punctuation and the
 * French accents the strings use. Every byte comes from integer arithmetic
 * and a stored (uncompressed) deflate stream, so a rerun writes the same
 * files. All of it is CC0-1.0.
 *
 *   bun packages/engine/scenes/tools/kitchen-media.ts <dir>
 *
 * writes the three files into `<dir>`, for `vp run scene assets import`.
 */

import { pcmWav, triangleLevel } from "../../audio/wav";
import { pngFile, zlibStream } from "../../export/png-write";

/** A generated file: its path inside the engine project, and its bytes. */
export type KitchenMediaFile = { path: string; bytes: Uint8Array };

const CLIP_RATE = 22_050;
const CLIP_FRAMES = 3_300;

/** 16-bit mono PCM: two triangle partials under a squared decay. */
export function clinkWav(): Uint8Array {
  const full = 2 ** 15 - 1;
  const samples = new Int16Array(CLIP_FRAMES);
  for (let i = 0; i < CLIP_FRAMES; i++) {
    const left = CLIP_FRAMES - i;
    const mix = triangleLevel(i, 17, full) * 3 + triangleLevel(i, 23, full) * 2;
    samples[i] = Math.trunc((mix * left * left) / (5 * CLIP_FRAMES * CLIP_FRAMES) / 2);
  }
  return pcmWav({ channels: 1, sampleRate: CLIP_RATE, bits: 16, samples });
}

/**
 * Each glyph's rows from the cell's top: two rows for a capital's accent,
 * seven to the baseline, two of descender. A row left out is empty; `#` is
 * lit.
 */
function glyphRows(): Record<string, readonly string[]> {
  const caps = (rows: string) => ["", "", ...rows.split(" ")];
  const small = (rows: string, below = "") => [
    "",
    "",
    "",
    "",
    ...rows.split(" "),
    ...(below ? below.split(" ") : []),
  ];
  const tall = (rows: string, below = "") => [
    "",
    "",
    ...rows.split(" "),
    ...(below ? below.split(" ") : []),
  ];
  const e = ".###. #...# ##### #.... .###.";
  const a = ".###. ....# .#### #...# .####";
  return {
    " ": [],
    "!": caps("..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#.."),
    '"': caps(".#.#. .#.#."),
    "'": caps("..#.. ..#.."),
    "(": caps("...#. ..#.. .#... .#... .#... ..#.. ...#."),
    ")": caps(".#... ..#.. ...#. ...#. ...#. ..#.. .#..."),
    ",": caps("..... ..... ..... ..... ..... ..... ..#.. .#..."),
    "-": caps("..... ..... ..... .###."),
    ".": caps("..... ..... ..... ..... ..... ..... ..#.."),
    "/": caps("....# ....# ...#. ..#.. .#... #.... #...."),
    "0": caps(".###. #...# #..## #.#.# ##..# #...# .###."),
    "1": caps("..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###."),
    "2": caps(".###. #...# ....# ...#. ..#.. .#... #####"),
    "3": caps("####. ....# ....# .###. ....# ....# ####."),
    "4": caps("...#. ..##. .#.#. #..#. ##### ...#. ...#."),
    "5": caps("##### #.... ####. ....# ....# #...# .###."),
    "6": caps(".###. #.... #.... ####. #...# #...# .###."),
    "7": caps("##### ....# ...#. ..#.. .#... .#... .#..."),
    "8": caps(".###. #...# #...# .###. #...# #...# .###."),
    "9": caps(".###. #...# #...# .#### ....# ....# .###."),
    ":": caps("..... ..... ..#.. ..... ..... ..#.."),
    ";": caps("..... ..... ..#.. ..... ..... ..#.. .#..."),
    "?": caps(".###. #...# ....# ...#. ..#.. ..... ..#.."),
    A: caps(".###. #...# #...# ##### #...# #...# #...#"),
    B: caps("####. #...# #...# ####. #...# #...# ####."),
    C: caps(".###. #...# #.... #.... #.... #...# .###."),
    D: caps("####. #...# #...# #...# #...# #...# ####."),
    E: caps("##### #.... #.... ####. #.... #.... #####"),
    F: caps("##### #.... #.... ####. #.... #.... #...."),
    G: caps(".###. #...# #.... #.### #...# #...# .####"),
    H: caps("#...# #...# #...# ##### #...# #...# #...#"),
    I: caps(".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###."),
    J: caps("..### ...#. ...#. ...#. ...#. #..#. .##.."),
    K: caps("#...# #..#. #.#.. ##... #.#.. #..#. #...#"),
    L: caps("#.... #.... #.... #.... #.... #.... #####"),
    M: caps("#...# ##.## #.#.# #.#.# #...# #...# #...#"),
    N: caps("#...# #...# ##..# #.#.# #..## #...# #...#"),
    O: caps(".###. #...# #...# #...# #...# #...# .###."),
    P: caps("####. #...# #...# ####. #.... #.... #...."),
    Q: caps(".###. #...# #...# #...# #.#.# #..#. .##.#"),
    R: caps("####. #...# #...# ####. #.#.. #..#. #...#"),
    S: caps(".###. #...# #.... .###. ....# #...# .###."),
    T: caps("##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#.."),
    U: caps("#...# #...# #...# #...# #...# #...# .###."),
    V: caps("#...# #...# #...# #...# #...# .#.#. ..#.."),
    W: caps("#...# #...# #...# #.#.# #.#.# #.#.# .#.#."),
    X: caps("#...# #...# .#.#. ..#.. .#.#. #...# #...#"),
    Y: caps("#...# #...# .#.#. ..#.. ..#.. ..#.. ..#.."),
    Z: caps("##### ....# ...#. ..#.. .#... #.... #####"),
    a: small(a),
    b: tall("#.... #.... ####. #...# #...# #...# ####."),
    c: small(".###. #.... #.... #.... .###."),
    d: tall("....# ....# .#### #...# #...# #...# .####"),
    e: small(e),
    f: tall("..##. .#... .#... ###.. .#... .#... .#..."),
    g: small(".#### #...# #...# #...# .####", "....# .###."),
    h: tall("#.... #.... ####. #...# #...# #...# #...#"),
    i: tall("..#.. ..... .##.. ..#.. ..#.. ..#.. .###."),
    j: tall("...#. ..... ..##. ...#. ...#. ...#. ...#.", "#..#. .##.."),
    k: tall("#.... #.... #..#. #.#.. ##... #.#.. #..#."),
    l: tall(".##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###."),
    m: small("##.#. #.#.# #.#.# #.#.# #.#.#"),
    n: small("####. #...# #...# #...# #...#"),
    o: small(".###. #...# #...# #...# .###."),
    p: small("####. #...# #...# #...# ####.", "#.... #...."),
    q: small(".#### #...# #...# #...# .####", "....# ....#"),
    r: small("#.##. ##..# #.... #.... #...."),
    s: small(".#### #.... .###. ....# ####."),
    t: tall("..... .#... ####. .#... .#... .#..# ..##."),
    u: small("#...# #...# #...# #..## .##.#"),
    v: small("#...# #...# #...# .#.#. ..#.."),
    w: small("#...# #...# #.#.# #.#.# .#.#."),
    x: small("#...# .#.#. ..#.. .#.#. #...#"),
    y: small("#...# #...# #...# #...# .####", "....# .###."),
    z: small("##### ...#. ..#.. .#... #####"),
    É: ["...#.", "..#..", ..."##### #.... #.... ####. #.... #.... #####".split(" ")],
    à: tall(`.#... ..#.. ${a}`),
    ç: small(".###. #.... #.... #.... .###.", "..#.. .##.."),
    è: tall(`.#... ..#.. ${e}`),
    é: tall(`...#. ..#.. ${e}`),
    ê: tall(`..#.. .#.#. ${e}`),
  };
}

const GLYPH_W = 5;
const CELL_H = 11;
const PAGE_COLUMNS = 16;
/** A glyph's cell on the page, a pixel of spacing right and below. */
const PITCH_X = GLYPH_W + 1;
const PITCH_Y = CELL_H + 1;

/** The glyphs in code point order, each with its page cell. */
function layout() {
  const rows = glyphRows();
  return Object.keys(rows)
    .map((ch) => ch.codePointAt(0)!)
    .sort((x, y) => x - y)
    .map((cp, i) => ({
      cp,
      rows: rows[String.fromCodePoint(cp)]!,
      x: (i % PAGE_COLUMNS) * PITCH_X,
      y: Math.floor(i / PAGE_COLUMNS) * PITCH_Y,
    }));
}

function pageSize(count: number) {
  return { width: PAGE_COLUMNS * PITCH_X, height: Math.ceil(count / PAGE_COLUMNS) * PITCH_Y };
}

/** Stored (uncompressed) deflate blocks of `raw`: no encoder to drift. */
function deflateStored(raw: Uint8Array): number[] {
  const out: number[] = [];
  const max = 65_535;
  for (let at = 0; at < raw.length; at += max) {
    const block = raw.subarray(at, at + max);
    const n = block.length;
    const last = at + max >= raw.length ? 1 : 0;
    out.push(last, n & 0xff, n >>> 8, ~n & 0xff, (~n >>> 8) & 0xff, ...block);
  }
  return out;
}

/** The font's page: white glyphs on transparent, 8-bit grey and alpha. */
export function kitchenFontPng(): Uint8Array {
  const glyphs = layout();
  const { width, height } = pageSize(glyphs.length);
  const lit = new Uint8Array(width * height);
  for (const g of glyphs)
    g.rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++)
        if (row[dx] === "#") lit[(g.y + dy) * width + g.x + dx] = 1;
    });
  const raw = new Uint8Array(height * (1 + width * 2));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (1 + width * 2) + 1 + x * 2;
      raw[at] = 255;
      raw[at + 1] = lit[y * width + x] ? 255 : 0;
    }
  return pngFile({ width, height, bitDepth: 8, colorType: 4, zlib: zlibStream(deflateStored(raw), raw) });
}

/** The font's BMFont text file, its page named beside it. */
export function kitchenFontFnt(page = "kitchen.png"): string {
  const glyphs = layout();
  const { width, height } = pageSize(glyphs.length);
  const space = 0x20;
  const lines = [
    'info face="Kitchen" size=10 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=0 padding=0,0,0,0 spacing=1,1 outline=0',
    `common lineHeight=${PITCH_Y} base=9 scaleW=${width} scaleH=${height} pages=1 packed=0`,
    `page id=0 file="${page}"`,
    `chars count=${glyphs.length}`,
    ...glyphs.map(
      (g) =>
        `char id=${g.cp} x=${g.x} y=${g.y} width=${g.cp === space ? 0 : GLYPH_W} height=${g.cp === space ? 0 : CELL_H} xoffset=0 yoffset=0 xadvance=${g.cp === space ? 4 : PITCH_X} page=0 chnl=15`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

/** Every generated file, at its path in the engine project. */
export function kitchenMedia(): KitchenMediaFile[] {
  return [
    { path: "audio/clink.wav", bytes: clinkWav() },
    { path: "fonts/kitchen.fnt", bytes: new TextEncoder().encode(kitchenFontFnt()) },
    { path: "fonts/kitchen.png", bytes: kitchenFontPng() },
  ];
}

type BunWriter = { argv: string[]; write(path: string, data: Uint8Array): Promise<number> };
const bun = (globalThis as { Bun?: BunWriter }).Bun;
if ((import.meta as { main?: boolean }).main && bun) {
  const dir = bun.argv[2];
  if (!dir) throw new Error("usage: bun packages/engine/scenes/tools/kitchen-media.ts <dir>");
  for (const file of kitchenMedia())
    await bun.write(`${dir}/${file.path.split("/").pop()}`, file.bytes);
}

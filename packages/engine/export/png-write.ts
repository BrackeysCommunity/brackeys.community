import { crc32 } from "./crc32";

function adler32(data: ArrayLike<number>): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + (data[i] ?? 0)) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];

/** `raw` as stored (uncompressed) deflate blocks: no compressor, so the bytes match on every runtime. */
export function deflateStored(raw: ArrayLike<number>): Uint8Array {
  const max = 65_535;
  const blocks = Math.max(1, Math.ceil(raw.length / max));
  const out = new Uint8Array(raw.length + blocks * 5);
  let to = 0;
  for (let at = 0, b = 0; b < blocks; b++, at += max) {
    const n = Math.min(max, raw.length - at);
    out.set([b === blocks - 1 ? 1 : 0, n & 0xff, n >>> 8, ~n & 0xff, (~n >>> 8) & 0xff], to);
    for (let i = 0; i < n; i++) out[to + 5 + i] = raw[at + i] ?? 0;
    to += 5 + n;
  }
  return out;
}

/** A zlib stream (no preset dictionary, fastest level) around `deflated`, the deflate blocks encoding `raw`. */
export function zlibStream(deflated: ArrayLike<number>, raw: ArrayLike<number>): Uint8Array {
  return Uint8Array.from([0x78, 0x01, ...Array.from(deflated), ...u32(adler32(raw))]);
}

function chunk(type: string, body: ArrayLike<number>): number[] {
  const typed = new Uint8Array(4 + body.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(body, 4);
  return [...u32(body.length), ...typed, ...u32(crc32(typed))];
}

export type PngImage = {
  width: number;
  height: number;
  bitDepth: number;
  /** 0 grey, 2 RGB, 3 palette, 4 grey and alpha, 6 RGBA. */
  colorType: number;
  /** Chunks between `IHDR` and `IDAT`, such as a palette's `PLTE`. */
  before?: readonly (readonly [type: string, body: ArrayLike<number>])[];
  /** The filtered scanlines as a zlib stream (`zlibStream`). */
  zlib: ArrayLike<number>;
};

/** A PNG file: the signature, `IHDR`, any `before` chunks, one `IDAT` and `IEND`. */
export function pngFile(image: PngImage): Uint8Array {
  const header = [
    ...u32(image.width),
    ...u32(image.height),
    image.bitDepth,
    image.colorType,
    0,
    0,
    0,
  ];
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
    ...(image.before ?? []).flatMap(([type, body]) => chunk(type, body)),
    ...chunk("IDAT", image.zlib),
    ...chunk("IEND", []),
  ]);
}

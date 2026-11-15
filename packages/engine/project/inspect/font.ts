import { hasAscii, u16be, u32be, u8 } from "./bytes";
import { cmapCoverage, type CodePointRanges } from "./font-cmap";

export type WebFontFormat = "woff2" | "woff" | "ttf" | "otf";

/** An sfnt table directory: at least one table, every record inside the file. */
function sfntTables(bytes: Uint8Array): boolean {
  const tables = u16be(bytes, 4);
  return bytes.length >= 12 && tables > 0 && 12 + tables * 16 <= bytes.length;
}

/** A WOFF or WOFF2 header: its `length` is the file's, and it lists at least one table. */
function woffHeader(bytes: Uint8Array, headerSize: number): boolean {
  return bytes.length >= headerSize && u32be(bytes, 8) === bytes.length && u16be(bytes, 12) > 0;
}

/**
 * A web or desktop font's container from its header: WOFF2, WOFF, or an sfnt
 * with TrueType (`ttf`) or CFF (`otf`) outlines. Null for anything else,
 * font collections included. Glyphs are never read.
 */
export function readFontFormat(bytes: Uint8Array): WebFontFormat | null {
  if (hasAscii(bytes, 0, "wOF2")) return woffHeader(bytes, 48) ? "woff2" : null;
  if (hasAscii(bytes, 0, "wOFF")) return woffHeader(bytes, 44) ? "woff" : null;
  if (hasAscii(bytes, 0, "OTTO")) return sfntTables(bytes) ? "otf" : null;
  if (u32be(bytes, 0) === 0x00010000 || hasAscii(bytes, 0, "true"))
    return sfntTables(bytes) ? "ttf" : null;
  return null;
}

/**
 * Decompressors a host can lend the font reader; the reader itself stays
 * pure. Without them a WOFF's compressed tables and every WOFF2 table stay
 * unread, and the face's coverage is unknown.
 */
export type FontDecompress = {
  /** zlib (RFC 1950) data, as WOFF stores a compressed table. */
  inflate?: (data: Uint8Array) => Uint8Array;
  /** A Brotli stream, as WOFF2 stores all its tables. */
  brotli?: (data: Uint8Array) => Uint8Array;
};

function tagAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  );
}

function sfntTable(bytes: Uint8Array, tag: string): Uint8Array | null {
  const tables = u16be(bytes, 4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (tagAt(bytes, record) !== tag) continue;
    const at = u32be(bytes, record + 8);
    const length = u32be(bytes, record + 12);
    return at + length <= bytes.length ? bytes.subarray(at, at + length) : null;
  }
  return null;
}

function woffTable(bytes: Uint8Array, tag: string, decompress?: FontDecompress): Uint8Array | null {
  const tables = u16be(bytes, 12);
  for (let i = 0; i < tables; i++) {
    const record = 44 + i * 20;
    if (record + 20 > bytes.length) return null;
    if (tagAt(bytes, record) !== tag) continue;
    const at = u32be(bytes, record + 4);
    const stored = u32be(bytes, record + 8);
    const length = u32be(bytes, record + 12);
    if (at + stored > bytes.length || stored > length) return null;
    const data = bytes.subarray(at, at + stored);
    if (stored === length) return data;
    const table = decompress?.inflate?.(data);
    return table instanceof Uint8Array && table.length === length ? table : null;
  }
  return null;
}

/** A WOFF2 UIntBase128 at `at`: its value and the offset after it. */
function base128(bytes: Uint8Array, at: number): [value: number, next: number] | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (at + i >= bytes.length) return null;
    const byte = u8(bytes, at + i);
    if (i === 0 && byte === 0x80) return null;
    if (value > 0x1ffffff) return null;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, at + i + 1];
  }
  return null;
}

/** WOFF2's known-table indexes this reader needs; 63 means a tag follows. */
const WOFF2_TAG_INDEX: Readonly<Record<number, string>> = { 0: "cmap", 10: "glyf", 11: "loca" };

function woff2Table(
  bytes: Uint8Array,
  tag: string,
  decompress?: FontDecompress,
): Uint8Array | null {
  if (hasAscii(bytes, 4, "ttcf")) return null;
  const tables = u16be(bytes, 12);
  let at = 48;
  let streamAt = 0;
  let found: [at: number, length: number] | null = null;
  for (let i = 0; i < tables; i++) {
    if (at >= bytes.length) return null;
    const flags = u8(bytes, at++);
    const index = flags & 0x3f;
    let name = WOFF2_TAG_INDEX[index] ?? "";
    if (index === 63) {
      if (at + 4 > bytes.length) return null;
      name = tagAt(bytes, at);
      at += 4;
    }
    const orig = base128(bytes, at);
    if (!orig) return null;
    at = orig[1];
    const version = flags >> 6;
    const transformed = name === "glyf" || name === "loca" ? version !== 3 : version !== 0;
    let length = orig[0];
    if (transformed) {
      const stored = base128(bytes, at);
      if (!stored) return null;
      [length, at] = stored;
    }
    if (name === tag) found = transformed ? null : [streamAt, length];
    streamAt += length;
  }
  if (!found || !decompress?.brotli) return null;
  const compressed = u32be(bytes, 20);
  if (at + compressed > bytes.length) return null;
  const stream = decompress.brotli(bytes.subarray(at, at + compressed));
  if (!(stream instanceof Uint8Array) || found[0] + found[1] > stream.length) return null;
  return stream.subarray(found[0], found[0] + found[1]);
}

/**
 * One sfnt table's bytes from a font `readFontFormat` accepted, unpacked
 * from WOFF or WOFF2 when `decompress` can. Null when the font has no such
 * table or it can't be read here.
 */
export function fontTable(
  bytes: Uint8Array,
  format: WebFontFormat,
  tag: string,
  decompress?: FontDecompress,
): Uint8Array | null {
  if (format === "woff2") return woff2Table(bytes, tag, decompress);
  if (format === "woff") return woffTable(bytes, tag, decompress);
  return sfntTable(bytes, tag);
}

/** The code points a web or desktop font maps to glyphs, or null when its `cmap` can't be read here. */
export function fontCoverage(
  bytes: Uint8Array,
  format: WebFontFormat,
  decompress?: FontDecompress,
): CodePointRanges | null {
  try {
    const cmap = fontTable(bytes, format, "cmap", decompress);
    return cmap ? cmapCoverage(cmap) : null;
  } catch {
    return null;
  }
}

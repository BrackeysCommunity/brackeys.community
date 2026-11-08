import { hasAscii, u16be, u32be } from "./bytes";

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

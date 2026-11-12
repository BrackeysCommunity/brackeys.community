import { hasAscii, imageSize, type ImageSize, u16le, u24le, u32le, u8 } from "./bytes";

/** A WebP's size from its first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X). */
export function readWebpSize(bytes: Uint8Array): ImageSize | null {
  if (!hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP")) return null;
  const chunkSize = u32le(bytes, 16);
  if (hasAscii(bytes, 12, "VP8 ")) {
    if (chunkSize < 10 || bytes.length < 30) return null;
    // Bit 0 of the frame tag is set on interframes, which carry no size.
    if ((u8(bytes, 20) & 1) !== 0) return null;
    if (u8(bytes, 23) !== 0x9d || u8(bytes, 24) !== 0x01 || u8(bytes, 25) !== 0x2a) return null;
    return imageSize(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  if (hasAscii(bytes, 12, "VP8L")) {
    if (chunkSize < 5 || bytes.length < 25 || u8(bytes, 20) !== 0x2f) return null;
    const bits = u32le(bytes, 21);
    return imageSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (hasAscii(bytes, 12, "VP8X")) {
    if (chunkSize < 10 || bytes.length < 30) return null;
    return imageSize(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  }
  return null;
}

import { hasAscii, imageSize, type ImageSize, u16le } from "./bytes";

/** A GIF's logical screen size. */
export function readGifSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 10) return null;
  if (!hasAscii(bytes, 0, "GIF87a") && !hasAscii(bytes, 0, "GIF89a")) return null;
  return imageSize(u16le(bytes, 6), u16le(bytes, 8));
}

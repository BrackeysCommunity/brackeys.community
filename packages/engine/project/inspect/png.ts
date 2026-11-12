import { hasAscii, imageSize, type ImageSize, u32be } from "./bytes";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_DIMENSION = 0x7fffffff;

/** A PNG's size from its IHDR chunk, which the format requires first. */
export function readPngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  if (u32be(bytes, 8) !== 13 || !hasAscii(bytes, 12, "IHDR")) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  return imageSize(width, height);
}

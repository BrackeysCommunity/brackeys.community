import { imageSize, type ImageSize, u16be, u8 } from "./bytes";

/** Markers that carry no length field. */
function standalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

/** Start-of-frame markers: C0–CF except DHT (C4), JPG (C8) and DAC (CC). */
function startOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** A JPEG's size from its first start-of-frame segment, skipping the segments before it. */
export function readJpegSize(bytes: Uint8Array): ImageSize | null {
  if (u8(bytes, 0) !== 0xff || u8(bytes, 1) !== 0xd8) return null;
  let at = 2;
  while (at + 1 < bytes.length) {
    if (u8(bytes, at) !== 0xff) return null;
    const marker = u8(bytes, at + 1);
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (standalone(marker)) {
      at += 2;
      continue;
    }
    // The image data starts or ends before any frame header.
    if (marker === 0xda || marker === 0xd9) return null;
    if (at + 4 > bytes.length) return null;
    const length = u16be(bytes, at + 2);
    if (length < 2) return null;
    if (startOfFrame(marker)) {
      if (length < 7 || at + 9 > bytes.length) return null;
      return imageSize(u16be(bytes, at + 7), u16be(bytes, at + 5));
    }
    at += 2 + length;
  }
  return null;
}

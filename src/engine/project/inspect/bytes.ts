/** Pixel dimensions read from an image header. */
export type ImageSize = { width: number; height: number };

export function u8(bytes: Uint8Array, at: number): number {
  return bytes[at] ?? 0;
}

export function u16be(bytes: Uint8Array, at: number): number {
  return (u8(bytes, at) << 8) | u8(bytes, at + 1);
}

export function u16le(bytes: Uint8Array, at: number): number {
  return u8(bytes, at) | (u8(bytes, at + 1) << 8);
}

export function u24le(bytes: Uint8Array, at: number): number {
  return u8(bytes, at) | (u8(bytes, at + 1) << 8) | (u8(bytes, at + 2) << 16);
}

export function u32be(bytes: Uint8Array, at: number): number {
  return ((u8(bytes, at) << 24) >>> 0) + (u16be(bytes, at + 1) << 8) + u8(bytes, at + 3);
}

export function u32le(bytes: Uint8Array, at: number): number {
  return u24le(bytes, at) + ((u8(bytes, at + 3) << 24) >>> 0);
}

/** Whether `bytes` holds the ASCII text `tag` at `at`. */
export function hasAscii(bytes: Uint8Array, at: number, tag: string): boolean {
  if (at < 0 || at + tag.length > bytes.length) return false;
  for (let i = 0; i < tag.length; i++) if (bytes[at + i] !== tag.charCodeAt(i)) return false;
  return true;
}

/** Positive dimensions only: a zero or deferred size is not a usable image. */
export function imageSize(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

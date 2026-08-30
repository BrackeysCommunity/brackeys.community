/**
 * 64-bit difference hash (dHash) over an 9×8 grayscale reduction: each bit is
 * "is this pixel brighter than its right neighbor". Robust to recompression,
 * resizing, and small color shifts — the transforms a cover survives between
 * an original upload and a re-encoded copy — which is all the internal-theft
 * matcher needs. Not adversarially robust, and doesn't try to be: a human
 * confirms every flag.
 *
 * Pure byte-in/hex-out so it tests without sharp, network, or Postgres; the
 * decode-and-resize half lives in cover.ts.
 */

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/** Grayscale row-major pixels, `DHASH_WIDTH × DHASH_HEIGHT`, one byte each. */
export function dhashFromGray(pixels: Uint8Array): string {
  if (pixels.length !== DHASH_WIDTH * DHASH_HEIGHT) {
    throw new Error(`dhash expects ${DHASH_WIDTH * DHASH_HEIGHT} pixels, got ${pixels.length}`);
  }
  let hash = 0n;
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      const left = pixels[y * DHASH_WIDTH + x] ?? 0;
      const right = pixels[y * DHASH_WIDTH + x + 1] ?? 0;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

/** Bit distance between two 16-hex-char hashes. */
export function hammingHex(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (diff) {
    bits += Number(diff & 1n);
    diff >>= 1n;
  }
  return bits;
}

export type HashedEntry = {
  entryId: number;
  authorId: number | null;
  coverPhash: string;
};

/**
 * Candidates within `maxDistance` bits of `hash`, excluding the entry itself
 * and (when author ids are known) the same author — an author re-covering
 * their own entries is not theft.
 */
export function nearMatches(
  hash: string,
  entryId: number,
  authorId: number | null,
  candidates: readonly HashedEntry[],
  maxDistance: number,
): Array<HashedEntry & { distance: number }> {
  const out: Array<HashedEntry & { distance: number }> = [];
  for (const candidate of candidates) {
    if (candidate.entryId === entryId) continue;
    if (authorId != null && candidate.authorId === authorId) continue;
    const distance = hammingHex(hash, candidate.coverPhash);
    if (distance <= maxDistance) out.push({ ...candidate, distance });
  }
  return out;
}

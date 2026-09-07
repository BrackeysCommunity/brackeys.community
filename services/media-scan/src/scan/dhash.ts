/**
 * 128-bit difference hash (dHash) over grayscale reductions: 64 horizontal
 * bits ("is this pixel brighter than its right neighbor" on a 9×8 grid) plus
 * 64 vertical bits (same against the pixel below, on an 8×9 grid). Robust to
 * recompression, resizing, and small color shifts — the transforms a cover
 * survives between an original upload and a re-encoded copy — which is all
 * the internal-theft matcher needs. Not adversarially robust, and doesn't
 * try to be: a human confirms every flag.
 *
 * Both orientations on purpose: 64 horizontal bits alone let covers that
 * share gross layout (dark side bands, light center panel) land within a few
 * bits of each other. Measured on production covers, structural twins that
 * matched at 5–6/64 sit at 29–45/128, while true re-encodes stay ≤ 12/128.
 *
 * Pure byte-in/hex-out so it tests without sharp, network, or Postgres; the
 * decode-and-resize half lives in cover.ts.
 */

/** Comparisons per row/column — both planes yield 8×8 = 64 bits. */
export const DHASH_SIZE = 8;
/** Horizontal plane: DHASH_SIZE+1 wide × DHASH_SIZE tall. */
export const DHASH_H_WIDTH = DHASH_SIZE + 1;
export const DHASH_H_HEIGHT = DHASH_SIZE;
/** Vertical plane: DHASH_SIZE wide × DHASH_SIZE+1 tall. */
export const DHASH_V_WIDTH = DHASH_SIZE;
export const DHASH_V_HEIGHT = DHASH_SIZE + 1;

const PLANE_PIXELS = DHASH_SIZE * (DHASH_SIZE + 1);

/**
 * Gradient pairs must differ by at least this much to count as signal, and a
 * cover needs MIN_INFORMATIVE_EDGES such pairs (of 128) to be matchable at
 * all. Below that the hash is mostly noise: solid fills, sparse doodles, and
 * ink-on-transparency all collapse toward the same few hashes, which is how
 * a black square once "identically matched" a marker scribble. Measured
 * margins are wide — flat/sparse covers land ≤ ~28, real art ≥ ~96.
 */
export const MIN_EDGE_DELTA = 8;
export const MIN_INFORMATIVE_EDGES = 32;

function assertPlane(pixels: Uint8Array, name: string): void {
  if (pixels.length !== PLANE_PIXELS) {
    throw new Error(`${name} plane expects ${PLANE_PIXELS} pixels, got ${pixels.length}`);
  }
}

/**
 * Grayscale row-major planes: `horizontal` is DHASH_H_WIDTH × DHASH_H_HEIGHT,
 * `vertical` is DHASH_V_WIDTH × DHASH_V_HEIGHT, one byte per pixel.
 * Returns 32 hex chars: horizontal bits then vertical bits.
 */
export function dhashFromGray(horizontal: Uint8Array, vertical: Uint8Array): string {
  assertPlane(horizontal, "horizontal");
  assertPlane(vertical, "vertical");
  let hash = 0n;
  for (let y = 0; y < DHASH_H_HEIGHT; y++) {
    for (let x = 0; x < DHASH_H_WIDTH - 1; x++) {
      const left = horizontal[y * DHASH_H_WIDTH + x] ?? 0;
      const right = horizontal[y * DHASH_H_WIDTH + x + 1] ?? 0;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  for (let y = 0; y < DHASH_V_HEIGHT - 1; y++) {
    for (let x = 0; x < DHASH_V_WIDTH; x++) {
      const above = vertical[y * DHASH_V_WIDTH + x] ?? 0;
      const below = vertical[(y + 1) * DHASH_V_WIDTH + x] ?? 0;
      hash = (hash << 1n) | (above > below ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(32, "0");
}

/** Count of compared pairs (both planes) whose brightness differs by ≥ MIN_EDGE_DELTA. */
export function informativeEdges(horizontal: Uint8Array, vertical: Uint8Array): number {
  assertPlane(horizontal, "horizontal");
  assertPlane(vertical, "vertical");
  let count = 0;
  for (let y = 0; y < DHASH_H_HEIGHT; y++) {
    for (let x = 0; x < DHASH_H_WIDTH - 1; x++) {
      const left = horizontal[y * DHASH_H_WIDTH + x] ?? 0;
      const right = horizontal[y * DHASH_H_WIDTH + x + 1] ?? 0;
      if (Math.abs(left - right) >= MIN_EDGE_DELTA) count++;
    }
  }
  for (let y = 0; y < DHASH_V_HEIGHT - 1; y++) {
    for (let x = 0; x < DHASH_V_WIDTH; x++) {
      const above = vertical[y * DHASH_V_WIDTH + x] ?? 0;
      const below = vertical[(y + 1) * DHASH_V_WIDTH + x] ?? 0;
      if (Math.abs(above - below) >= MIN_EDGE_DELTA) count++;
    }
  }
  return count;
}

/** Bit distance between two equal-length hex hashes. */
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
 * their own entries is not theft. Hashes of a different length (the v1
 * 64-bit corpus, until the re-scan replaces it) never match.
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
    if (candidate.coverPhash.length !== hash.length) continue;
    const distance = hammingHex(hash, candidate.coverPhash);
    if (distance <= maxDistance) out.push({ ...candidate, distance });
  }
  return out;
}

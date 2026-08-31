import { describe, expect, test } from "bun:test";

import { isOlder } from "../jobs/scan.ts";
import {
  DHASH_H_HEIGHT,
  DHASH_H_WIDTH,
  DHASH_V_HEIGHT,
  DHASH_V_WIDTH,
  dhashFromGray,
  hammingHex,
  informativeEdges,
  MIN_EDGE_DELTA,
  MIN_INFORMATIVE_EDGES,
  nearMatches,
} from "./dhash.ts";

const H_PIXELS = DHASH_H_WIDTH * DHASH_H_HEIGHT;
const V_PIXELS = DHASH_V_WIDTH * DHASH_V_HEIGHT;

/** Horizontal plane brightening left→right: every horizontal comparison is 0. */
const hRising = Uint8Array.from({ length: H_PIXELS }, (_, i) => (i % DHASH_H_WIDTH) * 20);
/** Darkening left→right: every horizontal comparison is 1. */
const hFalling = Uint8Array.from({ length: H_PIXELS }, (_, i) => 255 - (i % DHASH_H_WIDTH) * 20);
/** Vertical plane brightening top→bottom: every vertical comparison is 0. */
const vRising = Uint8Array.from({ length: V_PIXELS }, (_, i) => Math.floor(i / DHASH_V_WIDTH) * 20);
/** Darkening top→bottom: every vertical comparison is 1. */
const vFalling = Uint8Array.from(
  { length: V_PIXELS },
  (_, i) => 255 - Math.floor(i / DHASH_V_WIDTH) * 20,
);

describe("dhashFromGray", () => {
  test("gradients hash to all-zero and all-one bits", () => {
    expect(dhashFromGray(hRising, vRising)).toBe("0".repeat(32));
    expect(dhashFromGray(hFalling, vFalling)).toBe("f".repeat(32));
  });

  test("the two planes fill separate halves of the hash", () => {
    expect(dhashFromGray(hFalling, vRising)).toBe("f".repeat(16) + "0".repeat(16));
    expect(dhashFromGray(hRising, vFalling)).toBe("0".repeat(16) + "f".repeat(16));
  });

  test("hash is 32 hex chars and stable", () => {
    const hNoisy = Uint8Array.from({ length: H_PIXELS }, (_, i) => (i * 37) % 256);
    const vNoisy = Uint8Array.from({ length: V_PIXELS }, (_, i) => (i * 53) % 256);
    const hash = dhashFromGray(hNoisy, vNoisy);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(dhashFromGray(hNoisy, vNoisy)).toBe(hash);
  });

  test("a single flipped comparison moves exactly one bit", () => {
    const tweaked = Uint8Array.from(hRising);
    // Make pixel (0,0) brighter than its right neighbor.
    tweaked[0] = 255;
    expect(hammingHex(dhashFromGray(hRising, vRising), dhashFromGray(tweaked, vRising))).toBe(1);
  });

  test("rejects wrong-size input", () => {
    expect(() => dhashFromGray(new Uint8Array(10), vRising)).toThrow();
    expect(() => dhashFromGray(hRising, new Uint8Array(10))).toThrow();
  });
});

describe("informativeEdges", () => {
  test("flat images carry zero signal, whatever their brightness", () => {
    expect(
      informativeEdges(new Uint8Array(H_PIXELS).fill(0), new Uint8Array(V_PIXELS).fill(0)),
    ).toBe(0);
    expect(
      informativeEdges(new Uint8Array(H_PIXELS).fill(255), new Uint8Array(V_PIXELS).fill(255)),
    ).toBe(0);
  });

  test("sub-threshold gradients don't count", () => {
    const hFaint = Uint8Array.from(
      { length: H_PIXELS },
      (_, i) => (i % DHASH_H_WIDTH) * (MIN_EDGE_DELTA - 1),
    );
    const vFaint = Uint8Array.from(
      { length: V_PIXELS },
      (_, i) => Math.floor(i / DHASH_V_WIDTH) * (MIN_EDGE_DELTA - 1),
    );
    expect(informativeEdges(hFaint, vFaint)).toBe(0);
  });

  test("strong gradients in both planes count every pair", () => {
    expect(informativeEdges(hRising, vRising)).toBe(128);
  });

  test("the matchability floor sits between sparse and real covers", () => {
    // Measured on synthetic covers: doodles/flat fills land ≤ ~28, real art ≥ ~96.
    expect(MIN_INFORMATIVE_EDGES).toBeGreaterThan(28);
    expect(MIN_INFORMATIVE_EDGES).toBeLessThan(96);
  });

  test("rejects wrong-size input", () => {
    expect(() => informativeEdges(new Uint8Array(10), vRising)).toThrow();
  });
});

describe("hammingHex", () => {
  test("identical hashes are distance 0", () => {
    expect(hammingHex("abcdef0123456789", "abcdef0123456789")).toBe(0);
  });
  test("complementary 128-bit hashes are distance 128", () => {
    expect(hammingHex("0".repeat(32), "f".repeat(32))).toBe(128);
  });
  test("counts scattered bits", () => {
    expect(hammingHex("0".repeat(32), "8".padEnd(31, "0") + "1")).toBe(2);
  });
});

describe("nearMatches", () => {
  const pool = [
    { entryId: 1, authorId: 10, coverPhash: "0".repeat(32) },
    { entryId: 2, authorId: 20, coverPhash: "0".repeat(31) + "3" }, // distance 2
    { entryId: 3, authorId: 30, coverPhash: "f".repeat(32) }, // distance 128
    { entryId: 4, authorId: 40, coverPhash: "0".repeat(32) }, // exact
    { entryId: 5, authorId: 50, coverPhash: "0".repeat(16) }, // v1 64-bit hash
  ];

  test("finds entries within the distance budget", () => {
    const found = nearMatches("0".repeat(32), 99, 99, pool, 16);
    expect(found.map((m) => m.entryId).sort()).toEqual([1, 2, 4]);
    expect(found.find((m) => m.entryId === 2)?.distance).toBe(2);
  });

  test("excludes the entry itself and the same author", () => {
    const found = nearMatches("0".repeat(32), 1, 40, pool, 16);
    expect(found.map((m) => m.entryId)).toEqual([2]);
  });

  test("a null author excludes nothing by authorship", () => {
    const found = nearMatches("0".repeat(32), 99, null, pool, 0);
    expect(found.map((m) => m.entryId).sort()).toEqual([1, 4]);
  });

  test("old-format hashes never match, even at zero nominal distance", () => {
    const found = nearMatches("0".repeat(32), 99, null, pool, 128);
    expect(found.map((m) => m.entryId)).not.toContain(5);
  });
});

describe("isOlder", () => {
  const at = (iso: string) => new Date(iso);
  test("submission time decides when both are dated", () => {
    expect(
      isOlder(
        { submittedAt: at("2026-01-01T00:00:00Z"), entryId: 9 },
        { submittedAt: at("2026-02-01T00:00:00Z"), entryId: 1 },
      ),
    ).toBe(true);
  });
  test("falls back to entry id when dates are missing or tied", () => {
    expect(isOlder({ submittedAt: null, entryId: 1 }, { submittedAt: null, entryId: 2 })).toBe(
      true,
    );
    const tied = at("2026-01-01T00:00:00Z");
    expect(isOlder({ submittedAt: tied, entryId: 5 }, { submittedAt: tied, entryId: 2 })).toBe(
      false,
    );
  });
});

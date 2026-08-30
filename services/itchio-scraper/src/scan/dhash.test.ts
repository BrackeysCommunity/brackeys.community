import { describe, expect, test } from "bun:test";

import { isOlder } from "../jobs/scan.ts";
import { DHASH_HEIGHT, DHASH_WIDTH, dhashFromGray, hammingHex, nearMatches } from "./dhash.ts";

const PIXELS = DHASH_WIDTH * DHASH_HEIGHT;

/** Row-major gradient brightening left→right: every comparison is 0. */
const rising = Uint8Array.from({ length: PIXELS }, (_, i) => (i % DHASH_WIDTH) * 20);
/** Darkening left→right: every comparison is 1. */
const falling = Uint8Array.from({ length: PIXELS }, (_, i) => 255 - (i % DHASH_WIDTH) * 20);

describe("dhashFromGray", () => {
  test("gradients hash to all-zero and all-one bits", () => {
    expect(dhashFromGray(rising)).toBe("0".repeat(16));
    expect(dhashFromGray(falling)).toBe("f".repeat(16));
  });

  test("hash is 16 hex chars and stable", () => {
    const noisy = Uint8Array.from({ length: PIXELS }, (_, i) => (i * 37) % 256);
    const hash = dhashFromGray(noisy);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(dhashFromGray(noisy)).toBe(hash);
  });

  test("a single flipped comparison moves exactly one bit", () => {
    const tweaked = Uint8Array.from(rising);
    // Make pixel (0,0) brighter than its right neighbor.
    tweaked[0] = 255;
    expect(hammingHex(dhashFromGray(rising), dhashFromGray(tweaked))).toBe(1);
  });

  test("rejects wrong-size input", () => {
    expect(() => dhashFromGray(new Uint8Array(10))).toThrow();
  });
});

describe("hammingHex", () => {
  test("identical hashes are distance 0", () => {
    expect(hammingHex("abcdef0123456789", "abcdef0123456789")).toBe(0);
  });
  test("complementary hashes are distance 64", () => {
    expect(hammingHex("0".repeat(16), "f".repeat(16))).toBe(64);
  });
  test("counts scattered bits", () => {
    expect(hammingHex("0".repeat(16), "8000000000000001")).toBe(2);
  });
});

describe("nearMatches", () => {
  const pool = [
    { entryId: 1, authorId: 10, coverPhash: "0000000000000000" },
    { entryId: 2, authorId: 20, coverPhash: "0000000000000003" }, // distance 2
    { entryId: 3, authorId: 30, coverPhash: "ffffffffffffffff" }, // distance 64
    { entryId: 4, authorId: 40, coverPhash: "0000000000000000" }, // exact
  ];

  test("finds entries within the distance budget", () => {
    const found = nearMatches("0000000000000000", 99, 99, pool, 6);
    expect(found.map((m) => m.entryId).sort()).toEqual([1, 2, 4]);
    expect(found.find((m) => m.entryId === 2)?.distance).toBe(2);
  });

  test("excludes the entry itself and the same author", () => {
    const found = nearMatches("0000000000000000", 1, 40, pool, 6);
    expect(found.map((m) => m.entryId)).toEqual([2]);
  });

  test("a null author excludes nothing by authorship", () => {
    const found = nearMatches("0000000000000000", 99, null, pool, 0);
    expect(found.map((m) => m.entryId).sort()).toEqual([1, 4]);
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

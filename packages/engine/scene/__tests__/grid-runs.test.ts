import { describe, expect, it } from "vite-plus/test";

import { decodeRow, forEachRun, GRID_ROW_PATTERN, gridCellBounds } from "../grid";
import { rng } from "./fixtures/random-ops";

/** The row grammar as the pattern states it, plus its bounds: values ≤ 65535, 32 cells at most. */
function inGrammar(row: string): boolean {
  if (!GRID_ROW_PATTERN.test(row)) return false;
  if (row === "") return true;
  let n = 0;
  for (const run of row.split(",")) {
    const [v, c] = run.split("*");
    if (Number(v) > 65535) return false;
    n += c === undefined ? 1 : Number(c);
  }
  return n <= 32;
}

describe("forEachRun", () => {
  it("accepts exactly the row grammar", () => {
    const rand = rng(7);
    const alphabet = "0123456789*,";
    const fixed = [
      "",
      "0",
      "00",
      "1*32",
      "1*33",
      "1*1",
      "1*05",
      "65535",
      "65536",
      "123456",
      "1,",
      ",1",
      "1,,2",
      "1*",
      "*2",
      "3*16,4*16",
      "3*16,4*17",
      "0*31,7",
      "1*100",
      "0*4,3*6,7",
    ];
    const random = Array.from({ length: 4000 }, () =>
      Array.from({ length: 1 + Math.floor(rand() * 10) }, () =>
        alphabet.charAt(Math.floor(rand() * alphabet.length)),
      ).join(""),
    );
    for (const row of [...fixed, ...random])
      expect(
        forEachRun(row, () => {}),
        JSON.stringify(row),
      ).toBe(inGrammar(row));
  });

  it("gives each run's value, first cell and length", () => {
    const runs: number[][] = [];
    expect(forEachRun("0*4,3*6,7", (v, s, n) => runs.push([v, s, n]))).toBe(true);
    expect(runs).toEqual([
      [0, 0, 4],
      [3, 4, 6],
      [7, 10, 1],
    ]);
    expect(Array.from(decodeRow("0*4,3*6,7")!.subarray(0, 12))).toEqual([
      0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 7, 0,
    ]);
  });
});

describe("gridCellBounds", () => {
  it("spans the non-empty cells across chunks, leading and trailing zeros left out", () => {
    expect(gridCellBounds({ "0,0": ["", "0*3,5,0,6"], "-1,2": ["0*31,1"] })).toEqual({
      c0: -1,
      r0: 1,
      c1: 5,
      r1: 64,
    });
    expect(gridCellBounds({ "0,0": ["", "0*3"] })).toBeNull();
    expect(() => gridCellBounds({ "0,0": ["1*40"] })).toThrow(/row 0 isn't a valid row/);
  });
});

import { describe, expect, test } from "vite-plus/test";

import { bareNumbers, placedLine, stagedGoodsLine, stagedLine } from "../src/index.ts";

describe("staged and placed lines", () => {
  test("a staging names its admins, or its staff and their event points", () => {
    expect(stagedLine({ by: "admins", label: "Lantern Hall" })).toBe(
      "Staged by the admins of Lantern Hall",
    );
    expect(stagedLine({ by: "staff", label: "Lantern Hall", points: 80 })).toBe(
      "Staged by staff of Lantern Hall · 80 event points",
    );
    expect(stagedLine({ by: "staff", label: "Lantern Hall" })).toBe(
      "Staged by staff of Lantern Hall",
    );
    expect(placedLine({ by: "staff", label: "Lantern Hall", points: 60 })).toBe(
      "Placed by staff of Lantern Hall · 60 event points",
    );
  });

  test("staged goods say where they stay", () => {
    expect(stagedGoodsLine({ settlement: 3, name: "Old Rail" })).toBe("staged · local to Old Rail");
    expect(stagedGoodsLine({ settlement: 3, name: "" })).toBe("staged · local to its settlement");
  });

  test("no number goes out bare", () => {
    for (const points of [0, 1, 80, 1234])
      for (const by of ["admins", "staff"]) {
        expect(bareNumbers(stagedLine({ by, label: "Lantern Hall", points }))).toEqual([]);
        expect(bareNumbers(placedLine({ by, label: "Lantern Hall", points }))).toEqual([]);
      }
  });
});

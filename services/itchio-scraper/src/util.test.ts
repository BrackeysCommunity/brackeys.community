import { describe, expect, test } from "bun:test";

import { chunk } from "./util.ts";

describe("chunk", () => {
  test("splits into batches of at most the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("returns a single batch when under the size", () => {
    expect(chunk([1, 2], 500)).toEqual([[1, 2]]);
  });

  test("returns no batches for an empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  test("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

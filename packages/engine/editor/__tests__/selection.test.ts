import { describe, expect, it } from "vite-plus/test";

import { prune, remap, select } from "../selection";

const order = ["a", "b", "c", "d", "e"];

describe("select", () => {
  it("replaces, adds and toggles", () => {
    expect(select(["a"], ["b"], "replace")).toEqual(["b"]);
    expect(select(["a"], ["b", "a"], "add")).toEqual(["a", "b"]);
    expect(select(["a", "b"], ["b", "c"], "toggle")).toEqual(["a", "c"]);
  });

  it("selects a range from the anchor and keeps the anchor for the next range", () => {
    const first = select(["b"], ["d"], "range", order);
    expect([...first].sort()).toEqual(["b", "c", "d"]);
    expect(first.at(-1)).toBe("b");
    expect([...select(first, ["a"], "range", order)].sort()).toEqual(["a", "b"]);
  });

  it("falls back to the clicked ref without an anchor in order", () => {
    expect(select([], ["c"], "range", order)).toEqual(["c"]);
    expect(select(["zz"], ["c"], "range", order)).toEqual(["c"]);
  });
});

describe("prune and remap", () => {
  it("drops refs the document lost", () => {
    expect(prune(["a", "~solid:9", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
    expect(prune(["a"], ["b"])).toEqual([]);
  });

  it("follows renames from a map or a record", () => {
    expect(remap(["a", "b"], new Map([["a", "z"]]))).toEqual(["z", "b"]);
    expect(remap(["a", "b"], { b: "a" })).toEqual(["a"]);
  });
});

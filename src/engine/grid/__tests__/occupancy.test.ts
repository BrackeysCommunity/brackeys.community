// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createOccupancy } from "../occupancy";

describe("occupancy", () => {
  it("lists a cell's ids in placement order, and a move appends to the new cell", () => {
    const o = createOccupancy();
    o.place("a", [1, 1]);
    o.place("b", [1, 1]);
    o.place("c", [2, 1]);
    expect(o.at([1, 1])).toEqual(["a", "b"]);
    o.place("c", [1, 1]);
    expect(o.at([1, 1])).toEqual(["a", "b", "c"]);
    expect(o.at([2, 1])).toEqual([]);
    o.place("a", [-3, 4]);
    expect(o.at([1, 1])).toEqual(["b", "c"]);
    expect(o.cellOf("a")).toEqual([-3, 4]);
    // Placing again on the same cell keeps its place.
    o.place("b", [1, 1], { blocks: false });
    expect(o.at([1, 1])).toEqual(["b", "c"]);
    expect(o.cellOf("nobody")).toBeUndefined();
  });

  it("hands out copies, so a caller can't reorder the cell", () => {
    const o = createOccupancy();
    o.place("a", [0, 0]);
    const ids = o.at([0, 0]) as string[];
    ids.push("x");
    expect(o.at([0, 0])).toEqual(["a"]);
  });

  it("blocks a cell while any blocking occupant stands on it", () => {
    const o = createOccupancy();
    o.place("ghost", [0, 0], { blocks: false });
    expect(o.blocked([0, 0])).toBe(false);
    o.place("rock", [0, 0]);
    o.place("crate", [0, 0], { blocks: true });
    expect(o.blocked([0, 0])).toBe(true);
    o.remove("rock");
    expect(o.blocked([0, 0])).toBe(true);
    o.place("crate", [0, 0], { blocks: false });
    expect(o.blocked([0, 0])).toBe(false);
    o.place("crate", [0, 0], { blocks: true });
    o.place("crate", [5, 0]);
    expect(o.blocked([0, 0])).toBe(false);
    expect(o.blocked([5, 0])).toBe(true);
    o.remove("crate");
    o.remove("crate");
    expect(o.blocked([5, 0])).toBe(false);
    expect(o.at([5, 0])).toEqual([]);
  });

  it("keeps walls apart from occupants", () => {
    const o = createOccupancy();
    o.setWall([2, 3], true);
    expect(o.wall([2, 3])).toBe(true);
    expect(o.blocked([2, 3])).toBe(false);
    o.place("a", [2, 3]);
    o.setWall([2, 3], false);
    expect(o.wall([2, 3])).toBe(false);
    expect(o.blocked([2, 3])).toBe(true);
    o.setWall([2, 3], true);
    o.setWall([2, 3], true);
    o.setWall([2, 3], false);
    expect(o.wall([2, 3])).toBe(false);
  });

  it("clears occupants, blockers and walls", () => {
    const o = createOccupancy();
    o.place("a", [0, 0]);
    o.setWall([1, 0], true);
    o.clear();
    expect(o.at([0, 0])).toEqual([]);
    expect(o.blocked([0, 0])).toBe(false);
    expect(o.wall([1, 0])).toBe(false);
    expect(o.cellOf("a")).toBeUndefined();
    o.place("a", [0, 0]);
    expect(o.at([0, 0])).toEqual(["a"]);
  });

  it("refuses a cell outside the packed range", () => {
    expect(() => createOccupancy().place("a", [2 ** 20, 0])).toThrow(RangeError);
  });
});

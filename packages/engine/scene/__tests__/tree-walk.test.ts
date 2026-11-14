import { describe, expect, it } from "vite-plus/test";

import { treeWalk } from "../resolve";

describe("treeWalk", () => {
  const items = [
    { id: "a" },
    { id: "b", parent: "a" },
    { id: "c" },
    { id: "d", parent: "a" },
    { id: "x", parent: "y" },
    { id: "y", parent: "x" },
    { id: "lost", parent: "gone" },
  ];
  const walk = () => treeWalk(items, (i) => i.parent);

  it("hands out each parent's items in input order, once", () => {
    const w = walk();
    expect(w.take(undefined).map((i) => i.id)).toEqual(["a", "c"]);
    expect(w.take("a").map((i) => i.id)).toEqual(["b", "d"]);
    expect(w.take("a")).toEqual([]);
  });

  it("leaves loops and missing parents for rest, in input order", () => {
    const w = walk();
    w.take(undefined);
    w.take("a");
    expect(w.rest()?.id).toBe("x");
    expect(w.take("x").map((i) => i.id)).toEqual(["y"]);
    expect(w.rest()?.id).toBe("lost");
    expect(w.rest()).toBeUndefined();
  });
});

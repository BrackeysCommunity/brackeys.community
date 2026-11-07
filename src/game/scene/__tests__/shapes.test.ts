import { describe, expect, it } from "vite-plus/test";

import { ShapeTupleSchema, parseShape, shapeToTuple } from "../shapes";
import type { ShapeObj } from "../types";

function issueOf(input: unknown, path?: string) {
  const r = parseShape(input, path);
  if (r.ok) throw new Error("expected a failure");
  return r.issue;
}

describe("parseShape tuples", () => {
  it("parses each tag", () => {
    expect(parseShape(["box", 1, 2, 3, 4])).toEqual({
      ok: true,
      shape: { type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 0 },
    });
    expect(parseShape(["box", 1, 2, 3, 4, 45])).toEqual({
      ok: true,
      shape: { type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 45 },
    });
    expect(parseShape(["circle", 5, 6, 7])).toEqual({
      ok: true,
      shape: { type: "circle", cx: 5, cy: 6, r: 7 },
    });
    expect(parseShape(["capsule", 0, 0, 10, 4])).toEqual({
      ok: true,
      shape: { type: "capsule", cx: 0, cy: 0, halfLen: 10, r: 4, rotDeg: 0 },
    });
    expect(parseShape(["poly", 0, 0, 10, 0, 0, 10])).toEqual({
      ok: true,
      shape: {
        type: "poly",
        pts: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
      },
    });
    expect(parseShape(["chain", 0, 0, 10, 5])).toEqual({
      ok: true,
      shape: {
        type: "chain",
        pts: [
          [0, 0],
          [10, 5],
        ],
      },
    });
  });

  it("reports the signature on wrong arity", () => {
    const issue = issueOf(["box", 1, 2, 3], "/solid/0");
    expect(issue.code).toBe("bad-shape");
    expect(issue.severity).toBe("error");
    expect(issue.message).toBe('box expects ["box", cx, cy, hw, hh, rotDeg?]; got 4 values');
    expect(issue.path).toBe("/solid/0");
    expect(issueOf(["circle", 1, 2, 3, 4]).message).toBe(
      'circle expects ["circle", cx, cy, r]; got 5 values',
    );
    expect(issueOf(["capsule", 1, 2, 3, 4, 5, 6]).message).toContain("got 7 values");
  });

  it("suggests the closest tag for an unknown one", () => {
    const issue = issueOf(["boxx", 1, 2, 3, 4], "/solid/2");
    expect(issue.code).toBe("bad-shape");
    expect(issue.message).toContain('did you mean "box"?');
    expect(issue.path).toBe("/solid/2/0");
    expect(issueOf(["circel", 1, 2, 3]).message).toContain('"circle"');
    expect(issueOf(["zzzzzz", 1]).message).not.toContain("did you mean");
    expect(issueOf([42, 1]).code).toBe("bad-shape");
  });

  it("rejects non-positive sizes, non-numbers and short point lists", () => {
    expect(issueOf(["box", 0, 0, 0, 4]).message).toContain("hw must be > 0");
    expect(issueOf(["circle", 0, 0, -1]).message).toContain("r must be > 0");
    expect(issueOf(["capsule", 0, 0, 0, 1]).message).toContain("halfLen");
    expect(issueOf(["box", 0, "1", 2, 2], "/x").path).toBe("/x/2");
    expect(issueOf(["box", 0, Infinity, 2, 2]).code).toBe("bad-shape");
    expect(issueOf(["poly", 0, 0, 1, 1]).message).toContain("at least 3 points");
    expect(issueOf(["poly", 0, 0, 1, 1, 2]).message).toContain("odd number");
    expect(issueOf(["chain", 0, 0]).message).toContain("at least 2 points");
    expect(issueOf([]).code).toBe("bad-shape");
    expect(issueOf("box").code).toBe("bad-shape");
  });

  it("parses non-integers (the validator warns)", () => {
    expect(parseShape(["box", 0.5, 0, 1.5, 1]).ok).toBe(true);
  });
});

describe("parseShape objects and rect sugar", () => {
  it("accepts a ShapeObj", () => {
    const box: ShapeObj = { type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 0 };
    expect(parseShape(box)).toEqual({ ok: true, shape: box });
    expect(
      parseShape({
        type: "poly",
        pts: [
          [0, 0],
          [4, 0],
          [0, 4],
        ],
      }).ok,
    ).toBe(true);
    expect(parseShape({ type: "circle", cx: 0, cy: 0, r: 0 }).ok).toBe(false);
  });

  it("turns an even rect into a box", () => {
    expect(parseShape({ type: "rect", left: 100, top: 900, right: 200, bottom: 916 })).toEqual({
      ok: true,
      shape: { type: "box", cx: 150, cy: 908, hw: 50, hh: 8, rotDeg: 0 },
    });
  });

  it("rejects an odd rect with a widen-by-1 hint instead of rounding", () => {
    const issue = issueOf({ type: "rect", left: 100, top: 900, right: 201, bottom: 915 });
    expect(issue.code).toBe("bad-shape");
    expect(issue.hint).toBe("Widen it by 1px (right: 202, bottom: 916).");
    expect(issueOf({ type: "rect", left: 0, top: 0, right: 0, bottom: 2 }).message).toContain(
      "right > left",
    );
  });

  it("suggests a type for an unknown object", () => {
    expect(issueOf({ type: "rekt" }).message).toContain("did you mean");
  });
});

describe("shapeToTuple", () => {
  it("drops rotDeg when 0 and round-trips", () => {
    expect(shapeToTuple({ type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 0 })).toEqual([
      "box",
      1,
      2,
      3,
      4,
    ]);
    expect(shapeToTuple({ type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 30 })).toEqual([
      "box",
      1,
      2,
      3,
      4,
      30,
    ]);
    expect(shapeToTuple({ type: "capsule", cx: 1, cy: 2, halfLen: 3, r: 4, rotDeg: 0 })).toEqual([
      "capsule",
      1,
      2,
      3,
      4,
    ]);
    for (const t of [
      ["circle", 1, 2, 3],
      ["poly", 0, 0, 4, 0, 0, 4],
      ["chain", 0, 0, 5, 5],
    ] as const) {
      const r = parseShape(t);
      expect(r.ok && shapeToTuple(r.shape)).toEqual(t);
    }
  });
});

describe("ShapeTupleSchema", () => {
  it("validates through parseShape, keeping its message", () => {
    expect(ShapeTupleSchema.safeParse(["box", 1, 2, 3, 4]).success).toBe(true);
    const bad = ShapeTupleSchema.safeParse(["box", 1, 2, 3]);
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toBe(
      'box expects ["box", cx, cy, hw, hh, rotDeg?]; got 4 values',
    );
    expect(
      ShapeTupleSchema.safeParse({ type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 0 }).success,
    ).toBe(false);
  });
});

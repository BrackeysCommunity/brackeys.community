import { describe, expect, it } from "vite-plus/test";

import { lengthUnitOf } from "../../game/units";
import { ShapeTupleSchema, mapShapeLengths, parseShape, shapeToTuple } from "../shapes";
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

  it("turns a rect into a box, in metres", () => {
    expect(parseShape({ type: "rect", left: 1, top: 9, right: 2, bottom: 9.16 })).toMatchObject({
      ok: true,
      shape: { type: "box", cx: 1.5, hw: 0.5, rotDeg: 0 },
    });
  });

  it("takes any width a rect gives, odd or not (the validator judges whole pixels)", () => {
    expect(parseShape({ type: "rect", left: 0, top: 0, right: 1, bottom: 3 })).toEqual({
      ok: true,
      shape: { type: "box", cx: 0.5, cy: 1.5, hw: 0.5, hh: 1.5, rotDeg: 0 },
    });
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
    expect(bad.error?.issues[0]?.message).toBe(
      'box expects ["box", cx, cy, hw, hh, rotDeg?]; got 4 values',
    );
    expect(
      ShapeTupleSchema.safeParse({ type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 0 }).success,
    ).toBe(false);
  });
});

describe("shape units", () => {
  it("a shape field declares metres", () => {
    expect(lengthUnitOf(ShapeTupleSchema)).toBe("m");
    expect(lengthUnitOf(ShapeTupleSchema.optional())).toBe("m");
  });

  it("mapShapeLengths scales every length and never the angle", () => {
    const half = (n: number) => n / 2;
    expect(mapShapeLengths(["box", 2, 4, 6, 8, 90], half)).toEqual(["box", 1, 2, 3, 4, 90]);
    expect(mapShapeLengths(["capsule", 2, 4, 6, 8, 30], half)).toEqual(["capsule", 1, 2, 3, 4, 30]);
    expect(mapShapeLengths(["circle", 2, 4, 6], half)).toEqual(["circle", 1, 2, 3]);
    expect(mapShapeLengths(["poly", 0, 0, 4, 0, 0, 4], half)).toEqual(["poly", 0, 0, 2, 0, 0, 2]);
    expect(mapShapeLengths(["chain", 2, 2, 4, 4, 6, 6], half)).toEqual(["chain", 1, 1, 2, 2, 3, 3]);
    expect(mapShapeLengths(["rekt", 2], half)).toEqual(["rekt", 2]);
    expect(mapShapeLengths("box", half)).toBe("box");
  });
});

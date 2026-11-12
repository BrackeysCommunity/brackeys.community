import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import {
  angleField,
  mirrorField,
  PathSchema,
  pointField,
  shapeField,
  sideField,
  SIDES,
  tagsField,
  vectorField,
} from "../../game/fields";
import type { Registry, Side } from "../../game/types";
import { transformGrid } from "../grid";
import { applyPt, applyVec, dihedral, IDENTITY_2D, type Dihedral } from "../transform";
import {
  transformBulkEntry,
  transformEntityDef,
  transformFieldValue,
  transformTuple,
  translateBulkEntry,
  translateEntityDef,
  translateFieldValue,
} from "../translate";
import type { EntityDef, PathDef, Pt, ShapeTuple } from "../types";

vi.mock("../grid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../grid")>()),
  transformGrid: vi.fn((grid: unknown, d: Dihedral) => ({ transformed: grid, d })),
}));

const ELEMENTS: Dihedral[] = [false, true].flatMap((flip) =>
  ([0, 1, 2, 3] as const).map((rot) => ({ rot, flip })),
);
const AT: Pt = [100, 40];
const label = (d: Dihedral) => `rot ${d.rot}${d.flip ? " flip" : ""}`;

const gridSchema = z.record(z.string(), z.array(z.string())).meta({ kind: "grid" });
const schemas = {
  shape: shapeField("A shape."),
  point: pointField("A point."),
  path: PathSchema,
  vector: vectorField("A launch direction."),
  angle: angleField("A facing.", "deg"),
  mirror: mirrorField("x", "Mirrored."),
  side: sideField("A side."),
  grid: gridSchema,
  tags: tagsField("Labels."),
  tuple: z.tuple([z.number(), z.number()]).describe("A plain pair."),
  number: z.number().describe("A plain number."),
};

/** The signed area of a polygon's points: its winding. */
function signedArea(coords: number[]): number {
  let sum = 0;
  const n = coords.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += (coords[2 * i] ?? 0) * (coords[2 * j + 1] ?? 0);
    sum -= (coords[2 * j] ?? 0) * (coords[2 * i + 1] ?? 0);
  }
  return sum / 2;
}

describe("transformFieldValue: each kind under each element", () => {
  for (const d of ELEMENTS) {
    const t = dihedral(d, AT);
    it(label(d), () => {
      expect(transformFieldValue(schemas.point, [3, 4], t)).toEqual(applyPt(t, [3, 4]));
      expect(transformFieldValue(schemas.vector, [3, 4], t)).toEqual(applyVec(t, [3, 4]));
      expect(
        transformFieldValue(
          schemas.path,
          {
            pts: [
              [0, 0],
              [10, 5],
            ],
            mode: "loop",
            speed: 2,
          },
          t,
        ),
      ).toEqual({ pts: [applyPt(t, [0, 0]), applyPt(t, [10, 5])], mode: "loop", speed: 2 });
      expect(transformFieldValue(schemas.angle, 30, t)).toBe((d.flip ? -30 : 30) + 90 * d.rot);
      expect(transformFieldValue(schemas.mirror, false, t)).toBe(d.flip);
      expect(transformFieldValue(schemas.mirror, true, t)).toBe(!d.flip);
      expect(transformFieldValue(schemas.tuple, [3, 4], t)).toEqual([3, 4]);
      const tags = ["up", "left", "spawn"];
      expect(transformFieldValue(schemas.tags, tags, t)).toBe(tags);
      expect(transformFieldValue(schemas.number, 30, t)).toBe(30);
      expect(transformFieldValue(schemas.shape, ["circle", 3, 4, 7], t)).toEqual([
        "circle",
        ...applyPt(t, [3, 4]),
        7,
      ]);
    });
  }

  it("never translates a vector", () => {
    expect(
      transformFieldValue(schemas.vector, [3, 4], dihedral({ rot: 0, flip: false }, AT)),
    ).toEqual([3, 4]);
  });

  it("delegates grids to transformGrid, only when they turn or flip", () => {
    const cells = { "0,0": ["1*2"] };
    vi.mocked(transformGrid).mockClear();
    expect(transformFieldValue(schemas.grid, cells, dihedral({ rot: 0, flip: false }, AT))).toBe(
      cells,
    );
    expect(transformGrid).not.toHaveBeenCalled();
    const d: Dihedral = { rot: 1, flip: true };
    expect(transformFieldValue(schemas.grid, cells, dihedral(d, AT))).toEqual({
      transformed: cells,
      d,
    });
  });

  it("leaves values not shaped like their kind alone", () => {
    const t = dihedral({ rot: 1, flip: true }, AT);
    expect(transformFieldValue(schemas.point, "nope", t)).toBe("nope");
    expect(transformFieldValue(schemas.angle, "nope", t)).toBe("nope");
    expect(transformFieldValue(schemas.mirror, 1, t)).toBe(1);
    expect(transformFieldValue(schemas.vector.optional(), undefined, t)).toBeUndefined();
  });

  it("refuses a turn-dependent kind under a transform outside the group", () => {
    const scale = { ...IDENTITY_2D, a: 2 };
    expect(transformFieldValue(schemas.point, [1, 1], scale)).toEqual([2, 1]);
    expect(() => transformFieldValue(schemas.angle, 0, scale)).toThrow(/quarter turns/);
  });
});

describe("transformFieldValue: sides", () => {
  /** `side` after `d`, by the clockwise order: a flip mirrors left and right, then each turn steps one side clockwise. */
  const expected = (side: Side, d: Dihedral): Side => {
    const mirrored = !d.flip ? side : side === "left" ? "right" : side === "right" ? "left" : side;
    return SIDES[(SIDES.indexOf(mirrored) + d.rot) % 4]!;
  };

  for (const d of ELEMENTS) {
    it(label(d), () => {
      const t = dihedral(d, AT);
      for (const side of SIDES)
        expect(transformFieldValue(schemas.side, side, t)).toBe(expected(side, d));
      const up = expected("up", d);
      expect(transformFieldValue(schemas.side.optional(), true, t)).toBe(up === "up" ? true : up);
    });
  }

  it('turns `true` as "up" and keeps it `true` while it faces up', () => {
    expect(transformFieldValue(schemas.side, true, dihedral({ rot: 0, flip: false }, AT))).toBe(
      true,
    );
    expect(transformFieldValue(schemas.side, true, dihedral({ rot: 0, flip: true }, AT))).toBe(
      true,
    );
    expect(transformFieldValue(schemas.side, true, dihedral({ rot: 1, flip: false }, AT))).toBe(
      "right",
    );
    expect(transformFieldValue(schemas.side, true, dihedral({ rot: 2, flip: true }, AT))).toBe(
      "down",
    );
  });

  it("undoes a turn with its inverse", () => {
    for (const d of ELEMENTS) {
      const t = dihedral(d, AT);
      const back = dihedral(
        d.flip ? d : { rot: ((4 - d.rot) % 4) as Dihedral["rot"], flip: false },
        [0, 0],
      );
      for (const side of SIDES)
        expect(
          transformFieldValue(schemas.side, transformFieldValue(schemas.side, side, t), back),
        ).toBe(side);
    }
  });

  it("leaves a value that isn't a side alone", () => {
    const t = dihedral({ rot: 1, flip: false }, AT);
    expect(transformFieldValue(schemas.side, false, t)).toBe(false);
    expect(transformFieldValue(schemas.side, "north", t)).toBe("north");
    expect(transformFieldValue(schemas.side.optional(), undefined, t)).toBeUndefined();
  });
});

describe("transformTuple", () => {
  it("turns a box by rotDeg and keeps hw/hh", () => {
    const t = dihedral({ rot: 1, flip: false }, [0, 0]);
    expect(transformTuple(["box", 10, 0, 30, 5], t)).toEqual(["box", 0, 10, 30, 5, 90]);
    expect(transformTuple(["box", 10, 0, 30, 5, 300], t)).toEqual(["box", 0, 10, 30, 5, 30]);
  });

  it("negates rotDeg under a flip, and leaves no rotDeg of 0", () => {
    const flip = dihedral({ rot: 0, flip: true }, [0, 0]);
    expect(transformTuple(["box", 10, 0, 30, 5, 30], flip)).toEqual(["box", -10, 0, 30, 5, 330]);
    expect(transformTuple(["box", 10, 0, 30, 5], flip)).toEqual(["box", -10, 0, 30, 5]);
    expect(transformTuple(["box", 10, 0, 30, 5, 0], flip)).toEqual(["box", -10, 0, 30, 5]);
  });

  it("drops rotDeg when a turn brings it back to 0", () => {
    const quarter = dihedral({ rot: 1, flip: false }, [0, 0]);
    expect(transformTuple(["box", 10, 0, 30, 5, 270], quarter)).toEqual(["box", 0, 10, 30, 5]);
    expect(
      transformTuple(["capsule", 0, 10, 20, 4, 90], dihedral({ rot: 1, flip: true }, [0, 0])),
    ).toEqual(["capsule", -10, 0, 20, 4]);
    const half = dihedral({ rot: 2, flip: false }, [0, 0]);
    expect(transformTuple(["box", 0, 0, 30, 5, 180], half)).toEqual(["box", 0, 0, 30, 5]);
  });

  it("keeps an explicit rotDeg of 0 under a plain translation", () => {
    expect(
      transformTuple(["box", 1, 2, 3, 4, 0], dihedral({ rot: 0, flip: false }, [5, 5])),
    ).toEqual(["box", 6, 7, 3, 4, 0]);
  });

  it("turns a capsule the same way", () => {
    const t = dihedral({ rot: 3, flip: true }, [0, 0]);
    expect(transformTuple(["capsule", 0, 0, 20, 4, 10], t)).toEqual(["capsule", 0, 0, 20, 4, 260]);
  });

  it("keeps a flipped polygon's winding and point set", () => {
    const poly: ShapeTuple = ["poly", 0, 0, 10, 0, 10, 10, 0, 10];
    const area = signedArea(poly.slice(1) as number[]);
    for (const d of ELEMENTS) {
      const out = transformTuple(poly, dihedral(d, AT));
      expect(out[0]).toBe("poly");
      const coords = out.slice(1) as number[];
      expect(signedArea(coords), label(d)).toBe(area);
      const pts = (c: number[]) =>
        Array.from({ length: c.length / 2 }, (_, i) => `${c[2 * i]},${c[2 * i + 1]}`).sort();
      const t = dihedral(d, AT);
      expect(pts(coords)).toEqual(
        pts(
          Array.from({ length: 4 }, (_, i) =>
            applyPt(t, [poly[1 + 2 * i] as number, poly[2 + 2 * i] as number]),
          ).flat(),
        ),
      );
    }
  });

  it("reverses a flipped chain", () => {
    const flip = dihedral({ rot: 0, flip: true }, [0, 0]);
    expect(transformTuple(["chain", 0, 0, 10, 0, 20, 5], flip)).toEqual([
      "chain",
      -20,
      5,
      -10,
      0,
      0,
      0,
    ]);
  });
});

describe("transformBulkEntry", () => {
  it("moves points and shape tuples", () => {
    const t = dihedral({ rot: 2, flip: false }, AT);
    expect(transformBulkEntry([1, 2], t)).toEqual([99, 38]);
    expect(transformBulkEntry(["box", 1, 2, 3, 4], t)).toEqual(["box", 99, 38, 3, 4, 180]);
  });
});

function fakeRegistry(shape: z.ZodRawShape): Registry {
  return { types: new Map([["thing", { shape }]]) } as unknown as Registry;
}

describe("transformEntityDef", () => {
  const registry = fakeRegistry({
    shape: schemas.shape,
    launch: schemas.vector,
    facing: schemas.angle,
    flipped: schemas.mirror,
    offset: schemas.tuple,
    speed: schemas.number,
  });
  const def: EntityDef = {
    id: "a",
    type: "thing",
    shape: ["box", 10, 0, 30, 5],
    launch: [1, 0],
    facing: 0,
    flipped: false,
    offset: [5, 5],
    speed: 3,
  };

  it("acts on each field by kind and leaves plain ones", () => {
    const out = transformEntityDef(registry, def, dihedral({ rot: 1, flip: true }, AT));
    expect(out).toEqual({
      ...def,
      shape: ["box", 100, 30, 30, 5, 90],
      launch: [0, -1],
      facing: 90,
      flipped: true,
      offset: [5, 5],
      speed: 3,
    });
    expect(def.shape).toEqual(["box", 10, 0, 30, 5]);
  });

  it("turns a one-way solid's side with it, and leaves it alone under a translation", () => {
    const registry = createRegistry();
    const solid: EntityDef = { id: "s", type: "solid", shape: ["box", 0, 0, 40, 4], oneWay: true };
    expect(transformEntityDef(registry, solid, dihedral({ rot: 1, flip: false }, AT))?.oneWay).toBe(
      "right",
    );
    expect(
      transformEntityDef(
        registry,
        { ...solid, oneWay: "left" },
        dihedral({ rot: 0, flip: true }, AT),
      )?.oneWay,
    ).toBe("right");
    expect(translateEntityDef(registry, solid, [5, 5])?.oneWay).toBe(true);
  });

  it("leaves a marker's tags as written under every element", () => {
    const registry = createRegistry();
    const marker: EntityDef = { id: "m", type: "marker", at: [3, 4], tags: ["up", "left"] };
    for (const d of ELEMENTS) {
      const t = dihedral(d, AT);
      expect(transformEntityDef(registry, marker, t)).toEqual({
        ...marker,
        at: applyPt(t, [3, 4]),
      });
    }
  });

  it("is null for an entity with nothing a transform acts on", () => {
    expect(
      transformEntityDef(registry, { id: "b", type: "thing", speed: 1 }, IDENTITY_2D),
    ).toBeNull();
    expect(transformEntityDef(registry, { id: "c", type: "nope" }, IDENTITY_2D)).toBeNull();
  });

  it("turns but doesn't move shapes local to a path", () => {
    const registry = createRegistry();
    const follower: EntityDef = {
      id: "f",
      type: "follower",
      shape: ["box", 5, 0, 40, 6],
      path: {
        pts: [
          [0, 0],
          [100, 0],
        ],
        mode: "loop",
        speed: 50,
      } satisfies PathDef,
    };
    const t = dihedral({ rot: 1, flip: false }, AT);
    expect(transformEntityDef(registry, follower, t)).toEqual({
      ...follower,
      shape: ["box", 0, 5, 40, 6, 90],
      path: {
        pts: [
          [100, 40],
          [100, 140],
        ],
        mode: "loop",
        speed: 50,
      },
    });
  });
});

describe("the translate wrappers", () => {
  const registry = createRegistry();

  it("translate entities as before", () => {
    expect(
      translateEntityDef(
        registry,
        { id: "s", type: "solid", shape: ["poly", 0, 0, 4, 0, 4, 4] },
        [10, 20],
      ),
    ).toEqual({ id: "s", type: "solid", shape: ["poly", 10, 20, 14, 20, 14, 24] });
    expect(translateEntityDef(registry, { id: "m", type: "marker", at: [1, 2] }, [1, 1])).toEqual({
      id: "m",
      type: "marker",
      at: [2, 3],
    });
    const follower: EntityDef = {
      id: "f",
      type: "follower",
      shape: ["box", 0, 0, 40, 6],
      path: { pts: [[0, 0]], mode: "loop", speed: 50 },
    };
    expect(translateEntityDef(registry, follower, [5, 5])).toEqual({
      ...follower,
      path: { pts: [[5, 5]], mode: "loop", speed: 50 },
    });
  });

  it("translate bulk entries without turning boxes", () => {
    expect(translateBulkEntry(["box", 1, 2, 3, 4], [10, 10])).toEqual(["box", 11, 12, 3, 4]);
    expect(translateBulkEntry([1, 2], [10, 10])).toEqual([11, 12]);
  });

  it("translate field values at a path", () => {
    const marker: EntityDef = { id: "m", type: "marker", at: [0, 0] };
    expect(translateFieldValue(registry, marker, "at", [1, 2], [10, 10])).toEqual([11, 12]);
    expect(translateFieldValue(registry, marker, "tags", ["a"], [10, 10])).toEqual(["a"]);
    expect(translateFieldValue(registry, marker, "constructor", 1, [10, 10])).toBe(1);
    const follower: EntityDef = {
      id: "f",
      type: "follower",
      shape: ["box", 0, 0, 40, 6],
      path: { pts: [[0, 0]], mode: "loop", speed: 50 },
    };
    expect(translateFieldValue(registry, follower, "shape", ["box", 0, 0, 1, 1], [5, 5])).toEqual([
      "box",
      0,
      0,
      1,
      1,
    ]);
    expect(translateFieldValue(registry, follower, "path.pts.0", [1, 1], [5, 5])).toEqual([6, 6]);
    expect(translateFieldValue(registry, follower, "path.pts", [[1, 1]], [5, 5])).toEqual([[6, 6]]);
    expect(translateFieldValue(registry, follower, "path.speed", 3, [5, 5])).toBe(3);
  });
});

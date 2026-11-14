import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { angleField, mirrorField, pointField, shapeField, vectorField } from "../../game/fields";
import { transformGrid } from "../grid";
import { applyOps, toSourceBatch } from "../ops";
import { prefabLibrary } from "../prefab";
import { instanceTransform, resolveScene, resolveSceneDetailed } from "../resolve";
import { aabb } from "../shape-geometry";
import { parseShape } from "../shapes";
import { compose, dihedral, dihedralOf, type Dihedral } from "../transform";
import { transformEntityDef, translateEntityDef } from "../translate";
import type { EntityDef, InstanceDef, OpBatch, PrefabLibrary, Pt, SceneDefinition } from "../types";
import { engine, engineYard, yardPrefabs } from "./fixtures/random-ops";

vi.mock("../grid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../grid")>()),
  transformGrid: vi.fn((grid: unknown, d: Dihedral) => ({ turned: grid, d })),
}));

const prefabs = yardPrefabs();

function source(def: SceneDefinition, batch: OpBatch): OpBatch {
  const r = toSourceBatch(def, batch, engine, prefabs);
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r.batch;
}

function applied(def: SceneDefinition, batch: OpBatch): SceneDefinition {
  const r = applyOps(def, batch, engine, { prefabs });
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r.def;
}

const resolvedZ = (def: SceneDefinition, id: string) =>
  resolveScene(def, engine, prefabs).entities!.find((e) => e.id === id)!.z;

/** engine-yard with gate-1 lifted by `z`. */
const lifted = (z: number) => {
  const def = engineYard();
  def.instances![0] = { ...def.instances![0]!, z };
  return def;
};

describe("resolveScene: z", () => {
  it("adds an instance's z to each child's, leaving 0 absent", () => {
    const def = applied(lifted(2), {
      ops: [{ op: "override", ref: "gate-1", set: { "trigger.z": -2 } }],
    });
    expect(resolvedZ(def, "gate-1/door")).toBe(2);
    expect(resolvedZ(def, "gate-1/trigger")).toBeUndefined();
    expect(resolvedZ(engineYard(), "gate-1/door")).toBeUndefined();
  });
});

describe("toSourceBatch: setZ", () => {
  it("makes setZ on an instance child an override of its z in the prefab's frame", () => {
    const def = lifted(2);
    const batch = source(def, { ops: [{ op: "setZ", refs: ["gate-1/door", "crate"], z: 5 }] });
    expect(batch.ops).toEqual([
      { op: "setZ", refs: ["crate"], z: 5 },
      { op: "override", ref: "gate-1", set: { "door.z": 3 } },
    ]);
    const after = applied(def, batch);
    expect(resolvedZ(after, "gate-1/door")).toBe(5);
    expect(after.instances![0]!.overrides).toEqual({ "door.z": 3 });
  });

  it("shifts a child by its own z and reverts the override when it lands on the prefab's value", () => {
    const def = applied(engineYard(), {
      ops: [{ op: "override", ref: "gate-1", set: { "door.z": 1 } }],
    });
    expect(source(def, { ops: [{ op: "setZ", refs: ["gate-1/door"], by: 2 }] }).ops).toEqual([
      { op: "override", ref: "gate-1", set: { "door.z": 3 } },
    ]);
    const back = source(def, { ops: [{ op: "setZ", refs: ["gate-1/door"], by: -1 }] });
    expect(back.ops).toEqual([{ op: "revertOverride", ref: "gate-1", paths: ["door.z"] }]);
    expect("overrides" in applied(def, back).instances![0]!).toBe(false);
    expect(
      source(engineYard(), { ops: [{ op: "setZ", refs: ["gate-1/door"], z: 0 }] }).ops,
    ).toEqual([]);
  });

  it("maps an update of a child's z through the instance's offset, like setZ", () => {
    const def = lifted(2);
    expect(
      source(def, { ops: [{ op: "update", ref: "gate-1/trigger", set: { z: 6 } }] }).ops,
    ).toEqual([{ op: "override", ref: "gate-1", set: { "trigger.z": 4 } }]);
  });

  it("overrides a child's z to 0 when an update lands it on the instance's own z", () => {
    const gate = structuredClone(prefabs.get("gate")!);
    gate.entities = gate.entities!.map((e) => (e.id === "trigger" ? { ...e, z: 4 } : e));
    const raised = prefabLibrary([gate, prefabs.get("post")!]);
    const def = lifted(2);
    const r = toSourceBatch(
      def,
      { ops: [{ op: "update", ref: "gate-1/trigger", set: { z: 2 } }] },
      engine,
      raised,
    );
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.batch.ops).toEqual([{ op: "override", ref: "gate-1", set: { "trigger.z": 0 } }]);
    const after = applyOps(def, r.batch, engine, { prefabs: raised });
    if (!after.ok) throw new Error(after.issue.message);
    expect(after.def.instances![0]!.overrides).toEqual({ "trigger.z": 0 });
    expect(
      resolveScene(after.def, engine, raised).entities!.find((e) => e.id === "gate-1/trigger")!.z,
    ).toBe(2);
  });

  it("reverts a child's z override when an update lands it back on the prefab's 0", () => {
    const def = applied(lifted(2), {
      ops: [{ op: "override", ref: "gate-1", set: { "trigger.z": 3 } }],
    });
    const back = source(def, { ops: [{ op: "update", ref: "gate-1/trigger", set: { z: 2 } }] });
    expect(back.ops).toEqual([{ op: "revertOverride", ref: "gate-1", paths: ["trigger.z"] }]);
    expect("overrides" in applied(def, back).instances![0]!).toBe(false);
  });

  it("refuses a bulk child and a child past the z range", () => {
    const bulk = toSourceBatch(
      engineYard(),
      { ops: [{ op: "setZ", refs: ["gate-1/~solid:0"], z: 1 }] },
      engine,
      prefabs,
    );
    expect(bulk.ok).toBe(false);
    if (!bulk.ok) expect(bulk.issue.code).toBe("op-invalid");
    const def = lifted(-10);
    const far = source(def, { ops: [{ op: "setZ", refs: ["gate-1/door"], z: 9995 }] });
    const r = applyOps(def, far, engine, { prefabs });
    expect(r.ok).toBe(false);
  });
});

// ─── Transforms ──────────────────────────────────────────

const ELEMENTS: Dihedral[] = [false, true].flatMap((flip) =>
  ([0, 1, 2, 3] as const).map((rot) => ({ rot, flip })),
);
const label = (d: Dihedral) => `rot ${d.rot}${d.flip ? " flip" : ""}`;
const spelled = (d: Dihedral) => ({
  ...(d.rot !== 0 ? { rot: 90 * d.rot } : {}),
  ...(d.flip ? { flip: true as const } : {}),
});

/** A game with an asymmetric kite (a polygon, a point, a vector, an angle, a mirror) and a grid. */
const spin = createRegistry(
  defineGame({
    id: "spin",
    types: [
      defineEntityType({
        type: "kite",
        description: "An asymmetric marker with a shape.",
        base: "marker",
        fields: {
          at: pointField("Anchor."),
          shape: shapeField("Body."),
          launch: vectorField("Launch direction."),
          facing: angleField("Facing.", "deg").optional(),
          mirrored: mirrorField("x", "Drawn mirrored."),
        },
      }),
      defineEntityType({
        type: "paint",
        description: "Cells on the grid.",
        base: "marker",
        fields: {
          at: pointField("Origin."),
          cells: z.record(z.string(), z.array(z.string())).meta({ kind: "grid" }),
        },
      }),
    ],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const WING: EntityDef = {
  id: "wing",
  type: "kite",
  at: [3, 5],
  shape: ["poly", 0, 0, 10, 0, 0, 4],
  launch: [2, -1],
  facing: 30,
  mirrored: false,
};

const kitePrefabs: PrefabLibrary = prefabLibrary([
  {
    kind: "prefab",
    v: 2,
    game: "spin",
    id: "kite",
    entities: [
      WING,
      {
        id: "lift",
        type: "follower",
        shape: ["box", 0, 0, 10, 4],
        path: {
          pts: [
            [0, 0],
            [20, 0],
          ],
          mode: "loop",
          speed: 10,
        },
      },
    ],
    bulk: { solid: [["box", 5, 6, 2, 3]] },
  },
  {
    kind: "prefab",
    v: 2,
    game: "spin",
    id: "tiles",
    entities: [{ id: "tiles", type: "paint", at: [0, 0], cells: { "0,0": ["1,2"] } }],
  },
]);

/** A node's frame: its `at`, `rot` in degrees and `flip`. */
type NodeFrame = { at: Pt; rot?: number; flip?: true };

/** A kite instance and a free kite, both under node `g` when `node` is given. */
function kiteScene(d: Dihedral, node?: NodeFrame): SceneDefinition {
  const under = node ? { parent: "g" } : {};
  return {
    v: 2,
    game: "spin",
    name: "kites",
    bounds: [0, 0, 1000, 1000],
    instances: [{ id: "k-1", prefab: "kite", at: [100, 40], ...spelled(d), ...under }],
    entities: [
      { id: "free", type: "kite", ...pick(WING), ...under },
      ...(node ? [{ id: "g", type: "node", ...node }] : []),
    ],
  };
}

const pick = ({ id: _id, type: _type, ...rest }: EntityDef) => rest;

function spinSource(def: SceneDefinition, batch: OpBatch): OpBatch {
  const r = toSourceBatch(def, batch, spin, kitePrefabs);
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r.batch;
}

function spinApplied(def: SceneDefinition, batch: OpBatch): SceneDefinition {
  const r = applyOps(def, batch, spin, { prefabs: kitePrefabs });
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r.def;
}

const resolvedOf = (def: SceneDefinition, id: string) =>
  resolveScene(def, spin, kitePrefabs).entities!.find((e) => e.id === id)!;

/** Maps a world-space batch to the source, applies it, and resolves `id` again. */
function roundTrip(def: SceneDefinition, batch: OpBatch, id: string) {
  const mapped = spinSource(def, batch);
  const after = spinApplied(def, mapped);
  return { mapped, after, entity: resolvedOf(after, id) };
}

/** Every number in a value. */
const numbersIn = (v: unknown): number[] =>
  typeof v === "number"
    ? [v]
    : Array.isArray(v)
      ? v.flatMap(numbersIn)
      : v !== null && typeof v === "object"
        ? Object.values(v).flatMap(numbersIn)
        : [];

const expectIntegers = (v: unknown) => {
  for (const n of numbersIn(v)) expect(Number.isInteger(n)).toBe(true);
};

const NODE: NodeFrame = { at: [7, -3], rot: 90, flip: true };

describe("resolveSceneDetailed: transforms", () => {
  for (const d of ELEMENTS) {
    it(`places each child under ${label(d)} exactly`, () => {
      const def = kiteScene(d);
      const { def: out, origins } = resolveSceneDetailed(def, spin, kitePrefabs);
      const t = dihedral(d, [100, 40]);
      const wing = out.entities!.find((e) => e.id === "k-1/wing")!;
      expect(wing).toEqual({ ...transformEntityDef(spin, WING, t), id: "k-1/wing" });
      expectIntegers(out.entities);
      const child = origins.find((o) => o.kind === "child" && o.child === "wing");
      expect(child).toEqual({
        kind: "child",
        instance: 0,
        child: "wing",
        path: ["k-1"],
        transform: { rot: 90 * d.rot, flip: d.flip },
      });
    });
  }

  it("composes the parent node's turn and flip outside the instance's", () => {
    for (const d of ELEMENTS) {
      const def = kiteScene(d, NODE);
      const { def: out, origins } = resolveSceneDetailed(def, spin, kitePrefabs);
      const g = dihedral({ rot: 1, flip: true }, [7, -3]);
      const wing = out.entities!.find((e) => e.id === "k-1/wing")!;
      const composed = compose(g, dihedral(d, [100, 40]));
      expect(instanceTransform(def, def.instances![0]!)).toEqual(composed);
      const twoStep = transformEntityDef(
        spin,
        transformEntityDef(spin, WING, dihedral(d, [100, 40]))!,
        g,
      )!;
      expect(wing).toEqual({ ...twoStep, id: "k-1/wing" });
      // The composed transform lands on the same geometry; angles agree up to whole turns.
      const { facing, ...once } = transformEntityDef(spin, WING, composed)!;
      expect({ ...wing, facing: 0 }).toEqual({ ...once, facing: 0, id: "k-1/wing" });
      expect((((wing.facing as number) - (facing as number)) % 360) + 0).toBe(0);
      expect(out.entities!.find((e) => e.id === "free")).toEqual({
        ...transformEntityDef(spin, { ...WING, id: "free", parent: "g" }, g),
      });
      expect(origins[0]).toEqual({ kind: "entity", index: 0, transform: { rot: 90, flip: true } });
      expectIntegers(out.entities);
    }
  });

  it("turns grid cells only on a square grid with equal cells", () => {
    const turned = { rot: 1, flip: false } as const;
    const scene = (cell?: Pt): SceneDefinition => ({
      ...kiteScene(turned),
      instances: [{ id: "t-1", prefab: "tiles", at: [100, 40], rot: 90 }],
      ...(cell ? { settings: { grid: { kind: "square", cell } } } : {}),
    });
    const tiles = (def: SceneDefinition) => resolvedOf(def, "t-1/tiles").cells;
    const square = scene([16, 16]);
    const tall = scene([16, 32]);
    vi.mocked(transformGrid).mockClear();
    expect(tiles(square)).toEqual({ turned: { "0,0": ["1,2"] }, d: turned });
    expect(tiles(tall)).toEqual({ "0,0": ["1,2"] });
    expect(tiles(scene())).toEqual({ "0,0": ["1,2"] });
    expect(resolvedOf(tall, "t-1/tiles").at).toEqual([100, 40]);
    expect(transformGrid).toHaveBeenCalledTimes(1);
  });
});

describe("toSourceBatch: transformed children round trip", () => {
  for (const d of ELEMENTS) {
    for (const node of [undefined, NODE]) {
      const name = `${label(d)}${node ? " under a turned node" : ""}`;

      it(`a world move under ${name}`, () => {
        const def = kiteScene(d, node);
        const by: Pt = [5, -2];
        for (const id of ["k-1/wing", "k-1/lift", "k-1/~solid:0", "free"]) {
          const before = resolvedOf(def, id);
          const { mapped, entity } = roundTrip(def, { ops: [{ op: "move", refs: [id], by }] }, id);
          expect(entity).toEqual(translateEntityDef(spin, before, by));
          expectIntegers(mapped);
        }
      });

      it(`world point, vector, angle, mirror and shape updates under ${name}`, () => {
        const def = kiteScene(d, node);
        const set = {
          at: [11, 13],
          launch: [3, 7],
          facing: 45,
          mirrored: true,
          shape: ["poly", 1, 1, 21, 1, 1, 9],
        };
        for (const id of ["k-1/wing", "free"]) {
          const { mapped, entity } = roundTrip(def, { ops: [{ op: "update", ref: id, set }] }, id);
          expect(entity).toMatchObject(set);
          expectIntegers(mapped);
        }
      });

      it(`a path point and a place under ${name}`, () => {
        const def = kiteScene(d, node);
        const lift = roundTrip(
          def,
          { ops: [{ op: "update", ref: "k-1/lift", set: { "path.pts.1": [300, 200] } }] },
          "k-1/lift",
        ).entity;
        expect((lift.path as { pts: Pt[] }).pts[1]).toEqual([300, 200]);
        for (const anchor of ["top", "left", "bottom", "right", undefined] as const) {
          const { entity } = roundTrip(
            def,
            {
              ops: [
                { op: "place", ref: "k-1/wing", at: [400, 400], ...(anchor ? { anchor } : {}) },
              ],
            },
            "k-1/wing",
          );
          const parsed = parseShape(entity.shape);
          if (!parsed.ok) throw new Error(parsed.issue.message);
          const b = aabb(parsed.shape);
          const cx = (b.minX + b.maxX) / 2;
          const cy = (b.minY + b.maxY) / 2;
          const spot: Record<string, Pt> = {
            top: [cx, b.minY],
            bottom: [cx, b.maxY],
            left: [b.minX, cy],
            right: [b.maxX, cy],
            center: [cx, cy],
          };
          const got = spot[anchor ?? "center"]!;
          expect(Math.abs(got[0] - 400)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(got[1] - 400)).toBeLessThanOrEqual(0.5);
        }
      });
    }
  }

  it("makes a world move of a flipped child a mirrored override, and moving back reverts it", () => {
    const def = kiteScene({ rot: 0, flip: true });
    const there = spinSource(def, { ops: [{ op: "move", refs: ["k-1/wing"], by: [5, -2] }] });
    expect(there.ops).toEqual([
      {
        op: "override",
        ref: "k-1",
        set: { "wing.at": [-2, 3], "wing.shape": ["poly", -5, -2, 5, -2, -5, 2] },
      },
    ]);
    const moved = spinApplied(def, there);
    const back = spinSource(moved, { ops: [{ op: "move", refs: ["k-1/wing"], by: [-5, 2] }] });
    expect(back.ops).toEqual([
      { op: "revertOverride", ref: "k-1", paths: ["wing.at", "wing.shape"] },
    ]);
  });

  it("maps a world move of a turned child to the override that resolves there", () => {
    const def = kiteScene({ rot: 1, flip: false });
    expect(spinSource(def, { ops: [{ op: "move", refs: ["k-1/wing"], by: [5, -2] }] }).ops).toEqual(
      [
        {
          op: "override",
          ref: "k-1",
          set: { "wing.at": [1, 0], "wing.shape": ["poly", -2, -5, 8, -5, -2, -1] },
        },
      ],
    );
  });

  it("moves what sits under a turned node by the vector in the node's frame", () => {
    const def = kiteScene({ rot: 0, flip: false }, NODE);
    const ops = spinSource(def, { ops: [{ op: "move", refs: ["free", "k-1"], by: [5, -2] }] }).ops;
    expect(ops).toEqual([{ op: "move", refs: ["free", "k-1"], by: [2, -5] }]);
  });

  it("maps an added entity and an instantiated instance under a turned node", () => {
    const def = kiteScene({ rot: 0, flip: false }, NODE);
    const world: EntityDef = { ...WING, id: "new", parent: "g", at: [50, 60], facing: 10 };
    const after = spinApplied(
      def,
      spinSource(def, {
        ops: [
          { op: "add", entity: world },
          {
            op: "instantiate",
            instance: { id: "k-2", prefab: "kite", at: [80, 90], rot: 90, parent: "g" },
          },
        ],
      }),
    );
    expect(resolvedOf(after, "new")).toEqual(world);
    const inst = after.instances!.find((i) => i.id === "k-2")!;
    const t = instanceTransform(after, inst);
    expect(dihedralOf(t)).toEqual({ rot: 1, flip: false });
    expect([t.tx, t.ty]).toEqual([80, 90]);
  });

  it("paints the cells of an entity under a turned node in its own frame", () => {
    const def = {
      ...kiteScene({ rot: 0, flip: false }, { at: [0, 0], rot: 90 }),
      settings: { grid: { kind: "square", cell: [16, 16] } },
    } as SceneDefinition;
    def.entities = [
      { id: "floor", type: "paint", at: [0, 0], cells: {}, parent: "g" },
      { id: "g", type: "node", at: [0, 0], rot: 90 },
    ];
    const ops = spinSource(def, {
      ops: [
        {
          op: "paintCells",
          ref: "floor",
          field: "cells",
          cells: [
            [0, 0, 1],
            [2, 0, 1],
          ],
          rects: [[0, 0, 1, 2, 3]],
        },
      ],
    }).ops;
    // A quarter turn clockwise takes cell (c, r) to (-r - 1, c), so the paint goes back by its inverse.
    expect(ops).toEqual([
      {
        op: "paintCells",
        ref: "floor",
        field: "cells",
        cells: [
          [0, -1, 1],
          [0, -3, 1],
        ],
        rects: [[0, -2, 2, -1, 3]],
      },
    ]);
  });

  it("refuses part of a turned point, and painting a child", () => {
    const def = kiteScene({ rot: 1, flip: false });
    for (const batch of [
      { ops: [{ op: "update" as const, ref: "k-1/wing", set: { "at.0": 4 } }] },
      { ops: [{ op: "update" as const, ref: "free", set: { "launch.1": 4 } }] },
      {
        ops: [
          {
            op: "paintCells" as const,
            ref: "k-1/wing",
            field: "cells",
            cells: [[0, 0, 1] as [number, number, number]],
          },
        ],
      },
    ]) {
      const r = toSourceBatch(
        batch.ops[0]!.ref === "free" ? kiteScene({ rot: 0, flip: false }, NODE) : def,
        batch,
        spin,
        kitePrefabs,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issue.code).toBe("op-invalid");
    }
  });

  it("leaves an untransformed scene's batches as written", () => {
    const def = kiteScene({ rot: 0, flip: false }, { at: [0, 0] });
    const batch: OpBatch = {
      ops: [
        { op: "move", refs: ["free"], by: [3, 4] },
        { op: "update", ref: "free", set: { "at.0": 4, facing: 400 } },
        { op: "place", ref: "free", at: [1, 2], anchor: "top" },
      ],
    };
    expect(spinSource(def, batch)).toEqual(batch);
  });
});

describe("instanceTransform", () => {
  it("is the parent chain's transform after the instance's own", () => {
    const def = kiteScene({ rot: 3, flip: true }, NODE);
    const inst: InstanceDef = def.instances![0]!;
    const t = instanceTransform(def, inst);
    expect(dihedralOf(t)).toEqual({ rot: 2, flip: false });
    expect([t.tx, t.ty]).toEqual([-33, -103]);
  });
});

describe("nested instances on the resolved view", () => {
  const nested: PrefabLibrary = prefabLibrary([
    {
      kind: "prefab",
      v: 4,
      id: "leaf",
      entities: [{ id: "pin", type: "marker", at: [4, 0] }],
    },
    {
      kind: "prefab",
      v: 4,
      id: "shell",
      entities: [],
      instances: [{ id: "l", prefab: "leaf", at: [20, 0], rot: 90 }],
    },
  ]);
  const shellScene = (inst: Partial<InstanceDef> = {}): SceneDefinition => ({
    v: 4,
    name: "nested",
    bounds: [0, 0, 1000, 1000],
    instances: [{ id: "s", prefab: "shell", at: [500, 500], ...inst }],
  });
  const pinAt = (def: SceneDefinition) =>
    resolveScene(def, engine, nested).entities!.find((e) => e.id === "s/l/pin")!.at;

  it("records the instance chain and the composed turn on a nested child", () => {
    const r = resolveSceneDetailed(shellScene({ flip: true }), engine, nested);
    expect(r.def.entities!.map((e) => e.id)).toEqual(["s/l/pin"]);
    expect(r.origins[0]).toEqual({
      kind: "child",
      instance: 0,
      child: "l/pin",
      path: ["s", "l"],
      transform: { rot: 270, flip: true },
    });
    expect(pinAt(shellScene({ flip: true }))).toEqual([480, 504]);
  });

  it("maps a world move of a nested child under turned instances to an override in its own prefab's frame", () => {
    const def = shellScene({ rot: 180 });
    const before = pinAt(def) as Pt;
    const r = toSourceBatch(
      def,
      { ops: [{ op: "move", refs: ["s/l/pin"], by: [10, 0] }] },
      engine,
      nested,
    );
    expect(r).toEqual({
      ok: true,
      batch: { ops: [{ op: "override", ref: "s", set: { "l/pin.at": [4, 10] } }] },
    });
    if (!r.ok) return;
    const after = applyOps(def, r.batch, engine, { prefabs: nested, validate: "none" });
    expect(after.ok ? null : after.issue).toBeNull();
    if (after.ok) expect(pinAt(after.def)).toEqual([before[0] + 10, before[1]]);
  });

  it("refuses to remove or rename a nested child", () => {
    for (const op of [
      { op: "remove" as const, refs: ["s/l/pin"] },
      { op: "rename" as const, from: "s/l/pin", to: "x" },
    ]) {
      const r = toSourceBatch(shellScene(), { ops: [op] }, engine, nested);
      expect(r.ok, op.op).toBe(false);
    }
  });
});

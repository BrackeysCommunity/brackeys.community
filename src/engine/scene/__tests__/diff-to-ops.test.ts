import { describe, expect, it } from "vite-plus/test";

import type { Registry } from "../../game/types";
import { diffToOps } from "../diff-to-ops";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import type { OpBatch, SceneDefinition, ShapeTuple } from "../types";
import {
  engine,
  engineYard,
  fake,
  fakeYard,
  randomOp,
  rng,
  yardPrefabs,
} from "./fixtures/random-ops";

const text = (def: SceneDefinition) => formatScene(def).text;

/** Ops that change the prefab library, which a scene diff leaves alone. */
const LIBRARY_OPS = new Set(["definePrefab", "createPrefab", "applyToPrefab"]);

/** `def` after up to `steps` random batches, the prefabs left as they are; failed batches are skipped. */
function walk(reg: Registry, def: SceneDefinition, steps: number, rand: () => number) {
  const prefabs = yardPrefabs(def.game);
  let cur = def;
  for (let i = 0; i < steps; i++) {
    const ops = Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
      randomOp(reg, cur, rand, prefabs),
    ).filter((op) => !LIBRARY_OPS.has(op.op));
    const r = applyOps(cur, { ops, base: sceneHash(cur) }, reg, { validate: "none", prefabs });
    if (r.ok) cur = r.def;
  }
  return cur;
}

function roundTrip(reg: Registry, a: SceneDefinition, b: SceneDefinition): OpBatch {
  const batch = diffToOps(a, b, reg);
  const r = applyOps(a, batch, reg, { validate: "none", prefabs: yardPrefabs(a.game) });
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}\n${JSON.stringify(batch)}`);
  expect(text(r.def)).toBe(text(b));
  return batch;
}

const removedIds = (batch: OpBatch) =>
  new Set(batch.ops.flatMap((op) => (op.op === "remove" ? op.refs : [])));

describe("diffToOps", () => {
  for (const [label, reg, yard] of [
    ["engine-yard", engine, engineYard],
    ["the fake game's yard", fake, fakeYard],
  ] as const) {
    it(`turns one scene into the other for random pairs: ${label}`, () => {
      const rand = rng(0xd1ff);
      for (let i = 0; i < 150; i++) {
        const a = walk(reg, yard(), Math.floor(rand() * 6), rand);
        const derived = rand() < 0.7;
        const b = derived
          ? walk(reg, a, 1 + Math.floor(rand() * 5), rand)
          : walk(reg, yard(), 6, rand);
        const forward = roundTrip(reg, a, b);
        roundTrip(reg, b, a);
        if (!derived) continue;

        // Survivors are updated or reordered in place, so every entity on both sides keeps its identity.
        const typeOf = new Map((a.entities ?? []).map((e) => [e.id, e.type]));
        const removed = removedIds(forward);
        for (const e of b.entities ?? [])
          if (typeOf.get(e.id) === e.type) expect(removed.has(e.id), e.id).toBe(false);
      }
    }, 60_000);
  }

  it("is empty for equal scenes", () => {
    expect(diffToOps(fakeYard(), fakeYard(), fake)).toEqual({ ops: [] });
  });

  it("updates changed fields and unsets dropped ones", () => {
    const a = engineYard();
    const b = engineYard();
    const lift = b.entities!.find((e) => e.id === "lift")!;
    lift.path = { ...(lift.path as object), speed: 40 } as never;
    const zone = b.entities!.find((e) => e.id === "zone")!;
    delete zone.tags;
    const batch = roundTrip(engine, a, b);
    expect(batch.ops).toEqual([
      { op: "update", ref: "lift", set: { path: lift.path } },
      { op: "update", ref: "zone", unset: ["tags"] },
    ]);
    expect(batch.base).toBeUndefined();
  });

  it("removes and adds an entity whose type changed", () => {
    const a = engineYard();
    const b = engineYard();
    b.entities = b.entities!.map((e) =>
      e.id === "ledge" ? { id: "ledge", type: "sensor", shape: ["box", 1400, 800, 120, 10] } : e,
    );
    const batch = roundTrip(engine, a, b);
    expect(removedIds(batch).has("ledge")).toBe(true);
    expect(batch.ops.some((op) => op.op === "add" && op.entity.id === "ledge")).toBe(true);
  });

  it("reorders only the survivors outside the longest run in place, removing nothing", () => {
    const a = engineYard();
    const b = engineYard();
    const [first, ...rest] = b.entities!;
    b.entities = [...rest, first!];
    const batch = roundTrip(engine, a, b);
    expect([...removedIds(batch)]).toEqual([]);
    expect(batch.ops).toEqual([{ op: "reorder", refs: [first!.id], index: rest.length }]);
  });

  it("edits a bulk array in place between its common head and tail", () => {
    const a = fakeYard();
    const b = fakeYard();
    b.solid = [
      ["box", 1000, 980, 1000, 20],
      ["box", 25, 500, 20, 500],
      ["box", 300, 300, 10, 10],
      ["box", 1980, 500, 20, 500],
    ];
    b.peg = [];
    delete b.peg;
    const batch = roundTrip(fake, a, b);
    expect(batch.base).toBe(sceneHash(a));
    expect(batch.ops).toEqual([
      { op: "remove", refs: ["~peg:0"] },
      { op: "move", refs: ["~solid:1"], by: [5, 0] },
      { op: "addBulk", key: "solid", shapes: [["box", 300, 300, 10, 10]], index: 2 },
    ]);
  });

  describe("in a 200-entry bucket", () => {
    const big = (): SceneDefinition => ({
      ...fakeYard(),
      solid: Array.from({ length: 200 }, (_, i) => ["box", 20 + i * 9, 500, 4, 4]),
    });
    const edit = (i: number, entry: ShapeTuple) => {
      const b = big();
      (b.solid as ShapeTuple[])[i] = entry;
      return b;
    };

    it("moves one moved box with a single move", () => {
      const batch = roundTrip(fake, big(), edit(117, ["box", 20 + 117 * 9 + 3, 520, 4, 4]));
      expect(batch.ops).toEqual([{ op: "move", refs: ["~solid:117"], by: [3, 20] }]);
    });

    it("updates the shape of one resized box", () => {
      const batch = roundTrip(fake, big(), edit(42, ["box", 20 + 42 * 9, 500, 4, 12]));
      expect(batch.ops).toEqual([
        { op: "update", ref: "~solid:42", set: { shape: ["box", 20 + 42 * 9, 500, 4, 12] } },
      ]);
    });

    it("groups entries moved by the same offset into one move", () => {
      const b = big();
      const solid = b.solid as ShapeTuple[];
      for (const i of [10, 90, 150]) solid[i] = ["box", 20 + i * 9 + 1, 499, 4, 4];
      const batch = roundTrip(fake, big(), b);
      expect(batch.ops).toEqual([
        { op: "move", refs: ["~solid:10", "~solid:90", "~solid:150"], by: [1, -1] },
      ]);
    });

    it("keeps the rest in place around a removal and an insertion", () => {
      const b = big();
      const solid = b.solid as ShapeTuple[];
      solid.splice(30, 1);
      solid.splice(160, 0, ["circle", 5, 5, 5]);
      const batch = roundTrip(fake, big(), b);
      expect(batch.ops).toEqual([
        { op: "remove", refs: ["~solid:30"] },
        { op: "addBulk", key: "solid", shapes: [["circle", 5, 5, 5]], index: 160 },
      ]);
    });
  });

  it("writes the header and settings through setScene and setSettings", () => {
    const a = fakeYard();
    const b = {
      ...fakeYard(),
      name: "yard-2",
      bounds: [0, 0, 3000, 1000] as [number, number, number, number],
      settings: { wind: 3 },
    };
    const batch = roundTrip(fake, a, b as SceneDefinition);
    expect(batch.ops.slice(0, 2)).toEqual([
      { op: "setScene", set: { name: "yard-2", bounds: [0, 0, 3000, 1000] } },
      { op: "setSettings", set: { wind: 3 }, unset: ["gravity"] },
    ]);
  });

  it("refuses scenes that differ in what no op can change", () => {
    expect(() => diffToOps(engineYard(), fakeYard())).toThrow(/"game"/);
  });
});

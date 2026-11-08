import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { Registry } from "../../game/types";
import { diffPrefabToOps, diffToOps } from "../diff-to-ops";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import { prefabLibrary } from "../prefab";
import type { OpBatch, Prefab, SceneDefinition, ShapeTuple } from "../types";
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

  it("writes the assets header through useAssets", () => {
    const a = { ...engineYard(), assets: ["boom", "old"] };
    const b = { ...engineYard(), assets: ["zap", "boom", "aura"] };
    const batch = roundTrip(engine, a, b);
    expect(batch.ops).toEqual([{ op: "useAssets", add: ["aura", "zap"], remove: ["old"] }]);
    expect(roundTrip(engine, a, engineYard()).ops).toEqual([
      { op: "useAssets", remove: ["boom", "old"] },
    ]);
    expect(diffToOps(a, { ...a, assets: ["old", "boom", "boom"] }).ops).toEqual([]);
  });

  it("writes a change of only z as setZ, and z beside other fields as an update", () => {
    const a = engineYard();
    const b = engineYard();
    b.entities![2] = { ...b.entities![2]!, z: 3 };
    b.entities![0] = { ...b.entities![0]!, z: 3, oneWay: false };
    b.instances![0] = { ...b.instances![0]!, z: -1 };
    const batch = roundTrip(engine, a, b);
    expect(batch.ops).toEqual([
      { op: "update", ref: "ledge", set: { oneWay: false, z: 3 } },
      { op: "setZ", refs: ["crate"], z: 3 },
      { op: "setZ", refs: ["gate-1"], z: -1 },
    ]);
    expect(roundTrip(engine, b, a).ops).toContainEqual({ op: "setZ", refs: ["crate"], z: 0 });
  });

  it("writes an instance's turn and flip through update, its params through setParam, and a new one's through instantiate", () => {
    const a = engineYard();
    const b = engineYard();
    b.instances![0] = { ...b.instances![0]!, rot: 1, flip: true, params: { speed: 3 } };
    b.instances!.push({ id: "gate-2", prefab: "gate", at: [0, 0], rot: 3, z: 2, params: { a: 1 } });
    const batch = roundTrip(engine, a, b);
    expect(batch.ops).toEqual([
      { op: "update", ref: "gate-1", set: { rot: 1, flip: true } },
      { op: "setParam", ref: "gate-1", name: "speed", value: 3 },
      { op: "instantiate", instance: b.instances![2] },
    ]);
    expect(roundTrip(engine, b, a).ops.slice(1)).toEqual([
      { op: "update", ref: "gate-1", unset: ["rot", "flip"] },
      { op: "setParam", ref: "gate-1", name: "speed", value: null },
    ]);
  });

  it("writes each changed param of an instance as its own setParam", () => {
    const a = engineYard();
    a.instances![0] = { ...a.instances![0]!, params: { speed: 3, open: true, tint: "red" } };
    const b = engineYard();
    b.instances![0] = { ...b.instances![0]!, params: { speed: 5, open: true, label: "west" } };
    expect(roundTrip(engine, a, b).ops).toEqual([
      { op: "setParam", ref: "gate-1", name: "label", value: "west" },
      { op: "setParam", ref: "gate-1", name: "speed", value: 5 },
      { op: "setParam", ref: "gate-1", name: "tint", value: null },
    ]);
    const z = engineYard();
    z.instances![0] = { ...b.instances![0]!, z: 4 };
    expect(roundTrip(engine, b, z).ops).toEqual([{ op: "setZ", refs: ["gate-1"], z: 4 }]);
  });

  it("writes a group's turn and flip through setGroup, back to 0 and false", () => {
    const a = engineYard();
    const b = engineYard();
    b.groups!.raised = { at: [40, -20], rot: 2, flip: true, name: "Raised" };
    expect(roundTrip(engine, a, b).ops).toEqual([
      { op: "setGroup", id: "raised", at: [40, -20], rot: 2, flip: true, name: "Raised" },
    ]);
    expect(roundTrip(engine, b, a).ops).toEqual([
      { op: "setGroup", id: "raised", at: [40, -20], rot: 0, flip: false, name: "Raised" },
    ]);
  });

  it("writes a grid field's change as one update of the field", () => {
    const game = createRegistry(testGame);
    const scene = (cells: Record<string, string[]>): SceneDefinition => ({
      v: 2,
      game: "test-game",
      name: "grid",
      bounds: [0, 0, 100, 100],
      settings: { grid: { kind: "square", cell: [32, 32] } },
      entities: [{ id: "floor", type: "paint", at: [0, 0], cells }],
    });
    const a = scene({ "0,0": ["1*4", "", "2"] });
    const b = scene({ "0,0": ["1*4", "3"], "-1,0": ["0*31,1"] });
    expect(roundTrip(game, a, b).ops).toEqual([
      { op: "update", ref: "floor", set: { cells: b.entities![0]!.cells } },
    ]);
  });

  it("removes and instantiates again an instance that places another prefab", () => {
    const a = engineYard();
    const b = engineYard();
    b.instances![0] = { ...b.instances![0]!, prefab: "post" };
    const batch = roundTrip(engine, a, b);
    expect(batch.ops).toEqual([
      { op: "remove", refs: ["gate-1"] },
      { op: "instantiate", instance: b.instances![0], index: 0 },
    ]);
  });

  describe("diffPrefabToOps", () => {
    const door: Prefab = {
      kind: "prefab",
      v: 3,
      id: "door",
      entities: [{ id: "knob", type: "marker", at: [8, 20] }],
      bulk: { solid: [["box", 0, 40, 10, 4]] },
    };
    const room = (instances: Prefab["instances"], extra: Partial<Prefab> = {}): Prefab => ({
      kind: "prefab",
      v: 3,
      id: "room",
      entities: [{ id: "floor", type: "solid", shape: ["box", 0, 60, 100, 10] }],
      ...(instances ? { instances } : {}),
      ...extra,
    });
    /** The room as its doc reads: a scene named after it, bounds synthesised. */
    const view = (p: Prefab): SceneDefinition => ({
      v: 3,
      name: p.id,
      bounds: [-500, -500, 1000, 1000],
      entities: structuredClone(p.entities),
      ...(p.bulk ? structuredClone(p.bulk) : {}),
      ...(p.instances ? { instances: structuredClone(p.instances) } : {}),
      ...(p.assets ? { assets: [...p.assets] } : {}),
    });
    const content = (def: SceneDefinition) => ({
      entities: def.entities ?? [],
      solid: def.solid ?? [],
      instances: def.instances ?? [],
      assets: def.assets ?? [],
    });

    it("writes a disk edit of a prefab's nested instances as ops on its view", () => {
      const before = room([
        { id: "door-1", prefab: "door", at: [10, 0], rot: 1 },
        { id: "door-2", prefab: "door", at: [60, 0], overrides: { "knob.at": [2, 2] } },
        { id: "door-3", prefab: "door", at: [90, 0] },
      ]);
      const after = room(
        [
          { id: "door-2", prefab: "door", at: [60, 0], overrides: { "knob.at": [4, 4] }, z: 1 },
          { id: "door-1", prefab: "door", at: [20, 0], flip: true },
          { id: "door-4", prefab: "door", at: [0, 0], params: { speed: 2 } },
        ],
        { assets: ["tiles"] },
      );
      const prefabs = prefabLibrary([door, before]);
      const v = view(before);
      const batch = diffPrefabToOps(v, after, engine);
      expect(batch.ops.some((op) => op.op === "setScene")).toBe(false);
      expect(batch.ops).toContainEqual({ op: "remove", refs: ["door-3"] });
      expect(batch.ops).toContainEqual({
        op: "instantiate",
        instance: { id: "door-4", prefab: "door", at: [0, 0], params: { speed: 2 } },
      });
      const r = applyOps(v, batch, engine, { validate: "none", prefabs, prefab: "room" });
      if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
      expect(r.def.name).toBe("room");
      expect(r.def.bounds).toEqual(v.bounds);
      expect(content(r.def)).toEqual(content(view(after)));
    });

    it("writes a changed base and changed params as header ops, given the header", () => {
      const speed = { description: "How fast the door opens.", targets: ["knob.at"] };
      const before = room([{ id: "door-1", prefab: "door", at: [10, 0] }], {
        params: { speed, tint: { description: "Its colour.", targets: ["floor.material"] } },
      });
      const after = room(before.instances, {
        base: "door",
        params: {
          speed: { ...speed, default: [1, 1] },
          wide: { description: "Whether it is wide.", targets: ["floor.oneWay"] },
        },
      });
      const batch = diffPrefabToOps(view(before), after, engine, before);
      expect(batch.ops).toEqual([
        { op: "setPrefabBase", base: "door" },
        { op: "exposeParam", name: "speed", param: after.params!.speed },
        { op: "exposeParam", name: "tint", param: null },
        { op: "exposeParam", name: "wide", param: after.params!.wide },
      ]);
      const r = applyOps(view(before), batch, engine, {
        validate: "none",
        prefabs: prefabLibrary([door, before]),
        prefab: "room",
      });
      if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
      expect(r.prefabs!.get("room")!.base).toBe("door");
      expect(r.prefabs!.get("room")!.params).toEqual(after.params);
      expect(diffPrefabToOps(view(after), before, engine, after).ops).toEqual([
        { op: "setPrefabBase", base: null },
        { op: "exposeParam", name: "speed", param: speed },
        { op: "exposeParam", name: "tint", param: before.params!.tint },
        { op: "exposeParam", name: "wide", param: null },
      ]);
      expect(diffPrefabToOps(view(before), after, engine).ops).toEqual([]);
    });

    it("leaves an edit that only touches what the view doesn't hold empty", () => {
      const before = room([{ id: "door-1", prefab: "door", at: [10, 0] }]);
      const after = room(before.instances, { contract: { opens: true } });
      expect(diffPrefabToOps(view(before), after, engine).ops).toEqual([]);
    });
  });

  it("refuses scenes that differ in what no op can change", () => {
    expect(() => diffToOps(engineYard(), fakeYard())).toThrow(/"game"/);
  });
});

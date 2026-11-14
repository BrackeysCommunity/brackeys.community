import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { Registry } from "../../game/types";
import { diffPrefabToOps, diffToOps } from "../diff-to-ops";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import { prefabLibrary } from "../prefab";
import type {
  EntityDef,
  InstanceDef,
  OpBatch,
  Prefab,
  SceneDefinition,
  SceneOp,
  ShapeTuple,
} from "../types";
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
    b.entities![0] = { ...b.entities![0]!, z: 3, oneWay: "down" };
    b.instances![0] = { ...b.instances![0]!, z: -1 };
    const batch = roundTrip(engine, a, b);
    expect(batch.ops).toEqual([
      { op: "update", ref: "ledge", set: { oneWay: "down", z: 3 } },
      { op: "setZ", refs: ["crate"], z: 3 },
      { op: "setZ", refs: ["gate-1"], z: -1 },
    ]);
    expect(roundTrip(engine, b, a).ops).toContainEqual({ op: "setZ", refs: ["crate"], z: 0 });
  });

  it("writes an instance's turn and flip through update, its params through setParam, and a new one's through instantiate", () => {
    const a = engineYard();
    const b = engineYard();
    b.instances![0] = { ...b.instances![0]!, rot: 1, flip: true, params: { speed: 3 } };
    b.instances!.push({
      id: "gate-2",
      prefab: "gate",
      at: [0, 0],
      rot: 270,
      z: 2,
      params: { a: 1 },
    });
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

  it("writes a node's turn and flip through update, and back", () => {
    const a = engineYard();
    const b = engineYard();
    const raised = b.entities!.findIndex((e) => e.id === "raised");
    b.entities![raised] = { ...b.entities![raised]!, rot: 180, flip: true };
    expect(roundTrip(engine, a, b).ops).toEqual([
      { op: "update", ref: "raised", set: { rot: 180, flip: true } },
    ]);
    expect(roundTrip(engine, b, a).ops).toEqual([
      { op: "update", ref: "raised", unset: ["rot", "flip"] },
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
      v: 4,
      id: "door",
      entities: [{ id: "knob", type: "marker", at: [8, 20] }],
      bulk: { solid: [["box", 0, 40, 10, 4]] },
    };
    const room = (instances: Prefab["instances"], extra: Partial<Prefab> = {}): Prefab => ({
      kind: "prefab",
      v: 4,
      id: "room",
      entities: [{ id: "floor", type: "solid", shape: ["box", 0, 60, 100, 10] }],
      ...(instances ? { instances } : {}),
      ...extra,
    });
    /** The room as its doc reads: a scene named after it, bounds synthesised. */
    const view = (p: Prefab): SceneDefinition => ({
      v: 4,
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
        { id: "door-1", prefab: "door", at: [10, 0], rot: 90 },
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

/**
 * A scene of nodes, markers, sensors and posts, each under an earlier one or
 * at the root. With `anyAngle`, nodes turn by any multiple of 15° and there
 * are no posts, since an instance turns only by quarter turns.
 */
function randomTree(rand: () => number, anyAngle = false): SceneDefinition {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const entities: EntityDef[] = [];
  const instances: InstanceDef[] = [];
  const parents: string[] = [];
  const under = () =>
    parents.length > 0 && rand() < 0.7 ? { parent: parents[int(0, parents.length - 1)]! } : {};
  for (let k = 0; k < int(4, 12); k++) {
    const roll = rand();
    const id = `e${k}`;
    if (roll < 0.35) {
      entities.push({
        id,
        type: "node",
        at: [int(-200, 200), int(-200, 200)],
        ...(rand() < 0.6 ? { rot: anyAngle ? 15 * int(1, 23) : 90 * int(1, 3) } : {}),
        ...(rand() < 0.3 ? { flip: true } : {}),
        ...under(),
      });
      parents.push(id);
    } else if (roll < 0.6) {
      entities.push({ id, type: "marker", at: [int(-200, 200), int(-200, 200)], ...under() });
      parents.push(id);
    } else if (roll < 0.8 || anyAngle) {
      entities.push({
        id,
        type: "sensor",
        shape: ["circle", int(0, 90), int(0, 90), 8],
        ...under(),
      });
    } else {
      instances.push({
        id: `post-${k}`,
        prefab: "post",
        at: [int(0, 400), int(0, 400)],
        ...(rand() < 0.5 ? { rot: int(1, 3) as 1 | 2 | 3 } : {}),
        ...under(),
      });
      parents.push(`post-${k}`, `post-${k}/top`);
    }
  }
  return {
    v: 4,
    name: "tree",
    bounds: [0, 0, 1000, 1000],
    entities,
    ...(instances.length > 0 ? { instances } : {}),
  };
}

const ownerOf = (ref: string) => ref.split("/")[0]!;

/** `def` with parents moved, items removed, added, retyped, moved and shuffled, its parents still a tree. */
function mutateTree(def: SceneDefinition, rand: () => number): SceneDefinition {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const out = structuredClone(def);
  let entities = out.entities ?? [];
  let instances = out.instances ?? [];
  const all = () => [...entities, ...instances];
  const parentOf = () => new Map(all().map((x) => [x.id, x.parent]));
  const below = (id: string, ref: string) => {
    const map = parentOf();
    for (let o: string | undefined = ownerOf(ref), n = 0; o !== undefined && n < 64; n++) {
      if (o === id) return true;
      const p = map.get(o);
      o = p === undefined ? undefined : ownerOf(p);
    }
    return false;
  };
  const targets = () => [
    ...entities.filter((e) => e.type !== "sensor").map((e) => e.id),
    ...instances.flatMap((i) => [i.id, `${i.id}/top`]),
  ];
  for (const x of all()) {
    if (rand() < 0.35) {
      const pick = targets().filter((t) => !below(x.id, t));
      const to = rand() < 0.25 || pick.length === 0 ? undefined : pick[int(0, pick.length - 1)];
      if (to === undefined) delete x.parent;
      else x.parent = to;
    }
    if (rand() < 0.3 && "at" in x && Array.isArray(x.at)) x.at = [int(-200, 200), int(-200, 200)];
  }
  const gone = new Set(
    all()
      .filter(() => rand() < 0.15)
      .map((x) => x.id),
  );
  entities = entities.filter((e) => !gone.has(e.id));
  instances = instances.filter((i) => !gone.has(i.id));
  entities = entities.map((e) =>
    e.type === "node" && rand() < 0.15
      ? { id: e.id, type: "marker", at: e.at, ...(e.parent ? { parent: e.parent } : {}) }
      : e,
  );
  for (let k = 0; k < int(0, 3); k++) {
    const pick = targets();
    entities.splice(int(0, entities.length), 0, {
      id: `new-${k}`,
      type: rand() < 0.5 ? "node" : "marker",
      at: [int(-200, 200), int(-200, 200)],
      ...(pick.length > 0 && rand() < 0.7 ? { parent: pick[int(0, pick.length - 1)]! } : {}),
    });
  }
  if (rand() < 0.3) entities.reverse();
  const live = new Set(targets());
  for (const x of all()) if (x.parent !== undefined && !live.has(x.parent)) delete x.parent;
  // A removed parent's leftovers may now close a loop through a retargeted parent; break any.
  for (const x of all()) if (x.parent !== undefined && below(x.id, x.parent)) delete x.parent;
  out.entities = entities;
  if (instances.length > 0) out.instances = instances;
  else delete out.instances;
  return out;
}

const opsOf = (batch: OpBatch, name: SceneOp["op"]) => batch.ops.filter((op) => op.op === name);

describe("diffToOps: parents", () => {
  const prefabs = yardPrefabs();
  const base = (): SceneDefinition => ({
    v: 4,
    name: "tree",
    bounds: [0, 0, 1000, 1000],
    entities: [
      { id: "pen", type: "node", at: [100, 100], rot: 90 },
      { id: "rack", type: "node", at: [400, 100], flip: true },
      { id: "peg", type: "marker", at: [10, 0], parent: "pen" },
      { id: "pip", type: "marker", at: [0, 10], parent: "peg" },
    ],
    instances: [{ id: "post-1", prefab: "post", at: [20, 0], parent: "rack" }],
  });
  const roundTripTree = (a: SceneDefinition, b: SceneDefinition) => {
    const batch = diffToOps(a, b, engine);
    const r = applyOps(a, batch, engine, { validate: "none", prefabs });
    if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}\n${JSON.stringify(batch)}`);
    expect(text(r.def)).toBe(text(b));
    return batch;
  };
  const neverUpdatesParent = (batch: OpBatch) => {
    for (const op of batch.ops) {
      if (op.op !== "update") continue;
      expect(Object.keys(op.set ?? {}), JSON.stringify(op)).not.toContain("parent");
      expect(op.unset ?? [], JSON.stringify(op)).not.toContain("parent");
    }
  };

  it("emits a reparent for a parent change, never an update of it", () => {
    const b = base();
    b.entities![2] = { ...b.entities![2]!, parent: "rack", at: [5, 5] };
    const batch = diffToOps(base(), b, engine);
    neverUpdatesParent(batch);
    expect(batch.ops).toEqual([
      { op: "reparent", refs: ["peg"], parent: "rack" },
      { op: "update", ref: "peg", set: { at: [5, 5] } },
      // What sits under peg is put back too: the reparent may rewrite it to keep it in place.
      { op: "update", ref: "pip", set: { at: [0, 10] } },
    ]);
    roundTripTree(base(), b);
  });

  it("puts the stored geometry back after a reparent, even where a and b agree", () => {
    const b = base();
    b.instances = [{ id: "post-1", prefab: "post", at: [20, 0] }];
    const batch = roundTripTree(base(), b);
    expect(batch.ops).toEqual([
      { op: "reparent", refs: ["post-1"], parent: null },
      { op: "update", ref: "post-1", set: { at: [20, 0], rot: 0, flip: false } },
    ]);
    const c = base();
    c.entities![3] = { id: "pip", type: "marker", at: [0, 10] };
    roundTripTree(base(), c);
  });

  it("removes children before their parents", () => {
    const b = base();
    b.entities = b.entities!.filter((e) => e.id === "rack");
    const batch = roundTripTree(base(), b);
    expect(opsOf(batch, "remove")).toEqual([{ op: "remove", refs: ["pip", "peg", "pen"] }]);
  });

  it("adds a parent before what sits under it, at the index each has", () => {
    const b = base();
    b.entities = [
      { id: "kid", type: "marker", at: [1, 1], parent: "box" },
      ...b.entities!,
      { id: "box", type: "node", at: [7, 7], parent: "post-2/top" },
    ];
    b.instances!.push({ id: "post-2", prefab: "post", at: [50, 50] });
    const batch = roundTripTree(base(), b);
    expect(
      batch.ops.map((op) => [
        op.op,
        op.op === "add" ? op.entity.id : op.op === "instantiate" ? op.instance.id : "",
      ]),
    ).toEqual([
      ["instantiate", "post-2"],
      ["add", "box"],
      ["add", "kid"],
    ]);
  });

  it("takes what stays out from under a removed parent first, and back after", () => {
    const b = base();
    // pen becomes a marker: removed and added again, while peg stays under it.
    b.entities![0] = { id: "pen", type: "marker", at: [100, 100] };
    const batch = roundTripTree(base(), b);
    neverUpdatesParent(batch);
    expect(batch.ops.map((op) => op.op)).toEqual([
      "reparent",
      "remove",
      "add",
      "reparent",
      "update",
      "update",
    ]);
    expect(batch.ops[0]).toEqual({ op: "reparent", refs: ["peg"], parent: null });
    expect(batch.ops[1]).toEqual({ op: "remove", refs: ["pen"] });
    expect(batch.ops[3]).toEqual({ op: "reparent", refs: ["peg"], parent: "pen" });
    expect(batch.ops.slice(4).map((op) => op.op === "update" && op.ref)).toEqual(["peg", "pip"]);
  });

  it("swaps a parent and its child without making a cycle on the way", () => {
    const b = base();
    b.entities = [
      { id: "pen", type: "node", at: [100, 100], rot: 90, parent: "pip" },
      b.entities![1]!,
      { id: "peg", type: "marker", at: [10, 0] },
      { id: "pip", type: "marker", at: [0, 10], parent: "peg" },
    ];
    const batch = roundTripTree(base(), b);
    neverUpdatesParent(batch);
    expect(opsOf(batch, "reparent").length).toBeGreaterThan(0);
  });

  it("refuses a target whose parents form a cycle", () => {
    const b = base();
    b.entities![0] = { ...b.entities![0]!, parent: "pip" };
    expect(() => diffToOps(base(), b, engine)).toThrow(/cycle/);
  });

  it("turns one tree into another for random pairs", () => {
    const rand = rng(0x7ee5);
    for (let i = 0; i < 200; i++) {
      const a = randomTree(rand);
      const b = rand() < 0.8 ? mutateTree(a, rand) : randomTree(rand);
      neverUpdatesParent(roundTripTree(a, b));
      neverUpdatesParent(roundTripTree(b, a));
    }
  }, 60_000);

  it("turns one tree into another for random pairs at any angle", () => {
    const rand = rng(0xa49e);
    for (let i = 0; i < 200; i++) {
      const a = randomTree(rand, true);
      const b = rand() < 0.8 ? mutateTree(a, rand) : randomTree(rand, true);
      neverUpdatesParent(roundTripTree(a, b));
      neverUpdatesParent(roundTripTree(b, a));
    }
  }, 60_000);
});

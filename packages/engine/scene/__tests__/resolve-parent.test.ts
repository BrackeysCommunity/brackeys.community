// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { applyOps } from "../ops";
import { prefabLibrary } from "../prefab";
import {
  entityFrame,
  mapResolvedBatch,
  NO_CHILD_EDITS,
  resolveScene,
  resolveSceneDetailed,
  sceneFrames,
} from "../resolve";
import {
  applyPt,
  applyVec,
  asFrame,
  compose,
  composeFrames,
  frame,
  invert,
  type Frame,
  type Transform2D,
} from "../transform";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Prefab,
  type Pt,
  type SceneDefinition,
} from "../types";

const engine = createRegistry();
const micro = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const place = (t: Transform2D, p: Pt): Pt => applyPt(t, p).map(micro) as Pt;

const scene = (over: Partial<SceneDefinition>): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "tree",
  bounds: [-100, -100, 100, 100],
  ...over,
});

const byId = (def: SceneDefinition) => new Map((def.entities ?? []).map((e) => [e.id, e]));

const prefab = (id: string, body: Partial<Prefab>): Prefab => ({
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id,
  entities: [],
  ...body,
});

/** a: a node turned a quarter; b: a node at 30° under a; c: a marker under b. */
const chain = (): SceneDefinition =>
  scene({
    entities: [
      { id: "c", type: "marker", at: [1, 0], parent: "b" },
      { id: "b", type: "node", at: [2, 0], rot: 30, parent: "a" },
      { id: "a", type: "node", at: [10, 0], rot: 90 },
    ],
  });

describe("a three-level chain with a turned node", () => {
  it("maps each stored geometry to the world through every frame above it, innermost first", () => {
    const { def, origins } = resolveSceneDetailed(chain(), engine);
    const out = byId(def);
    const a: Frame = { at: [10, 0], rot: 90, flip: false };
    const b: Frame = { at: [2, 0], rot: 30, flip: false };
    expect(out.get("a")).toMatchObject({ at: [10, 0], rot: 90 });
    expect(out.get("b")).toMatchObject({ at: place(frame(a), [2, 0]), rot: 120 });
    expect(out.get("c")!.at).toEqual(place(frame(a), place(frame(b), [1, 0])));
    expect(out.get("c")!.at).toEqual([9.5, 2.866025]);
    expect(origins).toEqual([
      { kind: "entity", index: 0, transform: { rot: 120, flip: false } },
      { kind: "entity", index: 1, transform: { rot: 90, flip: false } },
      { kind: "entity", index: 2 },
    ]);
  });

  it("composes W(child) = W(parent) ∘ frame(entityFrame(parent))", () => {
    const def = chain();
    const frames = sceneFrames(def, engine);
    const own = byId(def);
    const w = (id: string) =>
      [...frames.stepsFor(own.get(id)!)].reduce((acc, t) => compose(t, acc));
    expect(frames.stepsFor(own.get("a")!)).toEqual([]);
    const wb = frames.stepsFor(own.get("b")!);
    expect(wb).toEqual([frame(entityFrame(engine, own.get("a")!))]);
    const wc = frames.stepsFor(own.get("c")!);
    expect(wc).toEqual([frame(entityFrame(engine, own.get("b")!)), ...wb]);
    const world = composeFrames(asFrame(wb[0]!), entityFrame(engine, own.get("b")!));
    expect(asFrame(w("c"))).toEqual(world);
    expect(frames.parentOf("c")).toBe("b");
    expect(frames.parentOf("a")).toBeUndefined();
  });

  it("maps a world edit back through the chain", () => {
    const def = chain();
    const batch = mapResolvedBatch(
      def,
      {
        ops: [
          { op: "move", refs: ["c"], by: [1, 0] },
          { op: "update", ref: "c", set: { at: [0, 0] } },
        ],
      },
      engine,
      undefined,
      NO_CHILD_EDITS,
    );
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    // c's frame is a's then b's: 120° in all, so a world step right is 120° back in c's frame
    const back = applyVec(invert(frame({ at: [0, 0], rot: 120, flip: false })), [1, 0]).map(micro);
    expect(batch.batch.ops[0]).toEqual({ op: "move", refs: ["c"], by: back });
    const toLocal = invert(
      compose(
        frame({ at: [10, 0], rot: 90, flip: false }),
        frame({ at: [2, 0], rot: 30, flip: false }),
      ),
    );
    expect(batch.batch.ops[1]).toEqual({
      op: "update",
      ref: "c",
      set: { at: place(toLocal, [0, 0]) },
    });
  });

  it("takes an added entity's geometry into its parent's frame", () => {
    const batch = mapResolvedBatch(
      chain(),
      { ops: [{ op: "add", entity: { type: "marker", at: [10, 2], parent: "a" } }] },
      engine,
      undefined,
      NO_CHILD_EDITS,
    );
    expect(batch.ok && batch.batch.ops[0]).toEqual({
      op: "add",
      entity: { type: "marker", at: [2, 0], parent: "a" },
    });
  });
});

describe("a child of an instance's child", () => {
  const lib = prefabLibrary([
    prefab("lift", { entities: [{ id: "deck", type: "solid", shape: ["box", 1, 0, 1, 0.1] }] }),
  ]);
  const def = scene({
    instances: [{ id: "g-1", prefab: "lift", at: [5, 5], rot: 90 }],
    entities: [{ id: "lamp", type: "marker", at: [0, -1], parent: "g-1/deck" }],
  });

  it("is placed in the child's world frame: its centre, at its turned rotDeg", () => {
    const out = byId(resolveScene(def, engine, lib));
    expect(out.get("g-1/deck")!.shape).toEqual(["box", 5, 6, 1, 0.1, 90]);
    expect(out.get("lamp")!.at).toEqual([6, 6]);
  });

  it("an instance under an entity is placed through that entity's frame", () => {
    const under = scene({
      entities: [{ id: "arm", type: "node", at: [3, 3], rot: 90 }],
      instances: [{ id: "g-2", prefab: "lift", at: [1, 0], parent: "arm" }],
    });
    const out = byId(resolveScene(under, engine, lib));
    // the instance's origin lands at arm + turn([1, 0]) = [3, 4]; the deck's centre one more turned step
    expect(out.get("g-2/deck")!.shape).toEqual(["box", 3, 5, 1, 0.1, 90]);
  });
});

describe("a prefab with an inner tree, placed twice", () => {
  const lib = prefabLibrary([
    prefab("arm", {
      entities: [
        { id: "barrel", type: "solid", shape: ["box", 1, 0, 0.5, 0.1], parent: "pivot" },
        { id: "pivot", type: "node", at: [0, 0], rot: 90 },
        { id: "sight", type: "marker", at: [2, 0], parent: "barrel" },
      ],
    }),
  ]);
  const def = scene({
    instances: [
      { id: "a", prefab: "arm", at: [10, 10] },
      { id: "b", prefab: "arm", at: [20, 10], flip: true, overrides: { "pivot.at": [1, 0] } },
    ],
  });

  it("places each copy's children through the chain, then the instance", () => {
    const out = byId(resolveScene(def, engine, lib));
    expect(out.get("a/barrel")!.shape).toEqual(["box", 10, 11, 0.5, 0.1, 90]);
    expect(out.get("a/sight")!.at).toEqual([10, 13]);
    expect(out.get("a/barrel")!.parent).toBe("a/pivot");
    expect(out.get("a/sight")!.parent).toBe("a/barrel");
    // b's override moves the pivot, and the barrel and sight move with it, mirrored by b's flip
    expect(out.get("b/barrel")!.shape).toEqual(["box", 19, 11, 0.5, 0.1, 270]);
    expect(out.get("b/sight")!.at).toEqual([19, 13]);
  });

  it("records each child's composed angle and flip", () => {
    const { def: out, origins } = resolveSceneDetailed(def, engine, lib);
    const origin = (id: string) => origins[out.entities!.findIndex((e) => e.id === id)];
    expect(origin("a/barrel")).toMatchObject({
      kind: "child",
      transform: { rot: 90, flip: false },
    });
    expect(origin("b/sight")).toMatchObject({ kind: "child", transform: { rot: 270, flip: true } });
    expect(origin("b/pivot")).toMatchObject({ kind: "child", transform: { rot: 0, flip: true } });
  });

  it("maps an edit of a parented child to an override in the frame it is written in", () => {
    const batch = mapResolvedBatch(
      def,
      { ops: [{ op: "move", refs: ["a/sight"], by: [0, 1] }] },
      engine,
      lib,
      (child, op) => {
        if (op.op !== "move" || child.kind !== "entity") throw new Error("unexpected");
        const [x, y] = child.def.at as Pt;
        return { ...child, def: { ...child.def, at: [x + op.by[0], y + op.by[1]] } };
      },
    );
    // the sight sits under the pivot's quarter turn: a world step down is a step right in its frame
    expect(batch.ok && batch.batch.ops).toEqual([
      { op: "override", ref: "a", set: { "sight.at": [3, 0] } },
    ]);
  });
});

describe("a cycle and a missing parent", () => {
  const def = scene({
    entities: [
      { id: "p", type: "node", at: [1, 0], parent: "q" },
      { id: "q", type: "node", at: [2, 0], parent: "p" },
      { id: "r", type: "marker", at: [5, 5], parent: "gone" },
      { id: "s", type: "marker", at: [0, 1], parent: "s" },
      { id: "t", type: "marker", at: [1, 1], parent: "nobody/child" },
    ],
  });

  it("treat the id that sorts last in a cycle, and a child of a missing parent, as roots", () => {
    const frames = sceneFrames(def, engine);
    expect(frames.parentOf("p")).toBe("q");
    expect(frames.parentOf("q")).toBeUndefined();
    expect(frames.parentOf("r")).toBeUndefined();
    expect(frames.parentOf("s")).toBeUndefined();
    expect(frames.parentOf("t")).toBeUndefined();
    const out = byId(resolveScene(def, engine));
    expect(out.get("q")!.at).toEqual([2, 0]);
    expect(out.get("p")!.at).toEqual([3, 0]);
    expect(out.get("r")!.at).toEqual([5, 5]);
    expect(out.get("s")!.at).toEqual([0, 1]);
    expect(out.get("t")!.at).toEqual([1, 1]);
  });

  it("read the same whatever order the document lists them in", () => {
    const reversed = { ...def, entities: [...def.entities!].reverse() };
    expect(byId(resolveScene(reversed, engine))).toEqual(byId(resolveScene(def, engine)));
  });

  it("read a cycle inside a prefab the same way", () => {
    const lib = prefabLibrary([
      prefab("loop", {
        entities: [
          { id: "p", type: "node", at: [1, 0], parent: "q" },
          { id: "q", type: "node", at: [2, 0], parent: "p" },
          { id: "r", type: "marker", at: [5, 5], parent: "gone" },
        ],
      }),
    ]);
    const out = byId(
      resolveScene(scene({ instances: [{ id: "i", prefab: "loop", at: [0, 10] }] }), engine, lib),
    );
    expect(out.get("i/q")).toMatchObject({ at: [2, 10] });
    expect(out.get("i/q")).not.toHaveProperty("parent");
    expect(out.get("i/p")).toMatchObject({ at: [3, 10], parent: "i/q" });
    expect(out.get("i/r")).toMatchObject({ at: [5, 15] });
    expect(out.get("i/r")).not.toHaveProperty("parent");
  });
});

describe("an off parent", () => {
  it("turns its subtree off in the resolved view", () => {
    const def = scene({
      entities: [
        { id: "n", type: "node", at: [0, 0], off: true },
        { id: "m", type: "marker", at: [1, 1], parent: "n" },
        { id: "k", type: "marker", at: [1, 1], parent: "m" },
      ],
    });
    const out = byId(resolveScene(def, engine));
    expect(out.get("m")!.off).toBe(true);
    expect(out.get("k")!.off).toBe(true);
    const own: EntityDef[] = def.entities!;
    expect(own.map((e) => e.off)).toEqual([true, undefined, undefined]);
  });
});

describe("ops on the tree", () => {
  it("applies reparent and transform's rotate on a node", () => {
    const def = chain();
    const reparent = applyOps(
      def,
      { ops: [{ op: "reparent", refs: ["c"], parent: null }] },
      engine,
    );
    expect(reparent.ok).toBe(true);
    const rotate = applyOps(def, { ops: [{ op: "transform", refs: ["a"], rotate: 30 }] }, engine);
    expect(rotate.ok).toBe(true);
  });
});

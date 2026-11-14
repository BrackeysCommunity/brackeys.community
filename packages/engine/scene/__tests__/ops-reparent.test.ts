// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import { prefabLibrary } from "../prefab";
import { resolveScene } from "../resolve";
import { aabb } from "../shape-geometry";
import { parseShape } from "../shapes";
import {
  PARENT_MAX_DEPTH,
  SCENE_FORMAT_VERSION,
  type ApplyResult,
  type EntityDef,
  type OpBatch,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneOp,
} from "../types";
import { randomTreeOp, rng, yardPrefabs } from "./fixtures/random-ops";

const engine = createRegistry();
const text = (def: SceneDefinition) => formatScene(def).text;

const scene = (over: Partial<SceneDefinition>): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "tree",
  bounds: [-2000, -2000, 4000, 4000],
  ...over,
});

function ok(result: ApplyResult): Extract<ApplyResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.issue.code}: ${result.issue.message}`);
  return result;
}

function refused(result: ApplyResult): Extract<ApplyResult, { ok: false }> {
  if (result.ok) throw new Error("expected the batch to be refused");
  return result;
}

const run = (def: SceneDefinition, ops: SceneOp[], prefabs?: PrefabLibrary) =>
  applyOps(def, { ops }, engine, { prefabs });

/** Applies `ops`, then the inverse, and checks the document comes back byte for byte. */
function roundTrip(def: SceneDefinition, ops: SceneOp[], prefabs?: PrefabLibrary) {
  const forward = ok(run(def, ops, prefabs));
  const back = ok(
    applyOps(forward.def, forward.inverse, engine, { prefabs: forward.prefabs ?? prefabs }),
  );
  expect(text(back.def)).toBe(text(def));
  return forward;
}

const deg = (n: number) => Math.round((((n % 360) + 360) % 360) * 1e3) / 1e3;

/** Each resolved entity's world geometry, rounded to `places` decimals: boxes, points, node frames. */
function world(def: SceneDefinition, prefabs?: PrefabLibrary, places = 4): Map<string, unknown> {
  const r = (n: number) => Math.round(n * 10 ** places) / 10 ** places + 0;
  const out = new Map<string, unknown>();
  for (const e of resolveScene(def, engine, prefabs).entities ?? []) {
    const g: Record<string, unknown> = {};
    if (Array.isArray(e.at)) g.at = (e.at as number[]).map(r);
    if (e.shape !== undefined) {
      const parsed = parseShape(e.shape);
      if (!parsed.ok) throw new Error(parsed.issue.message);
      const box = aabb(parsed.shape);
      g.box = [box.minX, box.minY, box.maxX, box.maxY].map(r);
    }
    if (e.type === "node") {
      g.rot = deg(typeof e.rot === "number" ? e.rot : 0);
      g.flip = e.flip === true;
    }
    out.set(e.id, g);
  }
  return out;
}

const byId = (def: SceneDefinition, id: string) =>
  def.entities?.find((e) => e.id === id) ?? def.instances?.find((i) => i.id === id);

/** A node at 30°, mirrored, with a node turned a quarter under it and a marker and a box below that. */
const tree = (): SceneDefinition =>
  scene({
    entities: [
      { id: "pivot", type: "node", at: [100, 100], rot: 30, flip: true },
      { id: "arm", type: "node", at: [20, 0], rot: 90, parent: "pivot" },
      { id: "eye", type: "marker", at: [5, 7], parent: "arm" },
      { id: "lid", type: "solid", shape: ["box", 3, 4, 6, 2, 15], parent: "arm" },
      { id: "crate", type: "solid", shape: ["box", 200, 200, 10, 10] },
      { id: "flag", type: "marker", at: [300, 50] },
      { id: "spot", type: "marker", at: [2, -3], parent: "crate" },
    ],
  });

describe("reparent", () => {
  const cases: [string, SceneOp][] = [
    ["into a turned, mirrored node", { op: "reparent", refs: ["flag"], parent: "arm" }],
    ["out to the root", { op: "reparent", refs: ["eye", "lid"], parent: null }],
    ["a subtree under a box", { op: "reparent", refs: ["arm"], parent: "crate" }],
    [
      "a box with a child under the mirrored node",
      { op: "reparent", refs: ["crate"], parent: "pivot" },
    ],
    ["out of the mirror and back in one batch", { op: "reparent", refs: ["lid"], parent: "flag" }],
  ];
  for (const [label, op] of cases)
    it(`leaves every world pose where it was, with an exact inverse: ${label}`, () => {
      const def = tree();
      const r = roundTrip(def, [op]);
      expect(world(r.def)).toEqual(world(def));
    });

  it("writes the new parent and touches only what it rewrote", () => {
    const def = scene({
      entities: [
        { id: "pens", type: "node", at: [10, 10], rot: 90 },
        { id: "hub", type: "node", at: [50, 0], rot: 45 },
        { id: "peg", type: "marker", at: [4, 0], parent: "pens" },
        { id: "far", type: "marker", at: [400, 0] },
      ],
    });
    const r = roundTrip(def, [{ op: "reparent", refs: ["peg"], parent: "hub" }]);
    const peg = byId(r.def, "peg") as EntityDef;
    expect(peg.parent).toBe("hub");
    expect(world(r.def)).toEqual(world(def));
    expect(r.touched).toEqual(["peg"]);
  });

  it("inverts as a reparent back followed by updates that put the stored geometry back", () => {
    const def = tree();
    const r = ok(run(def, [{ op: "reparent", refs: ["flag"], parent: "arm" }]));
    expect(r.inverse.ops.map((o) => o.op)).toEqual(["reparent", "update"]);
    expect(r.inverse.ops[0]).toEqual({ op: "reparent", refs: ["flag"], parent: null });
    expect(r.inverse.ops[1]).toMatchObject({ op: "update", ref: "flag", set: { at: [300, 50] } });
  });

  it("puts a child under an instance and under an instance's child", () => {
    const prefabs = yardPrefabs();
    const def = scene({
      instances: [{ id: "post-1", prefab: "post", at: [600, 900], rot: 90, flip: true }],
      entities: [
        { id: "flag", type: "marker", at: [300, 50] },
        { id: "sign", type: "node", at: [10, 20], rot: 12.5 },
      ],
    });
    for (const parent of ["post-1", "post-1/top"]) {
      const r = roundTrip(def, [{ op: "reparent", refs: ["flag", "sign"], parent }], prefabs);
      expect(world(r.def, prefabs)).toEqual(world(def, prefabs));
      expect((byId(r.def, "flag") as EntityDef).parent).toBe(parent);
    }
  });

  it("moves an instance under a node at any angle, keeping it in place", () => {
    const prefabs = yardPrefabs();
    const def = scene({
      instances: [{ id: "post-1", prefab: "post", at: [600, 900] }],
      entities: [
        { id: "square", type: "node", at: [100, 100], rot: 270, flip: true },
        { id: "slant", type: "node", at: [100, 100], rot: 30 },
      ],
    });
    const r = roundTrip(def, [{ op: "reparent", refs: ["post-1"], parent: "square" }], prefabs);
    expect(world(r.def, prefabs)).toEqual(world(def, prefabs));
    const slant = roundTrip(def, [{ op: "reparent", refs: ["post-1"], parent: "slant" }], prefabs);
    expect(byId(slant.def, "post-1")).toMatchObject({ parent: "slant", rot: 330 });
    for (const [id, pose] of world(def, prefabs))
      expect(world(slant.def, prefabs).get(id), id).toEqual(pose);
  });

  it("counts a missing current parent, or one in a cycle, as the identity", () => {
    const def = scene({
      entities: [
        { id: "lost", type: "marker", at: [5, 5], parent: "gone" },
        { id: "a", type: "node", at: [10, 0], rot: 90, parent: "b" },
        { id: "b", type: "node", at: [0, 10], parent: "a" },
        { id: "home", type: "node", at: [100, 0] },
      ],
    });
    const r = ok(run(def, [{ op: "reparent", refs: ["lost", "b"], parent: "home" }]));
    expect((byId(r.def, "lost") as EntityDef).at).toEqual([-95, 5]);
    // b sorts last in the loop, so the lenient read put it at the root.
    expect((byId(r.def, "b") as EntityDef).at).toEqual([-100, 10]);
  });

  it("keeps the children of a box in place when the box leaves a mirrored frame", () => {
    const def = scene({
      entities: [
        { id: "mirror", type: "node", at: [100, 0], flip: true },
        { id: "box", type: "solid", shape: ["circle", 10, 0, 4], parent: "mirror" },
        { id: "tip", type: "marker", at: [3, 1], parent: "box" },
        { id: "cap", type: "node", at: [0, 2], rot: 20, parent: "box" },
      ],
    });
    const r = roundTrip(def, [{ op: "reparent", refs: ["box"], parent: null }]);
    expect(world(r.def)).toEqual(world(def));
    expect((byId(r.def, "tip") as EntityDef).at).toEqual([-3, 1]);
    expect(r.touched.sort()).toEqual(["box", "cap", "tip"]);
  });

  it("keeps an instance in place under an entity that loses its angle", () => {
    const prefabs = yardPrefabs();
    const def = scene({
      entities: [
        { id: "spin", type: "node", at: [100, 0], rot: 30 },
        { id: "dot", type: "marker", at: [10, 0], parent: "spin" },
      ],
      instances: [{ id: "post-1", prefab: "post", at: [0, 0], parent: "dot" }],
    });
    const r = roundTrip(def, [{ op: "reparent", refs: ["dot"], parent: null }], prefabs);
    expect(byId(r.def, "post-1")).toMatchObject({ parent: "dot", rot: 30 });
    expect(world(r.def, prefabs)).toEqual(world(def, prefabs));
  });

  it("does nothing for an entry already under the parent", () => {
    const r = ok(run(tree(), [{ op: "reparent", refs: ["eye"], parent: "arm" }]));
    expect(r.touched).toEqual([]);
    expect(r.inverse.ops).toEqual([]);
  });

  describe("refuses", () => {
    const code = (ops: SceneOp[], def = tree(), prefabs?: PrefabLibrary) =>
      refused(applyOps(def, { base: sceneHash(def), ops }, engine, { prefabs })).issue;

    it("a bulk ref, as a child or a parent", () => {
      const def = scene({ solid: [["box", 0, 0, 5, 5]], entities: tree().entities });
      expect(code([{ op: "reparent", refs: ["~solid:0"], parent: "arm" }], def).code).toBe(
        "parent-type",
      );
      expect(code([{ op: "reparent", refs: ["eye"], parent: "~solid:0" }], def).code).toBe(
        "parent-type",
      );
    });

    it("an instance's child", () => {
      const prefabs = yardPrefabs();
      const def = scene({ instances: [{ id: "post-1", prefab: "post", at: [0, 0] }] });
      const issue = code([{ op: "reparent", refs: ["post-1/top"], parent: null }], def, prefabs);
      expect(issue.code).toBe("op-invalid");
      expect(issue.hint).toContain("unpack");
    });

    it("a cycle, itself included", () => {
      expect(code([{ op: "reparent", refs: ["pivot"], parent: "eye" }]).code).toBe("parent-cycle");
      expect(code([{ op: "reparent", refs: ["arm"], parent: "arm" }]).code).toBe("parent-cycle");
    });

    it("a cycle through an instance's child", () => {
      const prefabs = yardPrefabs();
      const def = scene({
        entities: [{ id: "hub", type: "node", at: [0, 0] }],
        instances: [{ id: "post-1", prefab: "post", at: [0, 0], parent: "hub" }],
      });
      expect(
        code([{ op: "reparent", refs: ["hub"], parent: "post-1/top" }], def, prefabs).code,
      ).toBe("parent-cycle");
    });

    it(`a depth past ${PARENT_MAX_DEPTH}`, () => {
      const entities: EntityDef[] = Array.from({ length: PARENT_MAX_DEPTH + 1 }, (_, k) => ({
        id: `n-${k}`,
        type: "node",
        at: [1, 0],
        ...(k > 0 ? { parent: `n-${k - 1}` } : {}),
      }));
      entities.push(
        { id: "top", type: "node", at: [0, 0] },
        { id: "kid", type: "marker", at: [0, 0], parent: "top" },
      );
      const def = scene({ entities });
      expect(
        code([{ op: "reparent", refs: ["top"], parent: `n-${PARENT_MAX_DEPTH}` }], def).code,
      ).toBe("parent-depth");
      ok(run(def, [{ op: "reparent", refs: ["kid"], parent: `n-${PARENT_MAX_DEPTH - 1}` }]));
    });

    it("a type outside the tree, as a child or a parent", () => {
      const def = scene({
        entities: [
          ...tree().entities!,
          { id: "area", type: "nav", shape: ["poly", 0, 0, 10, 0, 10, 10] },
          { id: "view", type: "camera-region", shape: ["box", 0, 0, 100, 100] },
          { id: "memo", type: "note", at: [0, 0], text: "hi" },
        ],
      });
      for (const ops of [
        [{ op: "reparent", refs: ["area"], parent: "arm" }],
        [{ op: "reparent", refs: ["memo"], parent: "arm" }],
        [{ op: "reparent", refs: ["eye"], parent: "view" }],
        [{ op: "reparent", refs: ["eye"], parent: "memo" }],
      ] as SceneOp[][])
        expect(code(ops, def).code, JSON.stringify(ops)).toBe("parent-type");
      ok(run(def, [{ op: "reparent", refs: ["memo"], parent: null }]));
    });

    it("a parent that doesn't exist", () => {
      expect(code([{ op: "reparent", refs: ["eye"], parent: "nobody" }]).code).toBe(
        "ref-not-found",
      );
    });

    it("a nested instance, whose frame no child is placed by", () => {
      const prefabs = prefabLibrary([
        {
          kind: "prefab",
          v: SCENE_FORMAT_VERSION,
          id: "door",
          entities: [{ id: "panel", type: "node", at: [1, 0] }],
        },
        {
          kind: "prefab",
          v: SCENE_FORMAT_VERSION,
          id: "hall",
          entities: [{ id: "post", type: "node", at: [0, 0] }],
          instances: [{ id: "door-1", prefab: "door", at: [4, 0] }],
        },
      ]);
      const def = scene({
        entities: [{ id: "lamp", type: "marker", at: [0, 0] }],
        instances: [{ id: "hall-1", prefab: "hall", at: [60, 0] }],
      });
      const issue = code(
        [{ op: "reparent", refs: ["lamp"], parent: "hall-1/door-1" }],
        def,
        prefabs,
      );
      expect(issue).toMatchObject({ code: "parent-type", got: "nested instance" });
      expect(issue.hint).toContain("hall-1");
      ok(run(def, [{ op: "reparent", refs: ["lamp"], parent: "hall-1/door-1/panel" }], prefabs));
    });
  });
});

describe("update of parent", () => {
  for (const ops of [
    [{ op: "update", ref: "eye", set: { parent: "crate" } }],
    [{ op: "update", ref: "eye", unset: ["parent"] }],
  ] as SceneOp[][])
    it(`is refused with a hint that names reparent: ${JSON.stringify(ops[0])}`, () => {
      const issue = refused(run(tree(), ops)).issue;
      expect(issue.code).toBe("op-invalid");
      expect(issue.hint).toContain('"reparent"');
    });
});

describe("add and instantiate under a parent", () => {
  it("take geometry in the parent's frame", () => {
    const prefabs = yardPrefabs();
    const def = scene({ entities: [{ id: "hub", type: "node", at: [100, 50], rot: 90 }] });
    const r = roundTrip(
      def,
      [
        { op: "add", entity: { id: "pin", type: "marker", at: [10, 0], parent: "hub" } },
        {
          op: "instantiate",
          instance: { id: "post-1", prefab: "post", at: [0, 0], parent: "hub" },
        },
      ],
      prefabs,
    );
    const w = world(r.def, prefabs);
    expect(w.get("pin")).toEqual({ at: [100, 60] });
    expect(w.get("post-1/top")).toEqual({ at: [140, 50] });
  });
});

describe("remove", () => {
  it("takes every entity and instance below each ref and reports them in touched", () => {
    const prefabs = yardPrefabs();
    const def = scene({
      entities: [
        ...tree().entities!,
        { id: "hat", type: "marker", at: [1, 1], parent: "post-1/top" },
      ],
      instances: [{ id: "post-1", prefab: "post", at: [3, 3], parent: "eye" }],
    });
    const r = roundTrip(def, [{ op: "remove", refs: ["arm"] }], prefabs);
    expect(r.def.entities!.map((e) => e.id)).toEqual(["pivot", "crate", "flag", "spot"]);
    expect(r.def.instances).toBeUndefined();
    expect(r.touched.sort()).toEqual(["arm", "eye", "hat", "lid", "post-1"]);
  });
});

describe("rename", () => {
  it("rewrites every parent that names the entity", () => {
    const r = roundTrip(tree(), [{ op: "rename", from: "arm", to: "limb" }]);
    expect((byId(r.def, "eye") as EntityDef).parent).toBe("limb");
    expect((byId(r.def, "lid") as EntityDef).parent).toBe("limb");
  });

  it("rewrites every parent that begins with an instance's id", () => {
    const prefabs = yardPrefabs();
    const def = scene({
      instances: [{ id: "post-1", prefab: "post", at: [0, 0] }],
      entities: [
        { id: "a", type: "marker", at: [0, 0], parent: "post-1" },
        { id: "b", type: "marker", at: [0, 0], parent: "post-1/top" },
        { id: "c", type: "marker", at: [0, 0], parent: "post-10" },
      ],
    });
    const r = roundTrip(def, [{ op: "rename", from: "post-1", to: "pole" }], prefabs);
    expect(r.def.entities!.map((e) => e.parent)).toEqual(["pole", "pole/top", "post-10"]);
  });
});

describe("transform", () => {
  it("rotates a node by any angle about a point, its children with it, with an exact inverse", () => {
    const def = tree();
    const r = roundTrip(def, [{ op: "transform", refs: ["arm"], rotate: 33.5, about: [0, 0] }]);
    const arm = byId(r.def, "arm") as EntityDef;
    // The mirror above arm turns a clockwise world turn anticlockwise in its frame.
    expect(arm.rot).toBe(56.5);
    expect(byId(r.def, "eye")).toEqual(byId(def, "eye"));
  });

  it("composes rotate and flip onto a node's own angle, about its origin by default", () => {
    const def = scene({ entities: [{ id: "n", type: "node", at: [10, 10], rot: 30 }] });
    const r = roundTrip(def, [{ op: "transform", refs: ["n"], rotate: 15, flip: "x" }]);
    expect(byId(r.def, "n")).toEqual({ id: "n", type: "node", at: [10, 10], rot: 315, flip: true });
  });

  it("turns an instance by any angle, in degrees", () => {
    const prefabs = yardPrefabs();
    const def = scene({ instances: [{ id: "post-1", prefab: "post", at: [0, 0] }] });
    const r = roundTrip(def, [{ op: "transform", refs: ["post-1"], rotate: 180 }], prefabs);
    expect(byId(r.def, "post-1")).toMatchObject({ rot: 180 });
    const slant = roundTrip(def, [{ op: "transform", refs: ["post-1"], rotate: 45 }], prefabs);
    expect(byId(slant.def, "post-1")).toMatchObject({ rot: 45 });
  });

  it("turns an instance under a parent in the parent's frame", () => {
    const prefabs = yardPrefabs();
    const def = scene({
      entities: [{ id: "hub", type: "node", at: [100, 0], rot: 90 }],
      instances: [{ id: "post-1", prefab: "post", at: [10, 0], parent: "hub" }],
    });
    const r = roundTrip(
      def,
      [{ op: "transform", refs: ["post-1"], turn: 1, about: [0, 0] }],
      prefabs,
    );
    expect(world(r.def, prefabs).get("post-1/top")).toEqual({ at: [-10, 140] });
  });

  for (const [label, op, code] of [
    ["a plain entity", { op: "transform", refs: ["eye"], rotate: 10 }, "op-invalid"],
    [
      "a node and something under it",
      { op: "transform", refs: ["pivot", "arm"], turn: 1 },
      "op-invalid",
    ],
    [
      "turn and rotate together",
      { op: "transform", refs: ["arm"], turn: 1, rotate: 10 },
      "op-invalid",
    ],
  ] as [string, SceneOp, string][])
    it(`refuses ${label}`, () => {
      expect(refused(run(tree(), [op])).issue.code).toBe(code);
    });
});

describe("unpack under a parent", () => {
  const prefabs = (): PrefabLibrary =>
    prefabLibrary([
      {
        kind: "prefab",
        v: SCENE_FORMAT_VERSION,
        id: "arm",
        entities: [
          { id: "hinge", type: "node", at: [10, 0], rot: 30 },
          { id: "tip", type: "marker", at: [5, 0], parent: "hinge" },
          { id: "base", type: "solid", shape: ["box", 0, 0, 4, 4] },
        ],
      },
    ]);
  const def = () =>
    scene({
      entities: [
        { id: "hub", type: "node", at: [100, 100], rot: 90, flip: true },
        { id: "hat", type: "marker", at: [1, 2], parent: "arm-1/tip" },
        { id: "badge", type: "marker", at: [3, 0], parent: "arm-1" },
      ],
      instances: [{ id: "arm-1", prefab: "arm", at: [20, 0], rot: 90, parent: "hub" }],
    });

  it("bakes one level into the instance's parent's frame, keeping the links inside it", () => {
    const lib = prefabs();
    const before = world(def(), lib);
    const r = roundTrip(def(), [{ op: "unpack", ref: "arm-1" }], lib);
    const ids = new Map((r.def.entities ?? []).map((e) => [e.id, e]));
    expect(ids.get("hinge")?.parent).toBe("hub");
    expect(ids.get("base")?.parent).toBe("hub");
    expect(ids.get("tip")?.parent).toBe("hinge");
    expect(ids.get("hat")?.parent).toBe("tip");
    expect(ids.get("badge")?.parent).toBe("hub");
    const after = world(r.def, lib);
    for (const [id, g] of before) expect(after.get(id.replace("arm-1/", "")), id).toEqual(g);
  });
});

describe("createPrefab", () => {
  it("gives the instance the members' common parent and keeps their frame", () => {
    const def = tree();
    const r = roundTrip(def, [
      { op: "createPrefab", refs: ["eye", "lid"], id: "face", instance: "face-1" },
    ]);
    expect(byId(r.def, "face-1")).toMatchObject({ parent: "arm" });
    const w = world(r.def, r.prefabs);
    const was = world(def);
    expect(w.get("face-1/eye")).toEqual(was.get("eye"));
    expect(w.get("face-1/lid")).toEqual(was.get("lid"));
  });

  it("takes members to the world through their parents, and brings their subtree", () => {
    const def = scene({
      entities: [
        { id: "pens", type: "node", at: [50, 0], rot: 90 },
        { id: "post", type: "solid", shape: ["box", 10, 0, 2, 8], parent: "pens" },
        { id: "hub", type: "node", at: [0, 40], rot: 90 },
        { id: "arm", type: "marker", at: [5, 0], parent: "hub" },
        { id: "tip", type: "marker", at: [1, 0], parent: "arm" },
      ],
    });
    const r = roundTrip(def, [
      { op: "createPrefab", refs: ["post", "arm"], id: "kit", instance: "kit-1" },
    ]);
    expect(r.def.entities!.map((e) => e.id)).toEqual(["pens", "hub"]);
    const inst = byId(r.def, "kit-1")!;
    expect(inst.parent).toBeUndefined();
    const prefab = r.prefabs!.get("kit")!;
    // arm, a point, takes no angle to the world, so tip is turned into arm's new frame.
    expect(prefab.entities.find((e) => e.id === "tip")).toMatchObject({
      parent: "arm",
      at: [0, 1],
    });
    const w = world(r.def, r.prefabs);
    const was = world(def);
    for (const id of ["post", "arm", "tip"]) expect(w.get(`kit-1/${id}`), id).toEqual(was.get(id));
  });
});

/** A random tree on the engine registry: nodes at any angle, some mirrored, boxes and markers under them, and prefab instances. */
function randomTree(rand: () => number, prefabs: PrefabLibrary): SceneDefinition {
  let def = scene({ name: "random-tree" });
  for (let k = 0; k < 14; k++) {
    const op = randomTreeOp(def, rand, prefabs);
    if (op.op === "reparent" || op.op === "transform") continue;
    const r = applyOps(def, { ops: [op] }, engine, { prefabs, validate: "none" });
    if (r.ok) def = r.def;
  }
  return def;
}

describe("reparent: property", () => {
  it("leaves every world pose to the file's precision and inverts byte for byte, on random trees", () => {
    const prefabs = yardPrefabs();
    const rand = rng(0x7ee);
    let moved = 0;
    const refusals = new Set<string>();
    for (let n = 0; n < 120; n++) {
      const def = randomTree(rand, prefabs);
      const ids = [...(def.entities ?? []), ...(def.instances ?? [])].map((e) => e.id);
      for (let k = 0; k < 6; k++) {
        const ref = ids[Math.floor(rand() * ids.length)];
        if (ref === undefined) break;
        const parent = rand() < 0.2 ? null : (ids[Math.floor(rand() * ids.length)] ?? null);
        const batch: OpBatch = { ops: [{ op: "reparent", refs: [ref], parent }] };
        const r = applyOps(def, batch, engine, { prefabs, validate: "none" });
        if (!r.ok) {
          refusals.add(r.issue.code);
          expect(["parent-cycle", "op-invalid", "parent-type"], r.issue.message).toContain(
            r.issue.code,
          );
          continue;
        }
        moved++;
        expect(world(r.def, prefabs, 3), `seed ${n} ${JSON.stringify(batch.ops)}`).toEqual(
          world(def, prefabs, 3),
        );
        const back = ok(applyOps(r.def, r.inverse, engine, { prefabs, validate: "none" }));
        expect(text(back.def), `seed ${n} ${JSON.stringify(batch.ops)}`).toBe(text(def));
        expect(back.hash).toBe(sceneHash(def));
      }
    }
    expect(moved).toBeGreaterThan(300);
    expect(refusals).toContain("parent-cycle");
  }, 60_000);

  it("restores random tree batches byte for byte, refusals and all", () => {
    const prefabs = yardPrefabs();
    const rand = rng(0xb00);
    let def = randomTree(rand, prefabs);
    let applied = 0;
    for (let n = 0; n < 400; n++) {
      const ops = Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
        randomTreeOp(def, rand, prefabs),
      );
      const r = applyOps(def, { ops }, engine, { prefabs, validate: "none" });
      if (!r.ok) continue;
      applied++;
      const back = ok(applyOps(r.def, r.inverse, engine, { prefabs, validate: "none" }));
      expect(text(back.def), JSON.stringify(ops)).toBe(text(def));
      const again = ok(applyOps(back.def, back.inverse, engine, { prefabs, validate: "none" }));
      expect(text(again.def), JSON.stringify(ops)).toBe(text(r.def));
      if (rand() < 0.7) def = r.def;
    }
    expect(applied).toBeGreaterThan(150);
  }, 60_000);
});

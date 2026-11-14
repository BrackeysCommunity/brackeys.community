import { describe, expect, it } from "vite-plus/test";

import { fake } from "../../scene/__tests__/fixtures/fake-game";
import {
  engine as yardEngine,
  fake as yardFake,
  yardPrefabs,
} from "../../scene/__tests__/fixtures/random-ops";
import { fragmentBounds, type SceneFragment } from "../../scene/fragment";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import { prefabLibrary } from "../../scene/prefab";
import { resolveScene } from "../../scene/resolve";
import { SCENE_FORMAT_VERSION, type OpBatch, type SceneDefinition } from "../../scene/types";
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  nextFreeId,
  pasteFragment,
} from "../clipboard";
import { DEFAULT_SNAP } from "../tools";

const scene = (over: Partial<SceneDefinition> = {}): SceneDefinition => ({
  v: 2,
  game: "fake",
  name: "c",
  bounds: [0, 0, 20, 20],
  ...over,
});

const def = scene({
  solid: [["box", 1, 1, 0.5, 0.1]],
  flag: [[0.1, 0.1]],
  entities: [
    { id: "door", type: "door", shape: ["box", 5, 5, 0.1, 0.4], opens: "btn", speed: 0.6 },
    { id: "btn", type: "button", shape: ["box", 4, 5.4, 0.1, 0.04] },
  ],
});

const apply = (to: SceneDefinition, batch: OpBatch) => {
  const r = applyOps(to, batch, fake);
  if (!r.ok) throw new Error(r.issue.message);
  return r;
};

describe("copySelection", () => {
  it("writes the fragment as pretty JSON text", () => {
    const text = copySelection(def, ["btn"], fake);
    expect(text).toContain('\n  "kind": "scene-fragment"');
    expect(JSON.parse(text)).toEqual({
      kind: "scene-fragment",
      v: SCENE_FORMAT_VERSION,
      game: "fake",
      entities: [def.entities![1]],
    });
  });
});

describe("pasteFragment", () => {
  it("round-trips a selection into another scene in one batch", () => {
    const text = copySelection(def, ["door", "btn", "~solid:0", "~flag:0"], fake);
    const target = scene({ solid: [["box", 0, 0, 0.05, 0.05]] });
    const r = pasteFragment(text, { def: target, registry: fake });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.issues).toEqual([]);
    expect(r.batch.ops.map((o) => o.op)).toEqual(["addBulk", "addBulk", "add", "add"]);
    expect(r.select).toEqual(["~flag:0", "~solid:1", "door", "btn"]);
    const after = apply(target, r.batch).def;
    expect(after.entities).toEqual(def.entities);
    expect(after.solid).toEqual([
      ["box", 0, 0, 0.05, 0.05],
      ["box", 1, 1, 0.5, 0.1],
    ]);
    expect(after.flag).toEqual([[0.1, 0.1]]);
  });

  it("centres the fragment under the cursor, moving by whole grid steps", () => {
    const text = copySelection(def, ["btn"], fake);
    const r = pasteFragment(text, {
      def: scene(),
      registry: fake,
      at: [10, 10],
      snap: { ...DEFAULT_SNAP, step: 0.64 },
    });
    if (!r.ok) throw new Error();
    // The button's box centre (4, 5.4) moves by (6, 4.6), rounded to 0.64s: (5.76, 4.48).
    expect(r.batch.ops).toEqual([
      { op: "add", entity: { id: "btn", type: "button", shape: ["box", 9.76, 9.88, 0.1, 0.04] } },
    ]);
    // Unsnapped, the move still lands on whole world px.
    const unsnapped = pasteFragment(text, { def: scene(), registry: fake, at: [10.004, 10] });
    expect(unsnapped.ok && unsnapped.batch.ops[0]).toMatchObject({
      entity: { shape: ["box", 10, 10, 0.1, 0.04] },
    });
  });

  it("renames clashing ids and remaps references inside the fragment", () => {
    const r = duplicateSelection(def, ["door", "btn"], fake, 0.64);
    if (!r.ok) throw new Error();
    expect(r.batch.label).toBe("Duplicate");
    expect(r.select).toEqual(["door-2", "btn-2"]);
    expect(r.batch.ops).toEqual([
      {
        op: "add",
        entity: {
          id: "door-2",
          type: "door",
          shape: ["box", 5.64, 5.64, 0.1, 0.4],
          opens: "btn-2",
          speed: 0.6,
        },
      },
      { op: "add", entity: { id: "btn-2", type: "button", shape: ["box", 4.64, 6.04, 0.1, 0.04] } },
    ]);
    expect(apply(def, r.batch).def.entities!.map((e) => e.id)).toEqual([
      "door",
      "btn",
      "door-2",
      "btn-2",
    ]);
  });

  it("keeps a reference out of the fragment when its target exists here", () => {
    const r = duplicateSelection(def, ["door"], fake, 0.16);
    expect(r.ok && r.issues).toEqual([]);
    expect(r.ok && r.batch.ops[0]).toMatchObject({ entity: { id: "door-2", opens: "btn" } });
  });

  it("clears a reference whose target isn't here, with a warning", () => {
    const text = copySelection(def, ["door"], fake);
    const r = pasteFragment(text, { def: scene(), registry: fake });
    if (!r.ok) throw new Error();
    expect(r.batch.ops[0]).toEqual({
      op: "add",
      entity: { id: "door", type: "door", shape: ["box", 5, 5, 0.1, 0.4], speed: 0.6 },
    });
    expect(r.issues).toMatchObject([
      { code: "dangling-ref", severity: "warn", path: "/ops/0/entity/opens", entityIds: ["door"] },
    ]);
  });

  it("refuses text that isn't a fragment, or an empty one", () => {
    expect(pasteFragment("hello", { def, registry: fake }).ok).toBe(false);
    const empty = JSON.stringify({ kind: "scene-fragment", v: 1, entities: [] });
    expect(pasteFragment(empty, { def, registry: fake }).ok).toBe(false);
  });
});

describe("cutSelection", () => {
  it("copies the selection and removes it in one batch", () => {
    const { text, batch } = cutSelection(def, ["btn", "~solid:0"], fake);
    expect(JSON.parse(text).entities).toEqual([def.entities![1]]);
    const after = apply(def, batch).def;
    expect(after.entities!.map((e) => e.id)).toEqual(["door"]);
    expect(after.solid ?? []).toEqual([]);
  });
});

describe("instances on the clipboard", () => {
  const prefabs = yardPrefabs("fake");
  const yard = scene({
    v: 3,
    instances: [
      {
        id: "gate-2",
        prefab: "gate",
        at: [300, 400],
        rot: 90,
        z: 3,
        params: { speed: 90 },
        overrides: { "door.path.speed": 120 },
      },
    ],
    entities: [{ id: "pull", type: "lever", at: [10, 20], target: "gate-2/door" }],
  });
  const applyYard = (to: SceneDefinition, batch: OpBatch) => {
    const r = applyOps(to, batch, yardFake, { prefabs });
    if (!r.ok) throw new Error(r.issue.message);
    return r.def;
  };
  /** A fragment with its ids replaced by their order of appearance, refs following. */
  const upToIds = (text: string) => {
    const f = JSON.parse(text) as { entities: { id: string }[]; instances?: { id: string }[] };
    const names = new Map<string, string>();
    [...(f.instances ?? []), ...f.entities].forEach((x, i) => names.set(x.id, `#${i}`));
    return JSON.parse(
      JSON.stringify(f, (_, v: unknown) => {
        if (typeof v !== "string") return v;
        const [head, ...rest] = v.split("/");
        const to = names.get(head!);
        return to === undefined ? v : [to, ...rest].join("/");
      }),
    ) as unknown;
  };

  it("pastes an instance with the same prefab, params, overrides and transform under a fresh id", () => {
    const text = copySelection(yard, ["gate-2"], yardFake, prefabs);
    const r = pasteFragment(text, { def: yard, registry: yardFake, prefabs });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.select).toEqual(["gate-3"]);
    expect(r.batch.label).toBe("Paste");
    const after = applyYard(yard, r.batch);
    expect(after.instances![1]).toEqual({ ...yard.instances![0], id: "gate-3" });
  });

  it("copy, paste, copy gives the same fragment up to ids", () => {
    const first = copySelection(yard, ["pull", "gate-2"], yardFake, prefabs);
    const r = pasteFragment(first, { def: yard, registry: yardFake, prefabs });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.issues).toEqual([]);
    expect(r.batch.ops.map((o) => o.op)).toEqual(["add", "instantiate"]);
    const after = applyYard(yard, r.batch);
    const second = copySelection(after, r.select, yardFake, prefabs);
    expect(JSON.parse(second)).not.toEqual(JSON.parse(first));
    expect(upToIds(second)).toEqual(upToIds(first));
  });

  it("points a child ref into a pasted instance at its new id", () => {
    const r = duplicateSelection(yard, ["pull", "gate-2"], yardFake, 64, { prefabs });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.select).toEqual(["pull-2", "gate-3"]);
    const after = applyYard(yard, r.batch);
    expect(after.entities![1]).toEqual({
      id: "pull-2",
      type: "lever",
      at: [74, 84],
      target: "gate-3/door",
    });
    expect(after.instances![1]).toMatchObject({ id: "gate-3", at: [364, 464] });
  });

  it("copies an instance's child as a plain entity", () => {
    const r = duplicateSelection(yard, ["gate-2/trigger"], yardFake, 0, { prefabs });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.batch.ops).toMatchObject([
      { op: "add", entity: { id: "trigger", type: "sensor", tags: ["gate"] } },
    ]);
  });

  it("centres on the instance's own box", () => {
    const text = copySelection(yard, ["gate-2"], yardFake, prefabs);
    const r = pasteFragment(text, { def: scene(), registry: yardFake, prefabs, at: [1000, 1000] });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const box = fragmentBounds(JSON.parse(text) as SceneFragment, yardFake, prefabs)!;
    const by = [
      Math.round(1000 - (box.minX + box.maxX) / 2),
      Math.round(1000 - (box.minY + box.maxY) / 2),
    ];
    expect(by).not.toEqual([700, 600]);
    expect(r.batch.ops).toMatchObject([
      { op: "instantiate", instance: { id: "gate-2", at: [300 + by[0]!, 400 + by[1]!] } },
    ]);
  });

  it("centres a variant or nested-prefab instance on its resolved children", () => {
    const lib = prefabLibrary([
      ...prefabs.values(),
      { kind: "prefab", v: 3, id: "tall-post", base: "post", entities: [] },
      {
        kind: "prefab",
        v: 3,
        id: "pair",
        entities: [],
        instances: [
          { id: "p1", prefab: "post", at: [-100, 0] },
          { id: "p2", prefab: "tall-post", at: [100, 0], rot: 90 },
        ],
      },
    ]);
    const from = scene({
      instances: [
        { id: "v-1", prefab: "tall-post", at: [300, 400] },
        { id: "pair-1", prefab: "pair", at: [600, 900] },
      ],
    });
    const pasteAt = (id: string) => {
      const text = copySelection(from, [id], yardFake, lib);
      const r = pasteFragment(text, {
        def: scene(),
        registry: yardFake,
        prefabs: lib,
        at: [1000, 1000],
      });
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      return r.batch.ops;
    };
    expect(pasteAt("v-1")).toMatchObject([
      { op: "instantiate", instance: { id: "v-1", at: [1000, 1000] } },
    ]);
    expect(pasteAt("pair-1")).toMatchObject([
      { op: "instantiate", instance: { id: "pair-1", at: [983, 1000] } },
    ]);
  });

  it("warns and places nothing for an instance whose prefab the project lacks", () => {
    const text = copySelection(yard, ["pull", "gate-2"], yardFake, prefabs);
    const r = pasteFragment(text, { def: scene(), registry: yardFake, prefabs: new Map() });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([
      ["prefab-unknown", "warn"],
      ["dangling-ref", "warn"],
    ]);
    expect(r.batch.ops).toEqual([
      { op: "add", entity: { id: "pull", type: "lever", at: [10, 20] } },
    ]);
    const only = copySelection(yard, ["gate-2"], yardFake, prefabs);
    const none = pasteFragment(only, { def: scene(), registry: yardFake });
    expect(!none.ok && none.issues.map((i) => i.code)).toEqual(["prefab-unknown"]);
  });

  it("cuts an instance", () => {
    const { text, batch } = cutSelection(yard, ["gate-2"], yardFake, prefabs);
    expect(JSON.parse(text).instances).toEqual(yard.instances);
    expect(applyYard(yard, batch).instances ?? []).toEqual([]);
  });

  it("cuts an instance's child by turning it off on that instance", () => {
    const { text, batch } = cutSelection(
      yard,
      ["gate-2/door", "gate-2/~solid:0"],
      yardFake,
      prefabs,
    );
    expect(JSON.parse(text).entities).toMatchObject([
      { id: "door", type: "follower" },
      { id: "solid", type: "solid" },
    ]);
    expect(batch).toEqual({
      label: "Cut",
      base: sceneHash(yard),
      ops: [{ op: "override", ref: "gate-2", set: { "door.off": true, "~solid:0.off": true } }],
    });
    const after = applyYard(yard, batch);
    expect(after.instances![0]!.overrides).toEqual({
      "door.path.speed": 120,
      "door.off": true,
      "~solid:0.off": true,
    });
    const resolved = resolveScene(after, yardFake, prefabs);
    expect(resolved.entities!.find((e) => e.id === "gate-2/door")?.off).toBe(true);
    expect(resolved.entities!.find((e) => e.id === "gate-2/trigger")?.off).toBeUndefined();
  });

  it("leaves a cut instance's children to the instance's removal", () => {
    const { batch } = cutSelection(yard, ["gate-2/door", "gate-2", "pull"], yardFake, prefabs);
    expect(batch.ops).toEqual([{ op: "remove", refs: ["gate-2", "pull"] }]);
    expect(batch.base).toBe(sceneHash(yard));
  });
});

describe("nextFreeId", () => {
  it("counts up from the id's own suffix", () => {
    expect(nextFreeId("lift", new Set())).toBe("lift");
    expect(nextFreeId("lift", new Set(["lift"]))).toBe("lift-2");
    expect(nextFreeId("lift", new Set(["lift", "lift-2"]))).toBe("lift-3");
    expect(nextFreeId("lift-2", new Set(["lift-2"]))).toBe("lift-3");
    const long = "a".repeat(48);
    expect(nextFreeId(long, new Set([long]))).toBe(`${"a".repeat(46)}-2`);
  });
});

describe("trees on the clipboard", () => {
  const prefabs = yardPrefabs();
  const tree: SceneDefinition = {
    v: 4,
    name: "t",
    bounds: [0, 0, 2000, 1000],
    entities: [
      { id: "pen", type: "node", at: [100, 100], rot: 90 },
      { id: "peg", type: "marker", at: [10, 0], parent: "pen" },
      { id: "pip", type: "marker", at: [0, 10], parent: "peg" },
      { id: "lamp", type: "marker", at: [0, -5], parent: "post-1/top" },
    ],
    instances: [{ id: "post-1", prefab: "post", at: [20, 0], parent: "pen" }],
  };
  const applyTree = (to: SceneDefinition, batch: OpBatch) => {
    const r = applyOps(to, batch, yardEngine, { prefabs, validate: "none" });
    if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
    return r.def;
  };
  const world = (def: SceneDefinition, id: string) =>
    resolveScene(def, yardEngine, prefabs).entities!.find((e) => e.id === id)!.at;

  it("cuts a parent with its subtree, each child removed before its parent", () => {
    const { text, batch } = cutSelection(tree, ["peg"], yardEngine, prefabs);
    expect(JSON.parse(text).entities.map((e: { id: string }) => e.id)).toEqual(["peg", "pip"]);
    expect(batch.ops).toEqual([{ op: "remove", refs: ["pip", "peg"] }]);
    const all = cutSelection(tree, ["pip", "pen"], yardEngine, prefabs).batch;
    expect(all.ops).toEqual([{ op: "remove", refs: ["lamp", "pip", "peg", "post-1", "pen"] }]);
    expect(applyTree(tree, all).entities ?? []).toEqual([]);
  });

  it("removes what sits under a cut instance child, which it turns off", () => {
    const { batch } = cutSelection(tree, ["post-1/top"], yardEngine, prefabs);
    expect(batch.ops).toEqual([
      { op: "remove", refs: ["lamp"] },
      { op: "override", ref: "post-1", set: { "top.off": true } },
    ]);
  });

  it("pastes a copied child under nothing, where it stood", () => {
    const text = copySelection(tree, ["peg"], yardEngine, prefabs);
    const r = pasteFragment(text, { def: tree, registry: yardEngine, prefabs });
    if (!r.ok) throw new Error(r.issues[0]!.message);
    expect(r.batch.ops[0]).toEqual({
      op: "add",
      entity: { id: "peg-2", type: "marker", at: [100, 110] },
    });
    const after = applyTree(tree, r.batch);
    expect(world(after, "pip-2")).toEqual(world(tree, "pip"));
  });

  it("duplicates a parent with its subtree, the copies under the copy", () => {
    const r = duplicateSelection(tree, ["pen"], yardEngine, 1, { prefabs });
    if (!r.ok) throw new Error(r.issues[0]!.message);
    expect(r.batch.label).toBe("Duplicate");
    expect(r.batch.ops.some((op) => op.op === "reparent")).toBe(false);
    expect(r.select).toEqual(["pen-2", "peg-2", "pip-2", "post-2", "lamp-2"]);
    const after = applyTree(tree, r.batch);
    const [x, y] = world(tree, "lamp") as [number, number];
    expect(world(after, "lamp-2")).toEqual([x + 1, y + 1]);
  });

  it("duplicates a child next to its original, under the same parent", () => {
    const r = duplicateSelection(tree, ["peg", "post-1"], yardEngine, 1, { prefabs });
    if (!r.ok) throw new Error(r.issues[0]!.message);
    expect(r.batch.ops.at(-1)).toEqual({
      op: "reparent",
      refs: ["peg-2", "post-2"],
      parent: "pen",
    });
    const after = applyTree(tree, r.batch);
    expect(after.entities!.find((e) => e.id === "peg-2")?.parent).toBe("pen");
    const [x, y] = world(tree, "pip") as [number, number];
    expect(world(after, "pip-2")).toEqual([x + 1, y + 1]);
  });
});

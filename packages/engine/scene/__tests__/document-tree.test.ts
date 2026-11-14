// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { applyOps } from "../ops";
import {
  documentTree,
  enclosingInstance,
  headOfRef,
  instanceLevels,
  ownChildId,
  parentCycles,
  reexpressEntity,
  sceneFrames,
} from "../resolve";
import { frame, IDENTITY_2D, invert } from "../transform";
import { PARENT_MAX_DEPTH, type SceneDefinition } from "../types";

const engine = createRegistry();

describe("child refs", () => {
  it("splits a resolved ref into its levels", () => {
    expect(headOfRef("room-1/door-1/panel")).toBe("room-1");
    expect(headOfRef("lamp")).toBe("lamp");
    expect(enclosingInstance("room-1/door-1/panel")).toBe("room-1/door-1");
    expect(enclosingInstance("lamp")).toBeUndefined();
    expect(enclosingInstance("~solid:0")).toBeUndefined();
    expect(instanceLevels("room-1/door-1/panel")).toEqual([
      "room-1",
      "room-1/door-1",
      "room-1/door-1/panel",
    ]);
    expect(instanceLevels("~solid:0")).toEqual(["~solid:0"]);
    expect(ownChildId("room-1/door-1/panel")).toBe("panel");
    expect(ownChildId("lamp")).toBe("lamp");
  });
});

describe("parentCycles", () => {
  it("lists each loop once, from the id that sorts last up its parents", () => {
    const declared = new Map<string, string | undefined>([
      ["a", "c"],
      ["b", "a"],
      ["c", "b"],
      ["d", "a"],
      ["e", "e"],
      ["f", "gone"],
    ]);
    const known = (ref: string) => declared.has(ref);
    expect(parentCycles(declared, known)).toEqual([["c", "b", "a"], ["e"]]);
  });

  it("follows a parent naming an instance's child to the instance", () => {
    const declared = new Map<string, string | undefined>([
      ["hub", "post-1/top"],
      ["post-1", "hub"],
    ]);
    expect(parentCycles(declared, () => true)).toEqual([["post-1", "hub"]]);
  });
});

describe("documentTree", () => {
  const def: SceneDefinition = {
    v: 5,
    name: "tree",
    bounds: [0, 0, 100, 100],
    entities: [
      { id: "rig", type: "node", at: [0, 0] },
      { id: "arm", type: "node", at: [1, 0], parent: "rig" },
      { id: "hat", type: "marker", at: [0, 0], parent: "gate-1/door" },
      { id: "lamp", type: "marker", at: [0, 0] },
    ],
    instances: [{ id: "gate-1", prefab: "gate", at: [0, 0], parent: "arm" }],
  };
  const tree = documentTree(def);

  it("puts an instance's child under its instance, and anything else under its parent", () => {
    expect(tree.parentOf("hat")).toBe("gate-1/door");
    expect(tree.parentOf("gate-1/door")).toBe("gate-1");
    expect(tree.ancestors("hat")).toEqual(["gate-1/door", "gate-1", "arm", "rig"]);
    expect(tree.chain("gate-1/door")).toEqual(["gate-1", "arm", "rig"]);
  });

  it("counts depth as validation does: an instance's child one below its instance", () => {
    expect(tree.depth("rig")).toBe(0);
    expect(tree.depth("gate-1")).toBe(2);
    expect(tree.depth("gate-1/door")).toBe(3);
    expect(tree.depth("hat")).toBe(4);
  });

  it("walks subtrees level by level, through an instance's children", () => {
    expect(tree.subtree(["rig", "lamp"])).toEqual(["rig", "lamp", "arm", "gate-1", "hat"]);
    expect([...tree.below(["arm"])]).toEqual(["gate-1", "hat"]);
    expect(tree.roots(["hat", "lamp", "arm", "gate-1/door"])).toEqual(["lamp", "arm"]);
  });

  it("refuses a loop and a subtree past the depth limit", () => {
    expect(tree.refusal("rig", "hat")).toEqual({ kind: "cycle" });
    expect(tree.refusal("rig", "rig")).toEqual({ kind: "cycle" });
    expect(tree.refusal("lamp", "hat")).toBeNull();
    const deep: SceneDefinition = {
      ...def,
      entities: Array.from({ length: PARENT_MAX_DEPTH + 1 }, (_, k) => ({
        id: `n-${k}`,
        type: "node",
        at: [1, 0] as [number, number],
        ...(k > 0 ? { parent: `n-${k - 1}` } : {}),
      })),
      instances: [],
    };
    expect(documentTree(deep).refusal("n-0", `n-${PARENT_MAX_DEPTH}`)).toEqual({ kind: "cycle" });
    const lone: SceneDefinition = {
      ...deep,
      entities: [...deep.entities!, { id: "x", type: "node", at: [0, 0] }],
    };
    expect(documentTree(lone).refusal("x", `n-${PARENT_MAX_DEPTH - 1}`)).toBeNull();
    expect(documentTree(lone).refusal("x", `n-${PARENT_MAX_DEPTH}`)).toEqual({
      kind: "depth",
      deepest: PARENT_MAX_DEPTH + 1,
    });
  });
});

describe("reexpressEntity", () => {
  it("writes what reparent writes for the same move", () => {
    const def: SceneDefinition = {
      v: 5,
      name: "tree",
      bounds: [0, 0, 100, 100],
      entities: [
        { id: "hub", type: "node", at: [10, 5], rot: 30, flip: true },
        { id: "pin", type: "node", at: [2, 1], rot: 350 },
        { id: "box", type: "solid", shape: ["box", 3, 4, 2, 1, 20] },
      ],
    };
    const into = frame({ at: [10, 5], rot: 30, flip: true });
    const r = applyOps(
      def,
      { ops: [{ op: "reparent", refs: ["pin", "box"], parent: "hub" }] },
      engine,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = sceneFrames(def, engine).under("hub")[0]!;
    expect(by).toEqual(into);
    for (const id of ["pin", "box"]) {
      const was = def.entities!.find((e) => e.id === id)!;
      const now = r.def.entities!.find((e) => e.id === id)!;
      const { parent: _parent, ...stored } = now;
      expect(reexpressEntity(engine, def.settings, was, invert(into))).toEqual(stored);
    }
    expect(reexpressEntity(engine, def.settings, def.entities![0]!, IDENTITY_2D)).toBe(
      def.entities![0],
    );
  });
});

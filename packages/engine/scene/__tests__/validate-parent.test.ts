// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { gridField, pointField } from "../../game/fields";
import type { Registry } from "../../game/types";
import { applyOps } from "../ops";
import { prefabLibrary } from "../prefab";
import {
  PARENT_MAX_DEPTH,
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type IssueCode,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "../types";
import { canBeInTree, validateScene } from "../validate";

const engine = createRegistry();

const scene = (over: Partial<SceneDefinition>): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "tree",
  bounds: [-100, -100, 100, 100],
  ...over,
});

const prefab = (id: string, body: Partial<Prefab>): Prefab => ({
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id,
  entities: [],
  ...body,
});

const TREE_CODES: readonly IssueCode[] = [
  "dangling-ref",
  "parent-cycle",
  "parent-depth",
  "parent-type",
  "quarter-turn-only",
  "grid-invalid",
];

const treeIssues = (issues: readonly SceneIssue[]) =>
  issues.filter((i) => TREE_CODES.includes(i.code));

function only(def: SceneDefinition, code: IssueCode, opts: Opts = {}): SceneIssue {
  const issues = validateScene(def, opts.registry ?? engine, { prefabs: opts.prefabs });
  const hits = issues.filter((i) => i.code === code);
  expect(hits, JSON.stringify(issues)).toHaveLength(1);
  expect(treeIssues(issues).filter((i) => i.code !== code)).toEqual([]);
  return hits[0]!;
}

type Opts = { registry?: Registry; prefabs?: PrefabLibrary };

/** The fix is one reparent, applies through applyOps and leaves the scene without a tree issue. */
function expectFixClears(def: SceneDefinition, issue: SceneIssue, opts: Opts = {}) {
  const registry = opts.registry ?? engine;
  expect(issue.fix?.ops).toHaveLength(1);
  expect(issue.fix!.ops[0]!.op).toBe("reparent");
  const applied = applyOps(def, issue.fix!, registry, { prefabs: opts.prefabs });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  if (!applied.ok) return;
  expect(treeIssues(validateScene(applied.def, registry, { prefabs: opts.prefabs }))).toEqual([]);
  return applied.def;
}

const chain = (n: number): EntityDef[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    id: `n${String(i).padStart(2, "0")}`,
    type: "node",
    at: [1, 0],
    ...(i > 0 ? { parent: `n${String(i - 1).padStart(2, "0")}` } : {}),
  }));

describe("a clean tree", () => {
  it("raises nothing for nodes, entities and instances under each other, an instance's child included", () => {
    const lib = prefabLibrary([
      prefab("crate", { entities: [{ id: "lid", type: "marker", at: [0, 1] }] }),
    ]);
    const def = scene({
      entities: [
        { id: "base", type: "node", at: [10, 0], rot: 30 },
        { id: "barrel", type: "marker", at: [1, 0], parent: "base" },
        { id: "tag", type: "marker", at: [0, 1], parent: "box/lid" },
        { id: "under-box", type: "node", at: [0, 2], parent: "box" },
      ],
      instances: [{ id: "box", prefab: "crate", at: [2, 0], parent: "base" }],
    });
    expect(treeIssues(validateScene(def, engine, { prefabs: lib }))).toEqual([]);
  });

  it("allows exactly the deepest chain", () => {
    const def = scene({ entities: chain(PARENT_MAX_DEPTH) });
    expect(treeIssues(validateScene(def, engine))).toEqual([]);
  });
});

describe("dangling-ref", () => {
  it("names a parent that doesn't exist, and moves the entity to the root", () => {
    const def = scene({
      entities: [
        { id: "a", type: "node", at: [0, 0] },
        { id: "m", type: "marker", at: [1, 1], parent: "ghost" },
      ],
    });
    const issue = only(def, "dangling-ref");
    expect(issue).toMatchObject({ path: "/entities/1/parent", entityIds: ["m"] });
    expect(issue.message).toContain('"ghost"');
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["m"], parent: null }]);
    expectFixClears(def, issue);
  });

  it("names an instance's child its prefab doesn't have, and an instance's parent too", () => {
    const lib = prefabLibrary([
      prefab("crate", { entities: [{ id: "lid", type: "marker", at: [0, 1] }] }),
    ]);
    const def = scene({
      entities: [{ id: "m", type: "marker", at: [1, 1], parent: "box/nope" }],
      instances: [
        { id: "box", prefab: "crate", at: [2, 0] },
        { id: "box-2", prefab: "crate", at: [4, 0], parent: "gone" },
      ],
    });
    const all = validateScene(def, engine, { prefabs: lib });
    const issues = all.filter((i) => i.code === "dangling-ref");
    expect(issues.map((i) => [i.path, i.entityIds])).toEqual([["/instances/1/parent", ["box-2"]]]);
    expect(issues[0]!.fix!.ops).toEqual([{ op: "reparent", refs: ["box-2"], parent: null }]);
    const child = all.filter((i) => i.code === "ref-child-unknown");
    expect(child.map((i) => [i.path, i.entityIds])).toEqual([["/entities/0/parent", ["m"]]]);
    expect(child[0]!.message).toContain('prefab "crate" of box has no such child');
    expect(child[0]!.fix!.ops).toEqual([{ op: "reparent", refs: ["m"], parent: null }]);
  });

  it("leaves a child of an instance whose prefab is missing to prefab-unknown", () => {
    const def = scene({
      entities: [{ id: "m", type: "marker", at: [1, 1], parent: "box/lid" }],
      instances: [{ id: "box", prefab: "nowhere", at: [2, 0] }],
    });
    const codes = validateScene(def, engine, { prefabs: prefabLibrary([]) }).map((i) => i.code);
    expect(codes).toContain("prefab-unknown");
    expect(codes).not.toContain("dangling-ref");
  });
});

describe("parent-cycle", () => {
  it("reports a loop once, on the id the lenient read takes as a root, and moves it to the root", () => {
    const def = scene({
      entities: [
        { id: "a", type: "node", at: [0, 0], parent: "c" },
        { id: "b", type: "node", at: [1, 0], parent: "a" },
        { id: "c", type: "node", at: [2, 0], parent: "b" },
        { id: "m", type: "marker", at: [1, 1], parent: "a" },
      ],
    });
    const issue = only(def, "parent-cycle");
    expect(issue).toMatchObject({ path: "/entities/2/parent", entityIds: ["c", "b", "a"] });
    expect(issue.message).toContain("c → b → a → c");
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["c"], parent: null }]);
    expectFixClears(def, issue);
  });

  it("catches an entity that is its own parent", () => {
    const def = scene({ entities: [{ id: "a", type: "node", at: [0, 0], parent: "a" }] });
    const issue = only(def, "parent-cycle");
    expect(issue).toMatchObject({ path: "/entities/0/parent", entityIds: ["a"] });
    expectFixClears(def, issue);
  });

  it("follows a link through an instance's child back to the instance", () => {
    const lib = prefabLibrary([
      prefab("crate", { entities: [{ id: "lid", type: "marker", at: [0, 1] }] }),
    ]);
    const def = scene({
      entities: [{ id: "a", type: "node", at: [0, 0], parent: "box/lid" }],
      instances: [{ id: "box", prefab: "crate", at: [2, 0], parent: "a" }],
    });
    const issue = only(def, "parent-cycle", { prefabs: lib });
    expect(issue).toMatchObject({ path: "/instances/0/parent", entityIds: ["box", "a"] });
    expectFixClears(def, issue, { prefabs: lib });
  });
});

describe("parent-depth", () => {
  it("reports the first entity past the limit and reparents it one level up", () => {
    const def = scene({ entities: chain(PARENT_MAX_DEPTH + 1) });
    const issue = only(def, "parent-depth");
    expect(issue).toMatchObject({
      path: `/entities/${PARENT_MAX_DEPTH + 1}/parent`,
      entityIds: ["n17"],
      got: "17",
    });
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["n17"], parent: "n15" }]);
    expectFixClears(def, issue);
  });

  it("reports a longer run once, lifting it far enough that its deepest entity fits", () => {
    const def = scene({ entities: chain(PARENT_MAX_DEPTH + 4) });
    const issue = only(def, "parent-depth");
    expect(issue.entityIds).toEqual(["n17"]);
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["n17"], parent: "n12" }]);
    expectFixClears(def, issue);
  });

  it("counts an instance's child as one level below the instance", () => {
    const lib = prefabLibrary([
      prefab("crate", { entities: [{ id: "lid", type: "marker", at: [0, 1] }] }),
    ]);
    const nodes = chain(PARENT_MAX_DEPTH - 2);
    const def = scene({
      entities: [...nodes, { id: "m", type: "marker", at: [0, 0], parent: "box/lid" }],
      instances: [{ id: "box", prefab: "crate", at: [0, 0], parent: nodes.at(-1)!.id }],
    });
    const issue = only(def, "parent-depth", { prefabs: lib });
    expect(issue).toMatchObject({ entityIds: ["m"], got: String(PARENT_MAX_DEPTH + 1) });
    expectFixClears(def, issue, { prefabs: lib });
  });
});

describe("parent-type", () => {
  it("refuses a type that can't be in the tree as a child, moving it to the root", () => {
    const def = scene({
      entities: [
        { id: "a", type: "node", at: [0, 0] },
        { id: "memo", type: "note", at: [1, 1], text: "hi", parent: "a" },
      ],
    });
    const issue = only(def, "parent-type");
    expect(issue).toMatchObject({ path: "/entities/1/parent", entityIds: ["memo"], got: "note" });
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["memo"], parent: null }]);
    expectFixClears(def, issue);
  });

  it("refuses a parent that can't have children, moving the child to the nearest ancestor that can", () => {
    const def = scene({
      entities: [
        { id: "top", type: "node", at: [0, 0] },
        { id: "view", type: "camera-region", shape: ["box", 0, 0, 10, 10] },
        { id: "m", type: "marker", at: [1, 1], parent: "view" },
        { id: "area", type: "nav", shape: ["poly", 0, 0, 4, 0, 4, 4], parent: "top" },
        { id: "k", type: "marker", at: [1, 1], parent: "area" },
      ],
    });
    const issues = validateScene(def, engine).filter((i) => i.code === "parent-type");
    expect(issues.map((i) => [i.path, i.entityIds, i.got, i.fix!.ops])).toEqual([
      [
        "/entities/2/parent",
        ["m", "view"],
        "camera-region",
        [{ op: "reparent", refs: ["m"], parent: null }],
      ],
      ["/entities/3/parent", ["area"], "nav", [{ op: "reparent", refs: ["area"], parent: null }]],
      [
        "/entities/4/parent",
        ["k", "area"],
        "nav",
        [{ op: "reparent", refs: ["k"], parent: "top" }],
      ],
    ]);
    let next = def;
    for (const issue of issues) {
      const applied = applyOps(next, issue.fix!, engine);
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      if (applied.ok) next = applied.def;
    }
    expect(treeIssues(validateScene(next, engine))).toEqual([]);
  });

  it("refuses a bulk entry as a parent", () => {
    const def = scene({
      solid: [["box", 0, 0, 10, 1]],
      entities: [{ id: "m", type: "marker", at: [1, 1], parent: "~solid:0" }],
    });
    const issue = only(def, "parent-type");
    expect(issue).toMatchObject({
      path: "/entities/0/parent",
      entityIds: ["m", "~solid:0"],
      got: "bulk entry",
    });
    expectFixClears(def, issue);
  });

  it("refuses a nested instance as a parent, moving the child to the instance that holds it", () => {
    const prefabs = prefabLibrary([
      prefab("door", { entities: [{ id: "panel", type: "node", at: [1, 0] }] }),
      prefab("hall", {
        entities: [{ id: "post", type: "node", at: [0, 0] }],
        instances: [{ id: "door-1", prefab: "door", at: [4, 0] }],
      }),
    ]);
    const def = scene({
      entities: [{ id: "m", type: "marker", at: [1, 1], parent: "hall-1/door-1" }],
      instances: [{ id: "hall-1", prefab: "hall", at: [20, 0] }],
    });
    const issue = only(def, "parent-type", { prefabs });
    expect(issue).toMatchObject({ entityIds: ["m", "hall-1/door-1"], got: "nested instance" });
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["m"], parent: "hall-1" }]);
    expectFixClears(def, issue, { prefabs });
  });

  it("judges by one rule: nav areas, camera regions and notes stay out", () => {
    expect(
      ["node", "marker", "solid", "sensor", "follower"].every((t) =>
        canBeInTree(engine.types.get(t)),
      ),
    ).toBe(true);
    expect(["nav", "camera-region", "note"].some((t) => canBeInTree(engine.types.get(t)))).toBe(
      false,
    );
  });
});

describe("quarter-turn-only", () => {
  const oneWay = (parent: string): EntityDef => ({
    id: "ledge",
    type: "solid",
    shape: ["box", 1, 0, 2, 0.5],
    oneWay: true,
    parent,
  });

  it("reports a side field under a frame off the quarter turns, and moves it to the root", () => {
    const def = scene({
      entities: [{ id: "tilt", type: "node", at: [0, 0], rot: 30 }, oneWay("tilt")],
    });
    const issue = only(def, "quarter-turn-only");
    expect(issue).toMatchObject({ path: "/entities/1/parent", entityIds: ["ledge"] });
    expect(issue.message).toContain("oneWay");
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["ledge"], parent: null }]);
    expectFixClears(def, issue);
  });

  it("reparents to the nearest ancestor whose frame is on the quarter turns", () => {
    const def = scene({
      entities: [
        { id: "outer", type: "node", at: [0, 0], rot: 90 },
        { id: "tilt", type: "node", at: [1, 0], rot: 30, parent: "outer" },
        oneWay("tilt"),
      ],
    });
    const issue = only(def, "quarter-turn-only");
    expect(issue.fix!.ops).toEqual([{ op: "reparent", refs: ["ledge"], parent: "outer" }]);
    expectFixClears(def, issue);
  });

  it("takes a quarter turn, and a turned box's own angle as a frame", () => {
    const quarter = scene({
      entities: [{ id: "turn", type: "node", at: [0, 0], rot: 270 }, oneWay("turn")],
    });
    expect(treeIssues(validateScene(quarter, engine))).toEqual([]);
    const box = scene({
      entities: [{ id: "plank", type: "solid", shape: ["box", 0, 0, 4, 1, 15] }, oneWay("plank")],
    });
    expect(only(box, "quarter-turn-only").entityIds).toEqual(["ledge"]);
  });

  it("reports an instance whose children have side fields, under a turned node, with no fix", () => {
    const lib = prefabLibrary([
      prefab("step", {
        entities: [{ id: "ledge", type: "solid", shape: ["box", 0, 0, 2, 0.5], oneWay: "left" }],
      }),
    ]);
    const def = scene({
      entities: [{ id: "tilt", type: "node", at: [0, 0], rot: 45 }],
      instances: [{ id: "s", prefab: "step", at: [1, 0], parent: "tilt" }],
    });
    const issue = only(def, "quarter-turn-only", { prefabs: lib });
    expect(issue).toMatchObject({ path: "/instances/0/parent", entityIds: ["s"] });
    expect(issue.message).toContain("s/ledge.oneWay");
    expect(issue.fix).toBeUndefined();
  });
});

describe("grid fields under a turned parent", () => {
  const PAINT = defineEntityType({
    type: "paint",
    description: "Painted cells.",
    base: "marker",
    fields: { at: pointField("The grid's corner."), cells: gridField("The cells.").optional() },
  });
  const painter = createRegistry(
    defineGame({
      id: "painter",
      types: [PAINT],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const floor = (parent: string): EntityDef => ({
    id: "floor",
    type: "paint",
    at: [0, 0],
    cells: { "0,0": ["1*2"] },
    parent,
  });
  const painted = (grid: Record<string, unknown>, rot: number) =>
    scene({
      game: "painter",
      settings: { grid } as SceneDefinition["settings"],
      entities: [{ id: "turn", type: "node", at: [0, 0], rot }, floor("turn")],
    });

  it("is grid-invalid under a quarter turn when the cells aren't square, as under a group", () => {
    const issue = only(painted({ kind: "square", cell: [0.32, 0.64] }, 90), "grid-invalid", {
      registry: painter,
    });
    expect(issue).toMatchObject({ path: "/entities/1/parent", entityIds: ["turn"] });
  });

  it("turns square cells by a quarter, and refuses any other angle with quarter-turn-only", () => {
    const square = { kind: "square", cell: [0.32, 0.32] };
    expect(treeIssues(validateScene(painted(square, 90), painter))).toEqual([]);
    const def = painted(square, 30);
    const issue = only(def, "quarter-turn-only", { registry: painter });
    expect(issue.entityIds).toEqual(["floor"]);
    expectFixClears(def, issue, { registry: painter });
  });
});

describe("overrides and physics", () => {
  it("never lets an override set a child's parent", () => {
    const lib = prefabLibrary([
      prefab("pair", {
        entities: [
          { id: "hub", type: "node", at: [0, 0] },
          { id: "m", type: "marker", at: [1, 0], parent: "hub" },
        ],
      }),
    ]);
    const def = scene({
      instances: [{ id: "p", prefab: "pair", at: [0, 0], overrides: { "m.parent": null } }],
    });
    const issue = validateScene(def, engine, { prefabs: lib }).find(
      (i) => i.code === "unused-override",
    );
    expect(issue).toMatchObject({ path: "/instances/0/overrides/m.parent" });
  });

  it("lets a physics-free scene hold a child, a follower's included", () => {
    const tree = scene({
      settings: { physics: "none" },
      entities: [
        { id: "arm", type: "node", at: [0, 0], rot: 90 },
        { id: "plate", type: "solid", shape: ["box", 1, 0, 2, 0.5], parent: "arm" },
        { id: "eye", type: "sensor", shape: ["box", 1, 1, 1, 1], parent: "arm" },
      ],
    });
    expect(validateScene(tree, engine).map((i) => i.code)).not.toContain("physics-required");
    const rider = scene({
      settings: { physics: "none" },
      entities: [
        {
          id: "lift",
          type: "follower",
          shape: ["box", 0, 0, 2, 0.5],
          path: {
            pts: [
              [0, 0],
              [4, 0],
            ],
            mode: "loop",
            speed: 1,
          },
        },
        { id: "deck", type: "solid", shape: ["box", 0, -1, 2, 0.5], parent: "lift" },
      ],
    });
    expect(validateScene(rider, engine).map((i) => i.code)).not.toContain("physics-required");
  });
});

describe("whole pixels under a turned parent", () => {
  const nonInteger = (def: SceneDefinition) =>
    validateScene(def, engine).filter((i) => i.code === "non-integer");

  it("judges a child under a frame off the quarter turns by its stored values", () => {
    const def = scene({
      entities: [
        { id: "arm", type: "node", at: [0, 0], rot: 30 },
        { id: "forearm", type: "node", at: [1, 0], parent: "arm" },
        { id: "plate", type: "solid", shape: ["box", 1, 0, 2, 0.5], parent: "forearm" },
      ],
    });
    expect(nonInteger(def)).toEqual([]);
  });

  it("snaps the stored value, not the world one", () => {
    const def = scene({
      entities: [
        { id: "arm", type: "node", at: [0, 0], rot: 30 },
        { id: "forearm", type: "node", at: [1.0001, 0], parent: "arm" },
      ],
    });
    const [issue, ...rest] = nonInteger(def);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ path: "/entities/1/at/0", entityIds: ["forearm"] });
    expect(issue!.fix!.ops).toEqual([{ op: "update", ref: "forearm", set: { at: [1, 0] } }]);
    const applied = applyOps(def, issue!.fix!, engine);
    expect(applied.ok && nonInteger(applied.def)).toEqual([]);
  });
});

import { describe, expect, it } from "vite-plus/test";
import type * as Y from "yjs";

import { createRegistry } from "../../game/define";
import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { sceneFrames } from "../../scene/resolve";
import { applyPt, type Transform2D } from "../../scene/transform";
import {
  SCENE_FORMAT_VERSION,
  type OpBatch,
  type SceneDefinition,
  type SceneIssue,
} from "../../scene/types";
import { applyOpsToDoc } from "../apply";
import { docToScene, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import type { SceneOrigin } from "../types";
import { validateDoc } from "../watch-issues";
import { ada, bo, entity, must, pair, sync, text } from "./helpers";
import { SimNetwork } from "./sim-network";

const engine = createRegistry();
const cy: SceneOrigin = { kind: "user", userId: "cy", name: "Cy" };
const people = [ada, bo, cy];

/** A turned hub with an eye under it, three free nodes, a dock and a flag. */
const yard = (): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "yard",
  bounds: [0, 0, 40, 40],
  entities: [
    { id: "hub", type: "node", at: [10, 10], rot: 90 },
    { id: "eye", type: "marker", at: [1, 0], parent: "hub" },
    { id: "x", type: "node", at: [14, 14] },
    { id: "y", type: "node", at: [16, 14], rot: 90 },
    { id: "z", type: "node", at: [18, 14], flip: true },
    { id: "dock", type: "node", at: [30, 30], rot: 180 },
    { id: "flag", type: "marker", at: [20, 5] },
  ],
});

const run = (doc: Y.Doc, batch: OpBatch, who: SceneOrigin = ada) =>
  must(applyOpsToDoc(doc, batch, who, engine));

const reparent = (refs: string[], parent: string | null): OpBatch => ({
  ops: [{ op: "reparent", refs, parent }],
});

const TREE_CODES = new Set(["parent-cycle", "dangling-ref", "parent-type", "parent-depth"]);

const issues = (doc: Y.Doc): SceneIssue[] => validateDoc(doc, engine);

/** Where the lenient read puts an entity's `at` in the world. */
function world(doc: Y.Doc, id: string): [number, number] {
  const def = docToScene(doc);
  const e = entity(doc, id);
  if (!e || !Array.isArray(e.at)) throw new Error(`${id} has no at`);
  const steps: readonly Transform2D[] = sceneFrames(def, engine).stepsFor(e);
  return steps.reduce<[number, number]>(
    (p, t) => applyPt(t, p) as [number, number],
    [e.at[0] as number, e.at[1] as number],
  );
}

const near = (got: [number, number], want: [number, number]) => {
  expect(got[0]).toBeCloseTo(want[0], 6);
  expect(got[1]).toBeCloseTo(want[1], 6);
};

/** Every peer holds the same scene and reads the same issue list; answers its tree issues. */
function oneTree(docs: Y.Doc[]): SceneIssue[] {
  const [first, ...rest] = docs;
  const list = issues(first!);
  for (const doc of rest) {
    expect(text(doc)).toBe(text(first!));
    expect(issues(doc)).toEqual(list);
  }
  const def = docToScene(first!);
  const frames = sceneFrames(def, engine);
  for (const doc of rest) {
    const other = sceneFrames(docToScene(doc), engine);
    for (const e of def.entities ?? []) expect(other.parentOf(e.id)).toBe(frames.parentOf(e.id));
  }
  return list.filter((i) => TREE_CODES.has(i.code));
}

/** Applies the one tree issue's fix on `doc`, syncs, and expects no tree issue left on any peer. */
function fixOn(doc: Y.Doc, list: SceneIssue[], docs: Y.Doc[], settle: () => void): void {
  expect(list).toHaveLength(1);
  const fix = list[0]!.fix;
  expect(fix?.ops).toHaveLength(1);
  expect(fix!.ops[0]!.op).toBe("reparent");
  run(doc, fix!);
  settle();
  expect(oneTree(docs)).toEqual([]);
  expect(issues(docs[0]!)).toEqual([]);
}

describe("two clients reparenting at once", () => {
  it("a cycle from two valid reparents: one tree, one parent-cycle on the id that sorts last, fixed by one reparent", () => {
    const [a, b] = pair(yard());
    run(a, reparent(["x"], "y"), ada);
    run(b, reparent(["y"], "x"), bo);
    sync(a, b);

    const list = oneTree([a, b]);
    expect(list.map((i) => i.code)).toEqual(["parent-cycle"]);
    expect(list[0]!.entityIds).toEqual(["y", "x"]);
    expect(list[0]!.fix).toEqual({
      label: "Move y to the root",
      ops: [{ op: "reparent", refs: ["y"], parent: null }],
    });
    const frames = sceneFrames(docToScene(a), engine);
    expect(frames.parentOf("y")).toBeUndefined();
    expect(frames.parentOf("x")).toBe("y");
    // The fix keeps each entity where the lenient read shows it.
    const yAt = world(a, "y");
    const xAt = world(a, "x");
    fixOn(b, list, [a, b], () => sync(a, b));
    near(world(a, "y"), yAt);
    near(world(a, "x"), xAt);
    expect(entity(a, "x")!.parent).toBe("y");
    expect(entity(a, "y")!.parent).toBeUndefined();
  });

  it("a reparent under an entity the other client deletes: one tree, one dangling-ref, fixed in place by a reparent to the root", () => {
    const [a, b] = pair(yard());
    run(a, reparent(["flag"], "dock"), ada);
    run(b, { ops: [{ op: "remove", refs: ["dock"] }] }, bo);
    sync(a, b);

    expect(entity(a, "dock")).toBeUndefined();
    expect(entity(a, "flag")!.parent).toBe("dock");
    const list = oneTree([a, b]);
    expect(list.map((i) => [i.code, i.entityIds])).toEqual([["dangling-ref", ["flag"]]]);
    expect(list[0]!.fix?.ops).toEqual([{ op: "reparent", refs: ["flag"], parent: null }]);
    expect(sceneFrames(docToScene(b), engine).parentOf("flag")).toBeUndefined();

    const at = world(b, "flag");
    fixOn(a, list, [a, b], () => sync(a, b));
    expect(entity(b, "flag")!.parent).toBeUndefined();
    near(world(b, "flag"), at);
  });

  it("a reparent out of a parent while the other client moves that parent: no issue, the child stays where it was reparented", () => {
    for (const to of [null, "dock"]) {
      const [a, b] = pair(yard());
      const before = world(a, "eye");
      run(a, reparent(["eye"], to), ada);
      near(world(a, "eye"), before);
      run(b, { ops: [{ op: "move", refs: ["hub"], by: [5, -2] }] }, bo);
      near(world(b, "eye"), [before[0] + 5, before[1] - 2]);
      sync(a, b);

      expect(oneTree([a, b])).toEqual([]);
      expect(issues(a)).toEqual([]);
      expect(entity(a, "eye")!.parent).toBe(to ?? undefined);
      expect(entity(a, "hub")!.at).toEqual([15, 8]);
      near(world(a, "eye"), before);
      near(world(b, "eye"), before);
    }
  });

  it("a three-way cycle over a lossy network, in any delivery order, reads alike and takes one fix", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rand = rng(seed * 104729);
      const net = new SimNetwork(3, rand, sceneToDoc(yard(), { key: sequentialKeys("srv") }));
      const docs = net.docs;
      const moves: [string, string][] = [
        ["x", "y"],
        ["y", "z"],
        ["z", "x"],
      ];
      moves.forEach(([child, parent], i) => run(docs[i]!, reparent([child], parent), people[i]!));
      if (seed % 3 === 0) net.partition([seed % 2]);
      while (net.pending > 0) net.deliver(1 + Math.floor(rand() * 3));
      net.settle();

      const list = oneTree(docs);
      expect(
        list.map((i) => i.code),
        `seed ${seed}`,
      ).toEqual(["parent-cycle"]);
      expect(list[0]!.entityIds).toEqual(["z", "x", "y"]);
      expect(sceneFrames(docToScene(docs[0]!), engine).parentOf("z")).toBeUndefined();
      const fixer = docs[seed % 3]!;
      fixOn(fixer, list, docs, () => net.settle());
      expect(docToScene(docs[0]!).entities!.map((e) => [e.id, e.parent ?? null])).toEqual([
        ["hub", null],
        ["eye", "hub"],
        ["x", "y"],
        ["y", "z"],
        ["z", null],
        ["dock", null],
        ["flag", null],
      ]);
    }
  });

  it("both clients applying the same fix at once still end on one tree with no issues", () => {
    const [a, b] = pair(yard());
    run(a, reparent(["x"], "y"), ada);
    run(b, reparent(["y"], "x"), bo);
    run(b, { ops: [{ op: "remove", refs: ["dock"] }] }, bo);
    run(a, reparent(["flag"], "dock"), ada);
    sync(a, b);
    const list = oneTree([a, b]);
    expect(list.map((i) => i.code).sort()).toEqual(["dangling-ref", "parent-cycle"]);
    for (const issue of list) {
      run(a, issue.fix!, ada);
      run(b, issue.fix!, bo);
    }
    sync(a, b);
    expect(oneTree([a, b])).toEqual([]);
    expect(issues(a)).toEqual([]);
  });
});

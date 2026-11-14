import { describe, expect, it } from "vite-plus/test";

import { swapped } from "../../__tests__/fixtures/live-version";
import { pivotGame, pivotRegistry } from "../../__tests__/fixtures/pivot-game";
import { expectPoseClose, steps } from "../../__tests__/fixtures/tree-rig";
import { expandScene } from "../../scene/expand";
import {
  SCENE_FORMAT_VERSION,
  type ExpandedScene,
  type RuntimeEntity,
  type SceneDefinition,
} from "../../scene/types";
import { createSceneRuntime } from "../runtime";
import type { SceneRuntimeHandle } from "../types";

/** pivot (node) ─┬─ arm ── tip (node) ── hand */
const scene = (pivot: Partial<RuntimeEntity> = {}, tip: Partial<RuntimeEntity> = {}) =>
  ({
    name: "swap-node-turn",
    bounds: [-20, -20, 20, 20],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities: [
      { id: "pivot", type: "node", at: [0, 0], ...pivot },
      { id: "arm", type: "marker", at: [2, 0], parent: "pivot" },
      { id: "tip", type: "node", at: [3, 0], parent: "arm", ...tip },
      { id: "hand", type: "marker", at: [4, 0], parent: "tip" },
    ],
  }) as ExpandedScene;

function loaded(scene: ExpandedScene): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game: pivotGame });
  expect(rt.load(scene, undefined, { sceneId: "swap-node-turn" })).toMatchObject({ ok: true });
  return rt;
}

function started(pivot: Partial<RuntimeEntity> = {}): SceneRuntimeHandle {
  const rt = loaded(scene(pivot));
  steps(rt, 5);
  return rt;
}

const quarter = Math.PI / 2;

describe("a live swap that only turns a node", () => {
  it("turns the node and carries its children round with it", () => {
    const rt = started();
    const report = swapped(rt.swap(scene({ rot: 90 }), { prefabs: new Map() }));
    expect(report.strategy).toBe("reconcile");
    expectPoseClose(rt.ctx.poses.get("pivot"), { x: 0, y: 0, rot: quarter }, "pivot");
    expectPoseClose(rt.ctx.poses.get("arm"), { x: 0, y: 2, rot: quarter }, "arm");
    steps(rt, 3);
    expectPoseClose(rt.ctx.poses.get("pivot"), { x: 0, y: 0, rot: quarter }, "pivot later");
  });

  it("turns a child node, whose own frame is the arm's, and what it carries", () => {
    const rt = started();
    swapped(rt.swap(scene({}, { rot: 90 }), { prefabs: new Map() }));
    expectPoseClose(rt.ctx.poses.get("tip"), { x: 3, y: 0, rot: quarter }, "tip");
    expectPoseClose(rt.ctx.poses.get("hand"), { x: 3, y: 1, rot: quarter }, "hand");
    expectPoseClose(rt.ctx.poses.get("arm"), { x: 2, y: 0, rot: 0 }, "arm");
  });

  it("turns a game type based on node the same way", () => {
    const rt = started({ type: "pivot" });
    const report = swapped(rt.swap(scene({ type: "pivot", rot: 90 }), { prefabs: new Map() }));
    expect(report.strategy).toBe("reconcile");
    expectPoseClose(rt.ctx.poses.get("pivot"), { x: 0, y: 0, rot: quarter }, "pivot");
    expectPoseClose(rt.ctx.poses.get("arm"), { x: 0, y: 2, rot: quarter }, "arm");
  });
});

describe("a live swap of a resolved scene that turns a node", () => {
  const doc = (type: string, rot?: number): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    name: "swap-node-turn",
    bounds: [-20, -20, 20, 20],
    settings: { gravity: [0, 0], physics: "none" },
    entities: [
      { id: "pivot", type, at: [0, 0], ...(rot === undefined ? {} : { rot }) },
      { id: "arm", type: "marker", at: [2, 0], parent: "pivot" },
      { id: "tip", type: "node", at: [3, 0], rot: 45, parent: "arm" },
      { id: "hand", type: "marker", at: [4, 0], parent: "tip" },
    ],
  });

  const poses = (rt: SceneRuntimeHandle) =>
    ["pivot", "arm", "tip", "hand"].map((id) => [id, rt.ctx.poses.get(id)!] as const);

  it("puts what sits under a node where a fresh load of the target does", () => {
    const registry = pivotRegistry();
    const target = expandScene(doc("node", 90), registry);
    const rt = loaded(expandScene(doc("node"), registry));
    steps(rt, 5);
    expect(swapped(rt.swap(target, { prefabs: new Map() })).strategy).toBe("reconcile");
    const fresh = loaded(target);
    expectPoseClose(fresh.ctx.poses.get("arm"), { x: 0, y: 2, rot: quarter }, "fresh arm");
    for (const [id, want] of poses(fresh)) expectPoseClose(rt.ctx.poses.get(id), want, id);
    rt.destroy();
    fresh.destroy();
  });

  it.each([0, 90])("frames a type based on node as a node, at rot %s", (rot) => {
    const registry = pivotRegistry();
    const asNode = loaded(expandScene(doc("node", rot), registry));
    const asPivot = loaded(expandScene(doc("pivot", rot), registry));
    for (const [id, want] of poses(asNode)) expectPoseClose(asPivot.ctx.poses.get(id), want, id);
    asNode.destroy();
    asPivot.destroy();
  });
});

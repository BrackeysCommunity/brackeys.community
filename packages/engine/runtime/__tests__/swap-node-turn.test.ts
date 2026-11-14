import { describe, expect, it } from "vite-plus/test";

import { swapped } from "../../__tests__/fixtures/live-version";
import { testGame } from "../../__tests__/fixtures/test-game";
import { expectPoseClose, steps } from "../../__tests__/fixtures/tree-rig";
import type { ExpandedScene, RuntimeEntity } from "../../scene/types";
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

function started(): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
  expect(rt.load(scene(), undefined, { sceneId: "swap-node-turn" })).toMatchObject({ ok: true });
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
});

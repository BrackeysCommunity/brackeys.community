// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { SpawnerSystem } from "../../../game/behaviors/spawner";
import { defineEntityType, defineGame } from "../../../game/define";
import { pointField } from "../../../game/fields";
import type { SceneSystem } from "../../../game/types";
import { SCENE_FORMAT_VERSION, type ExpandedScene, type Prefab } from "../../../scene/types";
import { createSceneRuntime } from "../../runtime";
import { SPAWNER_SPAWNED } from "../../types";

const dot = defineEntityType({
  type: "dot",
  description: "A point with no state of its own.",
  fields: { at: pointField("Where it stands.") },
  system: (): SceneSystem => {
    const live = new Set<string>();
    return {
      spawn: (e) => void live.add(e.id),
      despawn: (id) => void live.delete(id),
      clear: () => live.clear(),
      size: () => live.size,
    };
  },
});

const pivot = defineEntityType({
  type: "pivot",
  description: "A hub based on the node primitive.",
  base: "node",
  fields: { at: pointField("Its origin.") },
});

const game = defineGame({
  id: "spawning-nodes",
  types: [dot, pivot],
  actions: [],
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});

/** pivot ── bob */
const rig: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "rig",
  entities: [
    { id: "pivot", type: "pivot", at: [0, 0] },
    { id: "bob", type: "dot", at: [1, 0], parent: "pivot" },
  ],
};

const scene: ExpandedScene = {
  name: "spawning-nodes",
  bounds: [-100, -100, 100, 100],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities: [
    {
      id: "s",
      type: "dot",
      at: [5, 5],
      behaviors: { spawner: { prefab: "rig", rate: 60, cap: 1 } },
    },
  ],
};

describe("a spawned prefab instance", () => {
  it("frees its slot once only nodes are left, a type based on node among them", () => {
    const rt = createSceneRuntime({
      rapier: undefined,
      view: null,
      game,
      prefabs: new Map([["rig", rig]]),
    });
    expect(rt.load(scene)).toMatchObject({ ok: true });
    const spawned: string[] = [];
    const steps = (n: number) => {
      for (let i = 0; i < n; i++) {
        for (const e of rt.step(rt.ctx.time.tickMs, []).events)
          if (e.type === SPAWNER_SPAWNED && e.other) spawned.push(e.other);
      }
    };
    const system = rt.ctx.behavior<SpawnerSystem>("spawner")!;
    steps(2);
    expect(spawned).toHaveLength(1);
    const first = spawned[0]!;
    expect(rt.ctx.exists(`${first}/pivot`)).toBe(true);
    rt.ctx.destroy(`${first}/bob`);
    steps(1);
    expect(rt.ctx.exists(first)).toBe(false);
    expect(rt.ctx.exists(`${first}/pivot`)).toBe(false);
    expect(spawned).toHaveLength(2);
    expect(system.live("s")).toEqual([spawned[1]]);
    rt.destroy();
  });
});

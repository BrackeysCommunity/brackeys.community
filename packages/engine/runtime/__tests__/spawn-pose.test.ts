// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { ExpandedScene, RuntimeEntity } from "../../scene/types";
import { createSceneRuntime } from "../runtime";
import { currentPose, spawnPose } from "../spawn-pose";

const registry = createRegistry();
const node = (more: Partial<RuntimeEntity> = {}): RuntimeEntity =>
  ({ id: "n", type: "node", at: [3, 4], ...more }) as RuntimeEntity;

describe("a node's spawn pose", () => {
  it("stands at its own rot", () => {
    expect(spawnPose(node({ rot: 90 }), registry)).toEqual({ x: 3, y: 4, rot: Math.PI / 2 });
  });

  it("takes the angle of what it sits in when it has no rot", () => {
    const e = node({ transform: { rot: 180, flip: false } });
    expect(spawnPose(e, registry)).toEqual({ x: 3, y: 4, rot: Math.PI });
  });

  it("is where the node system puts it, and currentPose's fallback agrees", () => {
    const e = node({ rot: 45, transform: { rot: 90, flip: false } });
    const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
    const scene = {
      name: "spawn-pose-node",
      bounds: [-20, -20, 20, 20],
      settings: {
        gravity: [0, 0],
        physics: "none",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [e],
    } as ExpandedScene;
    expect(rt.load(scene, undefined, { sceneId: "spawn-pose-node" })).toMatchObject({ ok: true });
    const placed = rt.ctx.poses.get("n");
    expect(placed).toEqual(spawnPose(e, rt.ctx.registry));
    const unposed = {
      poses: { get: () => undefined },
      get: (id: string) => rt.ctx.get(id),
      registry: rt.ctx.registry,
    } as never;
    expect(currentPose(unposed, "n")).toEqual(placed);
    rt.destroy();
  });
});

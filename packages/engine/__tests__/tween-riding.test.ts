import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createSceneRuntime } from "../runtime/runtime";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import type { RapierModule } from "../types";
import { steps } from "./fixtures/tree-rig";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const box = { type: "box", cx: 1, cy: -1, hw: 1, hh: 0.2, rotDeg: 0 } as const;
const tween = { tween: { tweens: [{ to: { y: 3 }, duration: 5 }] } };

function riding(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "riding",
    bounds: [-50, -50, 50, 50],
    settings: {
      gravity: [0, 0],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

describe("a tween on an entity riding a host", () => {
  it("moves it in the host's frame, its collider on the host's body", () => {
    const rt = createSceneRuntime({ rapier, view: null });
    const report = rt.load(
      riding([
        {
          id: "lift",
          type: "follower",
          shape: { type: "box", cx: 0, cy: 0, hw: 0.5, hh: 0.1, rotDeg: 0 },
          path: {
            pts: [
              [0, 0],
              [4, 0],
            ],
            mode: "loop",
            speed: 1,
          },
        },
        { id: "plank", type: "solid", parent: "lift", shape: box, behaviors: tween },
      ]),
    );
    expect(report.ok).toBe(true);
    steps(rt, 10);
    expect(rt.ctx.tree.local("plank")).toMatchObject({ x: 1, y: expect.closeTo(3, 6) });
    const [handle] = rt.ctx.tags.handlesOf("plank");
    const plank = rt.ctx.physics!.world.getCollider(handle!)!;
    const lift = plank.parent()!;
    expect(rt.ctx.tags.get(handle!)?.carrier?.entityId).toBe("lift");
    expect(plank.translation().y - lift.translation().y).toBeCloseTo(3, 4);
    expect(rt.ctx.poses.get("plank")!.x - rt.ctx.poses.get("lift")!.x).toBeCloseTo(1, 6);
    rt.destroy();
  });

  it("plays on the pose of one whose parent names no live host", () => {
    const rt = createSceneRuntime({ rapier, view: null });
    const report = rt.load(
      riding([{ id: "plank", type: "solid", parent: "ghost", shape: box, behaviors: tween }]),
    );
    expect(report.ok).toBe(true);
    expect(rt.ctx.tree.parent("plank")).toBeNull();
    steps(rt, 10);
    expect(rt.ctx.poses.get("plank")).toMatchObject({ x: 1, y: 3 });
    rt.destroy();
  });
});

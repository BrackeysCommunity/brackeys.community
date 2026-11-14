// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { ease } from "../anim/ease";
import type { BehaviorSystem } from "../game/behaviors";
import { defineGame } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { formatSaveFile, parseSaveFile } from "../game/save-file";
import { loadListed } from "../runtime/flow";
import { relativePose, type Pose } from "../runtime/poses";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { prefabLibrary } from "../scene/prefab";
import {
  SCENE_FORMAT_VERSION,
  type InstanceDef,
  type Prefab,
  type RuntimeEntity,
  type SceneDefinition,
} from "../scene/types";
import { testGame } from "./fixtures/test-game";

const game = defineGame({
  ...testGame,
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});

/** Ticks of the arm's swing. */
const SWING = 30;

/** An arm 2 m out along the rig's x axis, swinging out to 4 m and back. */
const RIG: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "rig",
  entities: [
    {
      id: "arm",
      type: "marker",
      at: [2, 0],
      behaviors: {
        tween: {
          tweens: [{ from: { x: 2 }, to: { x: 4 }, duration: SWING, yoyo: true, repeat: -1 }],
        },
      },
    },
  ],
};
const PREFABS = prefabLibrary([RIG]);

/** The rig placed at (5, 5), turned a quarter, so its frame is neither the world's nor a translation of it. */
const PLACED: InstanceDef = { id: "rig", prefab: "rig", at: [5, 5], rot: 90 };

function scene(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "tree-tween",
    bounds: [-50, -50, 50, 50],
    settings: { physics: "none", gravity: [0, 0] },
    entities: [],
    instances: [PLACED],
  };
}

function load(opts?: { timeOffsetMs: number }): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game, prefabs: PREFABS });
  const report = rt.load(expandScene(scene(), rt.ctx.registry, { prefabs: PREFABS }), opts);
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const step = (rt: SceneRuntimeHandle, n = 1) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};

/** `id`'s pose in `parent`'s frame, from the live world poses. */
const offset = (rt: SceneRuntimeHandle, id: string, parent: string): Pose =>
  relativePose(rt.ctx.poses.get(id)!, rt.ctx.poses.get(parent)!);

/** The arm's x in the rig's frame `k` ticks into a swing that started at tick 0. */
function swingX(k: number): number {
  const play = Math.floor((k - 1) / SWING);
  const at = k - play * SWING;
  const out = play % 2 === 0;
  const t = ease("linear", at / SWING);
  return out ? 2 + 2 * t : 4 - 2 * t;
}

/** Moves the rig 10 m right and turns it 1 rad over 120 ticks, by a tween code started. */
const moveRig = (rt: SceneRuntimeHandle) =>
  rt.ctx.tweens.to("rig", { to: { x: 15, rot: 1.5 }, duration: 120 });

describe("a tween on a child", () => {
  it("moves it in its parent's frame, keeping its offset while the parent moves and turns", () => {
    const rt = load();
    expect(rt.ctx.tree.parent("rig/arm")).toBe("rig");
    moveRig(rt);
    for (let k = 1; k <= 150; k++) {
      step(rt);
      const local = offset(rt, "rig/arm", "rig");
      expect(local.x).toBeCloseTo(swingX(k), 9);
      expect(local.y).toBeCloseTo(0, 9);
      expect(local.rot).toBeCloseTo(0, 9);
      expect(rt.ctx.tree.local("rig/arm")!.x).toBeCloseTo(swingX(k), 9);
    }
    const rig = rt.ctx.poses.get("rig")!;
    expect([rig.x, rig.y, rig.rot]).toEqual([15, 5, 1.5]);
    rt.destroy();
  });

  it("starts each channel it doesn't give a `from` for at the child's local pose", () => {
    const rt = load();
    rt.ctx.tweens.to("rig/arm", { to: { y: 1 }, duration: 10, key: "lift" });
    step(rt, 10);
    const local = offset(rt, "rig/arm", "rig");
    expect(local.y).toBeCloseTo(1, 9);
    expect(local.x).toBeCloseTo(swingX(10), 9);
    rt.destroy();
  });

  it("seeks to where stepping would put it", () => {
    const stepped = load();
    step(stepped, 47);
    const sought = load({ timeOffsetMs: 47 * stepped.ctx.time.tickMs });
    const a = stepped.ctx.poses.get("rig/arm")!;
    const b = sought.ctx.poses.get("rig/arm")!;
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(offset(sought, "rig/arm", "rig").x).toBeCloseTo(swingX(47), 9);
    stepped.destroy();
    sought.destroy();
  });

  it("starts over from its block's `from` on a reset, in the parent's frame where it is now", () => {
    const rt = load();
    moveRig(rt);
    step(rt, 45);
    rt.ctx.behavior<BehaviorSystem>("tween")!.reset!();
    for (let k = 1; k <= 20; k++) {
      step(rt);
      expect(offset(rt, "rig/arm", "rig").x).toBeCloseTo(swingX(k), 9);
    }
    rt.destroy();
  });

  it("saves and restores under a moving parent, to the same digest 300 ticks on", () => {
    const library: SceneLibrary = {
      list: [{ scene: "tree-tween" }],
      scenes: new Map<string, LibraryScene>([["tree-tween", { def: scene(), prefabs: PREFABS }]]),
    };
    const runtime = () => createSceneRuntime({ rapier: null, view: null, game, scenes: library });
    const run = (rt: SceneRuntimeHandle, ticks: number) => {
      const frames: unknown[] = [];
      for (let t = 0; t < ticks; t++) {
        const result = rt.step(rt.ctx.time.tickMs, []);
        const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
          const p = rt.ctx.poses.get(id)!;
          return [id, p.x, p.y, p.rot];
        });
        frames.push([result.tick, result.events, poses]);
      }
      return hashText(JSON.stringify(frames));
    };

    const a = runtime();
    expect(loadListed(a, "tree-tween").ok).toBe(true);
    moveRig(a);
    run(a, 53);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const digest = run(a, 300);

    const parsed = parseSaveFile(formatSaveFile(captured.file), game);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = runtime();
    const restored = restoreSave(b, parsed.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(offset(b, "rig/arm", "rig").x).toBeCloseTo(swingX(53), 9);
    expect(run(b, 300)).toBe(digest);
    a.destroy();
    b.destroy();
  });
});

describe("a tween on a root", () => {
  it("writes the world pose as before, its children following", () => {
    const entities: RuntimeEntity[] = [
      { id: "post", type: "marker", at: [1, 1] },
      { id: "flag", type: "marker", at: [1, 3], parent: "post" },
    ];
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    const report = rt.load({
      name: "root",
      bounds: [-50, -50, 50, 50],
      settings: {
        gravity: [0, 0],
        physics: "none",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities,
    });
    if (!report.ok) throw new Error(report.error);
    rt.ctx.tweens.to("post", { to: { x: 5 }, duration: 20 });
    for (let k = 1; k <= 20; k++) {
      step(rt);
      const want = k === 20 ? 5 : 1 + 4 * ease("linear", k / 20);
      expect(rt.ctx.poses.get("post")).toEqual({ x: want, y: 1, rot: 0 });
      expect(rt.ctx.poses.get("flag")).toEqual({ x: want, y: 3, rot: 0 });
    }
    rt.destroy();
  });
});

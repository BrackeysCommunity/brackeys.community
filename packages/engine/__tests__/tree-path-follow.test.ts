// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { PathFollowSystem } from "../game/behaviors/path-follow";
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
  type EntityDef,
  type InstanceDef,
  type Prefab,
  type SceneDefinition,
} from "../scene/types";
import type { Vec2 } from "../types";
import { testGame } from "./fixtures/test-game";

const game = defineGame({
  ...testGame,
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});

const PATH = {
  pts: [
    [0, 0],
    [3, 0],
    [3, -2],
  ],
  mode: "ping_pong",
  speed: 1.7,
  pauseMs: 250,
};

/** A marker on the path: its pose is written. */
const car: EntityDef = {
  id: "car",
  type: "marker",
  at: [0, 0],
  behaviors: { "path-follow": { path: PATH } },
};

/** A kinematic platform on the path: its velocity moves it. */
const lift: EntityDef = {
  id: "lift",
  type: "marker",
  at: [0, 0],
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.5, 0.1] },
    body: { kind: "kinematic" },
    "path-follow": { path: PATH },
  },
};

const TRACK: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "track",
  entities: [car, lift],
};
const PREFABS = prefabLibrary([TRACK]);

/** The track placed at (5, 5), turned a quarter. */
const PLACED: InstanceDef = { id: "track", prefab: "track", at: [5, 5], rot: 90 };

function scene(entities: EntityDef[] = [], instances: InstanceDef[] = [PLACED]): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "tree-path",
    bounds: [-50, -50, 50, 50],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
    instances,
  };
}

function load(def = scene(), opts?: { timeOffsetMs: number }): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game, prefabs: PREFABS });
  const report = rt.load(expandScene(def, rt.ctx.registry, { prefabs: PREFABS }), opts);
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const step = (rt: SceneRuntimeHandle, n = 1) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};

const offset = (rt: SceneRuntimeHandle, id: string, parent: string): Pose =>
  relativePose(rt.ctx.poses.get(id)!, rt.ctx.poses.get(parent)!);

/** The path as written, traced tick by tick by a root follower at the origin. */
function reference(ticks: number): Vec2[] {
  const rt = load(scene([car], []));
  const out: Vec2[] = [];
  for (let k = 0; k < ticks; k++) {
    step(rt);
    const p = rt.ctx.poses.get("car")!;
    out.push({ x: p.x, y: p.y });
  }
  rt.destroy();
  return out;
}

/** Slides the track 10 m right and turns it 1 rad over 120 ticks. */
const moveTrack = (rt: SceneRuntimeHandle) =>
  rt.ctx.tweens.to("track", { to: { x: 15, rot: 1.5 }, duration: 120 });

const close = (got: Pose | Vec2, want: Vec2, digits: number) => {
  expect(got.x).toBeCloseTo(want.x, digits);
  expect(got.y).toBeCloseTo(want.y, digits);
};

describe("path-follow under a parent", () => {
  it("traces its path in the parent's frame while the parent moves and turns", () => {
    const ref = reference(200);
    const rt = load();
    expect(rt.ctx.tree.parent("track/car")).toBe("track");
    moveTrack(rt);
    for (let k = 0; k < 200; k++) {
      step(rt);
      close(offset(rt, "track/car", "track"), ref[k]!, 9);
    }
    expect(rt.ctx.poses.get("track")!.rot).toBe(1.5);
    rt.destroy();
  });

  it("moves a kinematic body toward its point in the parent's frame, self-moving", () => {
    const ref = reference(200);
    const rt = load();
    moveTrack(rt);
    for (let k = 0; k < 120; k++) {
      step(rt);
      // Its velocity was set before the track moved this tick: one tick of the track's motion behind.
      const before = rt.ctx.poses.prev("track")!;
      close(relativePose(rt.ctx.poses.get("track/lift")!, before), ref[k]!, 6);
    }
    for (let k = 120; k < 200; k++) {
      step(rt);
      close(offset(rt, "track/lift", "track"), ref[k]!, 6);
    }
    rt.destroy();
  });

  it("sits where it was placed at load, its path as the instance put it", () => {
    const rt = load();
    expect(rt.ctx.poses.get("track/car")).toMatchObject({ x: 5, y: 5 });
    step(rt);
    const ref = reference(1);
    close(offset(rt, "track/car", "track"), ref[0]!, 9);
    rt.destroy();
  });

  it("seeks to where stepping would put it", () => {
    const stepped = load();
    step(stepped, 137);
    const sought = load(scene(), { timeOffsetMs: 137 * stepped.ctx.time.tickMs });
    for (const id of ["track/car", "track/lift"]) {
      close(sought.ctx.poses.get(id)!, stepped.ctx.poses.get(id)!, 9);
    }
    stepped.destroy();
    sought.destroy();
  });

  it("resets to its path's start in the parent's frame where the parent is now", () => {
    const ref = reference(40);
    const rt = load();
    moveTrack(rt);
    step(rt, 150);
    rt.ctx.behavior<PathFollowSystem>("path-follow")!.reset!();
    close(offset(rt, "track/car", "track"), { x: 0, y: 0 }, 9);
    close(offset(rt, "track/lift", "track"), { x: 0, y: 0 }, 9);
    for (let k = 0; k < 40; k++) {
      step(rt);
      close(offset(rt, "track/car", "track"), ref[k]!, 9);
    }
    rt.destroy();
  });

  it("takes a new parent's frame when moved under it, staying on its path there", () => {
    const ref = reference(60);
    const rt = load(scene([{ id: "cart", type: "marker", at: [-10, 0] }]));
    step(rt, 20);
    rt.ctx.tree.setParent("track/car", "cart");
    step(rt);
    rt.ctx.setPose("cart", -10, 4, 0.25);
    const at = offset(rt, "track/car", "cart");
    step(rt);
    const next = offset(rt, "track/car", "cart");
    // In the cart's frame it moves on along the path as written, from where it was.
    expect(Math.hypot(next.x - at.x, next.y - at.y)).toBeCloseTo(
      Math.hypot(ref[22]!.x - ref[21]!.x, ref[22]!.y - ref[21]!.y),
      9,
    );
    rt.destroy();
  });

  it("saves and restores under a moving parent, to the same digest 300 ticks on", () => {
    const library: SceneLibrary = {
      list: [{ scene: "tree-path" }],
      scenes: new Map<string, LibraryScene>([["tree-path", { def: scene(), prefabs: PREFABS }]]),
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
    expect(loadListed(a, "tree-path").ok).toBe(true);
    moveTrack(a);
    run(a, 77);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);
    expect(captured.file.world!.systems).toMatchObject({
      "track/car": { "path-follow": { parent: "track", frame: [5, 5, expect.any(Number)] } },
    });
    const saved = captured.file.world!.systems["track/car"] as {
      "path-follow": { frame: number[] };
    };
    expect(saved["path-follow"].frame[2]).toBeCloseTo(Math.PI / 2, 12);
    const digest = run(a, 300);

    const parsed = parseSaveFile(formatSaveFile(captured.file), game);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = runtime();
    const restored = restoreSave(b, parsed.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(run(b, 300)).toBe(digest);
    a.destroy();
    b.destroy();
  });
});

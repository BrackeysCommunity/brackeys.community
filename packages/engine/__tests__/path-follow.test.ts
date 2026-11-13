import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { BehaviorSystem } from "../game/behaviors";
import { createRegistry, defineGame } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { formatSaveFile, parseSaveFile } from "../game/save-file";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { carrierDelta } from "../systems/path-follower";
import type { RapierModule, Vec2 } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const registry = createRegistry(testGame);

type Physics = "rapier" | "none";
type PathSystem = BehaviorSystem & {
  position(id: string): Vec2 | null;
  frameDelta(id: string): Vec2 | null;
  seek(ms: number): void;
  reset(): void;
};

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

function scene(entities: EntityDef[], physics: Physics): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "path-follow",
    bounds: [-20, -20, 20, 20],
    settings: { physics, gravity: [0, 9.8] },
    entities,
  };
}

function load(
  entities: EntityDef[],
  physics: Physics,
  opts?: { timeOffsetMs: number },
): SceneRuntimeHandle {
  const rt = createSceneRuntime({
    rapier: physics === "rapier" ? rapier : null,
    view: null,
    game: testGame,
  });
  const report = rt.load(expandScene(scene(entities, physics), registry), opts);
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const step = (rt: SceneRuntimeHandle, n = 1) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};

const pathFollow = (rt: SceneRuntimeHandle) => rt.ctx.behavior<PathSystem>("path-follow")!;

const lift = (path: unknown = PATH): EntityDef => ({
  id: "lift",
  type: "follower",
  shape: ["box", 0, 0, 0.5, 0.1],
  path,
});

/** A marker on the path with nothing else: its pose is written. */
const sprite = (path: unknown = PATH): EntityDef => ({
  id: "sprite",
  type: "marker",
  at: [5, 5],
  behaviors: { "path-follow": { path } },
});

/** A kinematic body on the path: its velocity moves it. */
const platform = (path: unknown = PATH, id = "platform"): EntityDef => ({
  id,
  type: "marker",
  at: [5, 5],
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.5, 0.1] },
    body: { kind: "kinematic" },
    "path-follow": { path },
  },
});

const at = (rt: SceneRuntimeHandle, id: string) => {
  const p = rt.ctx.poses.get(id)!;
  return { x: p.x, y: p.y };
};

describe("path-follow", () => {
  it("keeps pose for pose with a follower on the same path over 600 ticks, on either backend", () => {
    for (const physics of ["none", "rapier"] as const) {
      for (const mode of ["ping_pong", "loop"]) {
        const path = { ...PATH, mode };
        const rt = load([lift(path), sprite(path), platform(path)], physics);
        expect(at(rt, "sprite")).toEqual({ x: 0, y: 0 });
        expect(at(rt, "platform")).toEqual({ x: 0, y: 0 });
        let moved = 0;
        for (let t = 0; t < 600; t++) {
          step(rt);
          const want = at(rt, "lift");
          const s = at(rt, "sprite");
          const p = at(rt, "platform");
          if (physics === "none") expect(s).toEqual(want);
          else {
            expect(s.x).toBeCloseTo(want.x, 5);
            expect(s.y).toBeCloseTo(want.y, 5);
          }
          expect(p.x).toBeCloseTo(want.x, physics === "none" ? 9 : 4);
          expect(p.y).toBeCloseTo(want.y, physics === "none" ? 9 : 4);
          expect(pathFollow(rt).position("sprite")).toEqual(
            rt.ctx.behavior<PathSystem>("path-follow")!.position("platform"),
          );
          moved = Math.max(moved, want.x);
        }
        expect(moved).toBeGreaterThan(2.9);
        rt.destroy();
      }
    }
  });

  it("moves a kinematic body by its velocity, and carrierDelta answers for its collider", () => {
    for (const physics of ["none", "rapier"] as const) {
      const rt = load([lift(), sprite(), platform()], physics);
      step(rt, 30);
      const [handle] = rt.ctx.tags.handlesOf("platform");
      const [liftHandle] = rt.ctx.tags.handlesOf("lift");
      const delta = carrierDelta(rt.ctx, handle!)!;
      const liftDelta = carrierDelta(rt.ctx, liftHandle!)!;
      expect(delta.x).toBeCloseTo(liftDelta.x, physics === "none" ? 9 : 5);
      expect(delta.y).toBeCloseTo(liftDelta.y, physics === "none" ? 9 : 5);
      expect(delta.x).toBeGreaterThan(0);
      const v = rt.ctx.bodies.velocity("platform");
      expect(v.x).toBeCloseTo(delta.x * rt.ctx.time.rate, 6);
      expect(pathFollow(rt).frameDelta("sprite")).toBeNull();
      rt.destroy();
    }
  });

  it("carries a dynamic crate standing on its kinematic body", () => {
    const path = {
      pts: [
        [0, 2],
        [6, 2],
      ],
      mode: "ping_pong",
      speed: 1,
    };
    const crate: EntityDef = {
      id: "crate",
      type: "marker",
      at: [0, 1.6],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.2, 0.2], friction: 1 },
        body: { kind: "dynamic", fixedRotation: true },
      },
    };
    const deck: EntityDef = {
      id: "deck",
      type: "marker",
      at: [0, 2],
      behaviors: {
        collider: { shape: ["box", 0, 0, 1, 0.1], friction: 1 },
        body: { kind: "kinematic" },
        "path-follow": { path },
      },
    };
    const rt = load([deck, crate], "rapier");
    step(rt, 30);
    const offset = at(rt, "crate").x - at(rt, "deck").x;
    step(rt, 180);
    const deckAt = at(rt, "deck");
    const crateAt = at(rt, "crate");
    expect(deckAt.x).toBeGreaterThan(3);
    expect(crateAt.x - deckAt.x).toBeCloseTo(offset, 1);
    expect(crateAt.y).toBeLessThan(deckAt.y);
    expect(crateAt.y).toBeGreaterThan(1.6);
    rt.destroy();
  });

  it("seeks to where stepping would put it", () => {
    for (const physics of ["none", "rapier"] as const) {
      const stepped = load([sprite(), platform()], physics);
      const ticks = 137;
      step(stepped, ticks);
      const sought = load([sprite(), platform()], physics, {
        timeOffsetMs: ticks * stepped.ctx.time.tickMs,
      });
      for (const id of ["sprite", "platform"]) {
        expect(pathFollow(sought).position(id)).toEqual(pathFollow(stepped).position(id));
        const want = pathFollow(stepped).position(id)!;
        expect(at(sought, id).x).toBeCloseTo(want.x, 9);
        expect(at(sought, id).y).toBeCloseTo(want.y, 9);
      }
      expect(sought.ctx.bodies.velocity("platform")).toEqual({ x: 0, y: 0 });
      step(stepped, 50);
      step(sought, 50);
      expect(at(sought, "sprite")).toEqual(at(stepped, "sprite"));
      expect(at(sought, "platform").x).toBeCloseTo(at(stepped, "platform").x, 4);
      stepped.destroy();
      sought.destroy();
    }
  });

  it("resets to the path's start, t = 0", () => {
    for (const physics of ["none", "rapier"] as const) {
      const rt = load([sprite(), platform()], physics);
      const fresh = load([sprite(), platform()], physics);
      step(rt, 200);
      expect(pathFollow(rt).position("sprite")).not.toEqual({ x: 0, y: 0 });
      pathFollow(rt).reset();
      for (const id of ["sprite", "platform"]) {
        expect(pathFollow(rt).position(id)).toEqual({ x: 0, y: 0 });
        expect(at(rt, id)).toEqual({ x: 0, y: 0 });
      }
      expect(rt.ctx.bodies.velocity("platform")).toEqual({ x: 0, y: 0 });
      step(rt, 40);
      step(fresh, 40);
      expect(at(rt, "sprite")).toEqual(at(fresh, "sprite"));
      expect(at(rt, "platform").x).toBeCloseTo(at(fresh, "platform").x, 5);
      rt.destroy();
      fresh.destroy();
    }
  });

  it("keeps its path clock while disabled and enables where its path is now", () => {
    const rt = load([lift(), sprite(), platform()], "none");
    step(rt, 20);
    rt.ctx.setEnabled("sprite", false);
    rt.ctx.setEnabled("platform", false);
    const held = at(rt, "platform");
    step(rt, 50);
    expect(at(rt, "platform")).toEqual(held);
    expect(pathFollow(rt).frameDelta("platform")).toBeNull();
    rt.ctx.setEnabled("sprite", true);
    rt.ctx.setEnabled("platform", true);
    for (const id of ["sprite", "platform"]) {
      expect(pathFollow(rt).position(id)).toEqual(at(rt, "lift"));
      expect(at(rt, id)).toEqual(at(rt, "lift"));
    }
    step(rt, 30);
    expect(at(rt, "sprite")).toEqual(at(rt, "lift"));
    expect(at(rt, "platform").x).toBeCloseTo(at(rt, "lift").x, 9);
    rt.destroy();
  });

  it("keeps its place through an edit to its speed, starts again on new points, and stops a body it lets go of", () => {
    const rt = load([platform()], "none");
    step(rt, 20);
    const was = pathFollow(rt).position("platform")!;
    const edit = (behaviors: Record<string, Record<string, unknown>>) => {
      const e = rt.get("platform")!;
      const report = rt.update([{ ...e, behaviors }]);
      expect(report.ok).toBe(true);
    };
    const blocks = rt.get("platform")!.behaviors!;
    edit({ ...blocks, "path-follow": { path: { ...PATH, speed: 3 } } });
    expect(pathFollow(rt).position("platform")).toEqual(was);
    step(rt);
    expect(rt.ctx.bodies.velocity("platform").x).toBeCloseTo(3, 6);
    edit({
      ...blocks,
      "path-follow": {
        path: {
          ...PATH,
          pts: [
            [1, 1],
            [2, 1],
          ],
        },
      },
    });
    expect(at(rt, "platform")).toEqual({ x: 1, y: 1 });
    step(rt, 5);
    const { "path-follow": _gone, ...rest } = rt.get("platform")!.behaviors!;
    edit(rest);
    expect(rt.ctx.bodies.velocity("platform")).toEqual({ x: 0, y: 0 });
    const stopped = at(rt, "platform");
    step(rt, 10);
    expect(at(rt, "platform")).toEqual(stopped);
    rt.destroy();
  });

  it("saves and restores mid-path on the geometry backend, to the same digest 300 ticks on", () => {
    const def = scene(
      [lift(), sprite(), platform(), platform({ ...PATH, mode: "loop" }, "ring")],
      "none",
    );
    const library: SceneLibrary = {
      list: [{ scene: "path-follow" }],
      scenes: new Map<string, LibraryScene>([["path-follow", { def, prefabs: new Map() }]]),
    };
    const game = defineGame({
      ...testGame,
      createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
    });
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
    expect(loadListed(a, "path-follow").ok).toBe(true);
    run(a, 97);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);
    expect(captured.file.world!.systems).toMatchObject({
      sprite: { "path-follow": { state: expect.any(Array) } },
      platform: { "path-follow": { state: expect.any(Array) } },
    });
    const digest = run(a, 300);

    const parsed = parseSaveFile(formatSaveFile(captured.file), game);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = runtime();
    const restored = restoreSave(b, parsed.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(run(b, 300)).toBe(digest);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { defineGame } from "../game/define";
import { formatSaveFile, parseSaveFile, type SaveFile } from "../game/save-file";
import type { EngineContext } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle } from "../runtime/types";
import { hashText } from "../scene/hash";
import type { ExpandedScene } from "../scene/types";
import { testGame } from "./fixtures/test-game";
import { marker, markerWith } from "./fixtures/tree-rig";

const SCENE_ID = "tree-saves";

/**
 * base ─┬─ arm ── hand
 *       └─ leg
 * loose
 */
const SCENE: ExpandedScene = {
  name: SCENE_ID,
  bounds: [-20, -20, 20, 20],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities: [
    marker("base", [1, 1]),
    marker("arm", [3, 1], { parent: "base" }),
    marker("hand", [4.25, 1.5], { parent: "arm" }),
    marker("leg", [1, 3], { parent: "base" }),
    marker("loose", [-5, -5]),
  ],
};

/** What a run does on tick `t`, the same in the saved run and the restored one. */
type Script = (ctx: EngineContext, t: number) => void;

/** The test game with nothing of its own to save; `base`, where there is one, turns and drifts every tick. */
const game = defineGame({
  ...testGame,
  createRuntime: (ctx) => ({
    beforeStep() {
      const t = ctx.tick;
      if (ctx.get("base"))
        ctx.setPose("base", 1 + Math.sin(t * 0.05) * 3, 1 + Math.cos(t * 0.03) * 2, t * 0.021);
    },
    snapshot: () => null,
    restore: () => {},
  }),
});

function runtime(scene = SCENE): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game });
  expect(rt.load(scene, undefined, { sceneId: scene.name })).toMatchObject({ ok: true });
  return rt;
}

/** Each tick's events, every entity's pose and every link, hashed. */
function run(rt: SceneRuntimeHandle, script: Script, from: number, ticks: number): string {
  const frames: unknown[] = [];
  for (let t = from; t < from + ticks; t++) {
    script(rt.ctx, t);
    const result = rt.step(rt.ctx.time.tickMs, []);
    const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
      const p = rt.ctx.poses.get(id)!;
      return [id, p.x, p.y, p.rot, rt.ctx.tree.parent(id), rt.ctx.enabled(id)];
    });
    frames.push([result.tick, result.events, poses]);
  }
  return hashText(JSON.stringify(frames));
}

/** Runs to `at`, saves, runs 300 more; then restores the save's text into a fresh runtime and runs the same 300. */
function saveAndReplay(script: Script, at = 60, scene = SCENE) {
  const a = runtime(scene);
  run(a, script, 0, at);
  const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
  if (!captured.ok) throw new Error(captured.issue.message);
  const digest = run(a, script, at, 300);

  const parsed = parseSaveFile(formatSaveFile(captured.file), game);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const b = runtime(scene);
  const restored = restoreSave(b, parsed.file);
  if (!restored.ok) throw new Error(restored.issue.message);
  const ids = scene.entities.map((e) => e.id);
  const restoredAt = {
    parents: Object.fromEntries(ids.map((id) => [id, b.ctx.tree.parent(id)])),
    children: Object.fromEntries(ids.map((id) => [id, [...b.ctx.tree.children(id)]])),
  };
  return {
    file: captured.file as SaveFile,
    digest,
    b,
    restoredAt,
    replay: run(b, script, at, 300),
  };
}

describe("world saves of the scene tree (geometry backend)", () => {
  it("a save with reparented entities restores to the same digest 300 ticks later", () => {
    const script: Script = (ctx, t) => {
      if (t === 30) ctx.tree.setParent("hand", "leg");
      if (t === 35) ctx.tree.setParent("loose", "arm");
      if (t === 40) ctx.destroy("arm");
      if (t === 120) ctx.tree.setParent("hand", null);
      if (t === 180) ctx.tree.setParent("hand", "base");
      if (t === 240) ctx.tree.setLocal("leg", 0.5, -1.25, 0.3);
    };
    const { file, digest, replay, restoredAt } = saveAndReplay(script);
    expect(file.world!.destroyed).toEqual(["arm", "loose"]);
    expect(file.world!.parents).toEqual({ hand: "leg" });
    expect(restoredAt.parents).toMatchObject({ base: null, hand: "leg", leg: "base" });
    expect(restoredAt.children.base).toEqual(["leg"]);
    expect(replay).toBe(digest);
  });

  it("keeps a reparented child's place among the siblings it joined", () => {
    const script: Script = (ctx, t) => {
      if (t === 10) ctx.tree.setParent("loose", "base");
      if (t === 20) ctx.tree.setParent("hand", "base");
    };
    const { file, digest, replay, restoredAt } = saveAndReplay(script);
    expect(file.world!.parents).toEqual({ hand: "base", loose: "base" });
    expect(restoredAt.children.base).toEqual(["arm", "leg", "loose", "hand"]);
    expect(replay).toBe(digest);
  });

  it("a save with spawns under parents restores to the same digest, their records holding the links", () => {
    const script: Script = (ctx, t) => {
      if (t === 10)
        ctx.spawn({ type: "marker", id: "marker#bolt", at: [0.5, 0], parent: "arm", local: true });
      if (t === 12)
        ctx.spawn({ type: "marker", id: "marker#nut", at: [0, 0.75], parent: "leg", local: true });
      if (t === 20) ctx.tree.setParent("marker#bolt", "leg");
      if (t === 30) ctx.destroy("arm");
      if (t === 90) ctx.tree.setParent("marker#nut", "marker#bolt");
    };
    const { file, digest, replay, restoredAt } = saveAndReplay(script);
    expect(file.world!.spawned.map((s) => [s.id, s.input.parent])).toEqual([
      ["marker#bolt", "leg"],
      ["marker#nut", "leg"],
    ]);
    expect(file.world).not.toHaveProperty("parents");
    expect(restoredAt.children.leg).toEqual(["marker#bolt", "marker#nut"]);
    expect(replay).toBe(digest);
  });

  it("a spawn reparented under a later spawn keeps that link, and its place among the siblings, through a save", () => {
    const script: Script = (ctx, t) => {
      if (t === 10) ctx.spawn({ type: "marker", id: "marker#a", at: [2, 0] });
      if (t === 12) ctx.spawn({ type: "marker", id: "marker#b", at: [-2, 0] });
      if (t === 14) ctx.tree.setParent("marker#a", "marker#b");
      if (t === 16)
        ctx.spawn({ type: "marker", id: "marker#c", at: [0, 1], parent: "marker#b", local: true });
      if (t >= 60) ctx.setPose("marker#b", -2 + t * 0.01, Math.sin(t * 0.1), t * 0.02);
    };
    const { file, digest, replay, b } = saveAndReplay(script);
    expect(file.world!.parents).toEqual({ "marker#a": "marker#b" });
    expect(replay).toBe(digest);
    expect(b.ctx.tree.parent("marker#a")).toBe("marker#b");
    expect([...b.ctx.tree.children("marker#b")]).toEqual(["marker#a", "marker#c"]);
  });

  it("a save with a child disabled under an enabled parent restores to the same digest 300 ticks later", () => {
    const script: Script = (ctx, t) => {
      if (t === 20) ctx.setEnabled("arm", false);
      if (t === 150) ctx.setEnabled("arm", true);
      if (t === 260) ctx.setEnabled("base", false);
      if (t === 300) ctx.setEnabled("base", true);
    };
    const { file, digest, replay, b } = saveAndReplay(script);
    expect(file.world!.enabled).toEqual({ arm: false });
    expect(file.world).not.toHaveProperty("parents");
    expect(replay).toBe(digest);
    expect(b.ctx.enabled("hand")).toBe(true);
  });

  it("restores the own switches: a child switched off under a disabled parent stays off when the parent comes back", () => {
    const script: Script = (ctx, t) => {
      if (t === 10) ctx.setEnabled("hand", false);
      if (t === 20) ctx.setEnabled("base", false);
      if (t === 100) ctx.setEnabled("base", true);
    };
    const { file, digest, replay, b } = saveAndReplay(script);
    expect(file.world!.enabled).toEqual({ base: false, hand: false });
    expect(replay).toBe(digest);
    expect([b.ctx.enabled("base"), b.ctx.enabled("arm"), b.ctx.enabled("hand")]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("writes no parents when nothing was reparented", () => {
    const { file, digest, replay } = saveAndReplay(() => {});
    expect(file.world).not.toHaveProperty("parents");
    expect(formatSaveFile(file)).not.toContain('"parents"');
    expect(replay).toBe(digest);
  });
});

/** In the test game's `dynamic` group, which its sensors see. */
const BOX = { shape: ["box", 0, 0, 0.5, 0.5], group: "dynamic" };
const SENSOR = { shape: ["box", 0, 0, 1, 1], sensor: true };

/** `box` and `hub`'s child `kid` carry colliders; the sensors `gate` and `ring` sit where setPose moves them. */
const COLLIDERS: ExpandedScene = {
  ...SCENE,
  name: "tree-saves-colliders",
  entities: [
    markerWith("box", [0, 0], { collider: BOX }),
    { id: "hub", type: "node", at: [3, 0] } as ExpandedScene["entities"][number],
    marker("kid", [4, 0], { parent: "hub", behaviors: { collider: BOX } }),
    markerWith("gate", [10, 10], { collider: SENSOR }),
    markerWith("ring", [4, 8], { collider: SENSOR }),
  ],
};

/** The entities whose colliders overlap a small circle at (x, y). */
const hitsAt = (rt: SceneRuntimeHandle, x: number, y: number) =>
  rt.ctx.space
    .overlaps({ type: "circle", cx: x, cy: y, r: 0.05 })
    .map((h) => h.tag.entityId)
    .sort();

describe("world saves of setPose-moved colliders (geometry backend)", () => {
  const script: Script = (ctx, t) => {
    if (t === 5) ctx.setPose("box", 10, 10, 0);
    if (t === 6) ctx.setPose("hub", 3, 8, 0);
    if (t === 150) ctx.setPose("hub", 3, -20, 0);
    if (t === 220) ctx.setPose("box", 0, 0, 0);
  };

  it("puts a moved collider, and a moved parent's collider child, where the restored poses are", () => {
    const { file, digest, replay } = saveAndReplay(script, 10, COLLIDERS);
    expect(file.world!.poses).toMatchObject({ box: [10, 10, 0], kid: [4, 8, 0] });
    expect(replay).toBe(digest);
  });

  it("answers space queries at the restored poses before and after the next step", () => {
    const a = runtime(COLLIDERS);
    run(a, script, 0, 10);
    expect(hitsAt(a, 10, 10)).toEqual(["box"]);
    expect(hitsAt(a, 0, 0)).toEqual([]);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);

    const b = runtime(COLLIDERS);
    const restored = restoreSave(b, captured.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    for (let i = 0; i < 2; i++) {
      expect(hitsAt(b, 10, 10)).toEqual(["box"]);
      expect(hitsAt(b, 0, 0)).toEqual([]);
      expect(hitsAt(b, 4, 8)).toEqual(["kid"]);
      expect(hitsAt(b, 4, 0)).toEqual([]);
      b.step(b.ctx.time.tickMs, []);
    }
  });
});

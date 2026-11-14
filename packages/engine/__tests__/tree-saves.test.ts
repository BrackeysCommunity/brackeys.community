import { describe, expect, it } from "vite-plus/test";

import { defineGame } from "../game/define";
import { formatSaveFile, parseSaveFile, type SaveFile } from "../game/save-file";
import type { EngineContext } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle } from "../runtime/types";
import { hashText } from "../scene/hash";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import { testGame } from "./fixtures/test-game";

const SCENE_ID = "tree-saves";

const marker = (id: string, at: [number, number], parent?: string): RuntimeEntity => ({
  id,
  type: "marker",
  at,
  ...(parent !== undefined ? { parent } : {}),
});

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
    marker("arm", [3, 1], "base"),
    marker("hand", [4.25, 1.5], "arm"),
    marker("leg", [1, 3], "base"),
    marker("loose", [-5, -5]),
  ],
};

/** What a run does on tick `t`, the same in the saved run and the restored one. */
type Script = (ctx: EngineContext, t: number) => void;

/** The test game with nothing of its own to save; `base` turns and drifts every tick. */
const game = defineGame({
  ...testGame,
  createRuntime: (ctx) => ({
    beforeStep() {
      const t = ctx.tick;
      ctx.setPose("base", 1 + Math.sin(t * 0.05) * 3, 1 + Math.cos(t * 0.03) * 2, t * 0.021);
    },
    snapshot: () => null,
    restore: () => {},
  }),
});

function runtime(): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game });
  expect(rt.load(SCENE, undefined, { sceneId: SCENE_ID })).toMatchObject({ ok: true });
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
function saveAndReplay(script: Script, at = 60) {
  const a = runtime();
  run(a, script, 0, at);
  const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
  if (!captured.ok) throw new Error(captured.issue.message);
  const digest = run(a, script, at, 300);

  const parsed = parseSaveFile(formatSaveFile(captured.file), game);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const b = runtime();
  const restored = restoreSave(b, parsed.file);
  if (!restored.ok) throw new Error(restored.issue.message);
  const ids = SCENE.entities.map((e) => e.id);
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

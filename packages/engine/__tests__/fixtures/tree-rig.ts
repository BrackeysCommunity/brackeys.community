import type { Collider } from "@dimforge/rapier2d";
import { expect } from "vite-plus/test";

import type { BehaviorBlock } from "../../game/behaviors";
import { defineGame } from "../../game/define";
import { EngineError } from "../../game/types";
import { relativePose, type Pose } from "../../runtime/poses";
import { createSceneRuntime } from "../../runtime/runtime";
import type { SceneRuntimeHandle, StepEvent, StepResult } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import type {
  ExpandedScene,
  PrefabLibrary,
  Pt,
  RuntimeEntity,
  SceneDefinition,
} from "../../scene/types";
import type { Vec2 } from "../../types";
import { testGame } from "./test-game";

/** The test game without its Rapier-driven avatar, so sensors fire and nothing else needs physics. */
export const quietTestGame = defineGame({
  ...testGame,
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});

/** `def` loaded without Rapier under `quietTestGame`, its instances from `prefabs`. */
export function loadWithPrefabs(
  def: SceneDefinition,
  prefabs: PrefabLibrary,
  opts?: Parameters<SceneRuntimeHandle["load"]>[1],
): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game: quietTestGame, prefabs });
  const report = rt.load(expandScene(def, rt.ctx.registry, { prefabs }), opts);
  if (!report.ok) throw new Error(report.error);
  return rt;
}

/** A marker at `at`, with `extra` fields (a parent, tags, behaviors). */
export const marker = (id: string, at: Pt = [0, 0], extra: Partial<RuntimeEntity> = {}) =>
  ({ id, type: "marker", at, ...extra }) as RuntimeEntity;

/** A marker at `at` carrying `behaviors`. */
export const markerWith = (id: string, at: Pt, behaviors: Record<string, BehaviorBlock> = {}) =>
  marker(id, at, { behaviors });

/** `n` ticks of `rt` with no input. */
export const steps = (rt: SceneRuntimeHandle, n: number): StepResult[] =>
  Array.from({ length: n }, () => rt.step(rt.ctx.time.tickMs, []));

/** The events of `n` ticks of `rt` with no input, in order. */
export const stepEvents = (rt: SceneRuntimeHandle, n: number): StepEvent[] =>
  steps(rt, n).flatMap((r) => r.events);

/** `id`'s live world pose, which must exist. */
export function pose(rt: SceneRuntimeHandle, id: string): Pose {
  const p = rt.ctx.poses.get(id);
  expect(p, id).toBeDefined();
  return p!;
}

/** `id`'s pose in `parent`'s frame, from the live world poses. */
export const offset = (rt: SceneRuntimeHandle, id: string, parent: string): Pose =>
  relativePose(pose(rt, id), pose(rt, parent));

/** The Rapier collider of `id`'s first handle. */
export const colliderOf = (rt: SceneRuntimeHandle, id: string): Collider =>
  rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf(id)[0]!)!;

/** The hash of every tick's events and sorted world poses over `ticks` ticks of `rt` with no input. */
export function traceDigest(rt: SceneRuntimeHandle, ticks: number): string {
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
}

/** `got` is defined and within `digits` decimals of `want` in x and y, and in rot when `want` has one. */
export function expectPoseClose(
  got: Readonly<Pose> | undefined,
  want: Readonly<Vec2> & { readonly rot?: number },
  what = "pose",
  digits = 6,
): void {
  expect(got, what).toBeDefined();
  expect(got!.x, `${what}.x`).toBeCloseTo(want.x, digits);
  expect(got!.y, `${what}.y`).toBeCloseTo(want.y, digits);
  if (want.rot !== undefined) expect(got!.rot, `${what}.rot`).toBeCloseTo(want.rot, digits);
}

/** `scene` with each id in `parents` linked under the one it names, in place. */
export function withParents(
  scene: ExpandedScene,
  parents: Readonly<Record<string, string>>,
): ExpandedScene {
  for (const e of scene.entities) {
    const parent = parents[e.id];
    if (parent !== undefined) e.parent = parent;
  }
  return scene;
}

/** `id`'s live pose is within `digits` decimals of `want`, as `expectPoseClose` checks. */
export const expectPoseOf = (
  rt: SceneRuntimeHandle,
  id: string,
  want: Readonly<Vec2> & { readonly rot?: number },
  digits = 6,
): void => expectPoseClose(pose(rt, id), want, id, digits);

/** The `EngineError` `fn` throws; another throw, or none, fails the test. */
export function engineError(fn: () => unknown): EngineError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    return err as EngineError;
  }
  throw new Error("expected an EngineError");
}

/** The code of the `EngineError` `fn` throws. */
export const engineErrorCode = (fn: () => unknown): string => engineError(fn).code;

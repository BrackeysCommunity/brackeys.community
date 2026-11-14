import { expect } from "vite-plus/test";

import { EngineError } from "../../game/types";
import type { Pose } from "../../runtime/poses";
import type { SceneRuntimeHandle, StepEvent, StepResult } from "../../runtime/types";
import type { ExpandedScene } from "../../scene/types";

/** `n` ticks of `rt` with no input. */
export const steps = (rt: SceneRuntimeHandle, n: number): StepResult[] =>
  Array.from({ length: n }, () => rt.step(rt.ctx.time.tickMs, []));

/** The events of `n` ticks of `rt` with no input, in order. */
export const stepEvents = (rt: SceneRuntimeHandle, n: number): StepEvent[] =>
  steps(rt, n).flatMap((r) => r.events);

/** `got` is defined and within `digits` decimals of `want` in x, y and rot. */
export function expectPoseClose(
  got: Readonly<Pose> | undefined,
  want: Readonly<Pose>,
  what = "pose",
  digits = 6,
): void {
  expect(got, what).toBeDefined();
  expect(got!.x, `${what}.x`).toBeCloseTo(want.x, digits);
  expect(got!.y, `${what}.y`).toBeCloseTo(want.y, digits);
  expect(got!.rot, `${what}.rot`).toBeCloseTo(want.rot, digits);
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

import type { WorldState } from "../game/save-file";
import type { JsonValue } from "../game/types";
import type { RuntimeInputState } from "../input/state";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { saveHostOf } from "./runtime";
import {
  freshLoad,
  notJsonIssue,
  restoreParts,
  unsupported,
  worldSaveBlockers,
  worldStateOf,
  type RestoredParts,
} from "./save-state";
import type { SceneRuntimeHandle } from "./types";

declare const worldSnapshotBrand: unique symbol;

/**
 * A runtime's world in memory at a tick: a world save's state (no JSON) plus
 * each system's and behavior's save. Opaque: only `restoreWorld` reads it.
 */
export type WorldSnapshot = {
  readonly tick: number;
  readonly backend: "geometry" | "rapier";
  readonly [worldSnapshotBrand]: true;
};

export type WorldSnapshotResult =
  | { ok: true; snapshot: WorldSnapshot }
  | { ok: false; issue: SceneIssue };

type Held = {
  tick: number;
  backend: "geometry";
  entry: string | undefined;
  parts: RestoredParts & { world: WorldState };
};

/** Captures the world as a save's world depth would; refuses what `captureSave` refuses, with its issue. */
export function snapshotWorld(runtime: SceneRuntimeHandle): WorldSnapshotResult {
  const host = saveHostOf(runtime.ctx);
  const id = host?.mainScene() ? host.sceneId() : null;
  if (!host || id === null) {
    return {
      ok: false,
      issue: makeIssue("save-unsupported", {
        message: "the world can't be snapshotted: no scene is loaded",
      }),
    };
  }
  const { ctx } = runtime;
  const persist = ctx.persist.value;
  const data = (runtime.snapshot() ?? null) as JsonValue;
  const subject = "the world snapshot";
  const problem = notJsonIssue(subject, { persist, data });
  if (problem) return { ok: false, issue: problem };
  const blockers = worldSaveBlockers(runtime);
  if (blockers.length > 0) return { ok: false, issue: unsupported(blockers) };
  const state = worldStateOf(runtime, host);
  const worldProblem = notJsonIssue(subject, { world: state });
  if (worldProblem) return { ok: false, issue: worldProblem };
  const world = structuredClone(state);
  const held: Held = {
    tick: world.tick,
    backend: "geometry",
    entry: ctx.flow.entry ?? undefined,
    parts: {
      world,
      sceneId: id,
      sublevels: ctx.flow.sublevels().map((s) => ({ ...s, at: [s.at[0], s.at[1]] })),
      data: structuredClone(data),
      persist: structuredClone(persist),
      playTicks: host.playClock().ticks,
    },
  };
  return { ok: true, snapshot: held as unknown as WorldSnapshot };
}

/**
 * Puts `snapshot` back into the runtime it was taken from, as a world-depth
 * restore does: the scene loaded fresh through the entry it was reached by,
 * then the world, the game's `restore`, `persist` and the play clock.
 * Between ticks only; throws when a part can't be put back.
 */
export function restoreWorld(runtime: SceneRuntimeHandle, snapshot: WorldSnapshot): void {
  const host = saveHostOf(runtime.ctx);
  if (!host) throw new Error("restoreWorld needs a runtime built by createSceneRuntime");
  if (host.stepping()) throw new Error("restoreWorld runs between ticks, never inside a step");
  const held = snapshot as unknown as Held;
  const loaded = freshLoad(runtime, host, held.parts.sceneId, held.entry);
  if (!loaded.ok) throw new Error(`the snapshot can't be restored: ${loaded.issue.message}`);
  releaseHeld(runtime);
  const refused = restoreParts(runtime, structuredClone(held.parts));
  if (refused) {
    host.reloadMain();
    throw new Error(`the snapshot can't be restored: ${refused.message}`);
  }
}

/**
 * Releases every action a seat holds now. A restore presses only what the
 * snapshot held, which a fresh runtime starts without; restoring in place
 * must start from the same nothing.
 */
function releaseHeld(runtime: SceneRuntimeHandle): void {
  const input = runtime.ctx.input as RuntimeInputState;
  const tick = runtime.ctx.tick;
  const actions = input
    .players()
    .flatMap(({ index }) =>
      runtime.ctx.registry.actions
        .filter(
          ({ action }) =>
            input.held(action, index) ||
            input.value(action, index) !== 0 ||
            input.vector(action, index).x !== 0 ||
            input.vector(action, index).y !== 0,
        )
        .map(({ action }) => ({ action, pressed: false, player: index, tick, timestamp: 0 })),
    );
  if (actions.length > 0) input.update({ tick, actions, commands: [], pointers: [], joins: [] });
}

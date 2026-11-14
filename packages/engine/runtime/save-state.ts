import type { SublevelInfo } from "../game/flow";
import {
  formatSaveFile,
  SAVE_VERSION,
  slotNameIssue,
  type SaveDepth,
  type SaveFile,
} from "../game/save-file";
import type { JsonValue } from "../game/types";
import { errorText, makeIssue } from "../scene/issues";
import { locatePointer } from "../scene/parse";
import type { SceneIssue } from "../scene/types";
import { ENGINE_VERSION } from "../version";
import { SAVE_TWEENS_KEY, tweenSystemOf } from "./behaviors/tween";
import { flowLoaderOf, loadListed, loadRefusalIssue } from "./flow";
import { persistProblem, plainJsonProblem } from "./persist";
import { runHash } from "./play-session";
import { saveHostOf, type SaveHost } from "./runtime";
import type { LoadReport, SceneRuntimeHandle } from "./types";

/** Why a world save can't be taken now; `message` says it in plain words. */
export type SaveBlocker =
  | { cause: "physics"; message: string }
  | { cause: "timer" | "coroutine"; id: number; owner?: string; message: string }
  | { cause: "tween"; id: number; message: string }
  | { cause: "restore"; message: string };

const PHYSICS_BLOCKER: SaveBlocker = {
  cause: "physics",
  message:
    "the scene runs on Rapier: world saves of physics scenes arrive with online play's snapshots; use a progress save",
};

/**
 * Whether `runtime`'s world may be saved at depth `world`: every cause that
 * refuses it, none when it may. The main scene running on Rapier, a pending
 * function-form timer or coroutine (named by owner), a pending value tween,
 * or a game runtime without `restore`. Every world save is judged by this
 * one rule.
 */
export function worldSaveBlockers(runtime: SceneRuntimeHandle): SaveBlocker[] {
  const out: SaveBlocker[] = [];
  if (runtime.ctx.settings.physics === "rapier") out.push(PHYSICS_BLOCKER);
  for (const { kind, id, owner } of saveHostOf(runtime.ctx)?.unsaveable() ?? []) {
    const what = kind === "timer" ? "a function timer" : "a coroutine";
    const whose = owner === undefined ? "with no owner" : `owned by "${owner}"`;
    out.push({
      cause: kind,
      id,
      ...(owner !== undefined ? { owner } : {}),
      message: `${what} (id ${id}) ${whose} is pending: only emit-form timers can be saved`,
    });
  }
  for (const { id } of tweenSystemOf(runtime.ctx)?.unsaveable() ?? []) {
    out.push({
      cause: "tween",
      id,
      message: `a value tween (id ${id}) is pending: only tweens of an entity's channels can be saved`,
    });
  }
  if (runtime.game && !runtime.game.restore) {
    out.push({
      cause: "restore",
      message: "the game's runtime has no `restore`, so its state can't be put back",
    });
  }
  return out;
}

/**
 * `save-unsupported` naming each cause, at the save's `/depth`: its line in
 * `text`, the save as it would be written at progress depth, when given.
 */
function unsupported(blockers: readonly SaveBlocker[], slot?: string, text?: string): SceneIssue {
  const where = slot === undefined ? "" : ` in slot "${slot}"`;
  const line = text === undefined ? undefined : locatePointer(text, "/depth");
  return makeIssue("save-unsupported", {
    message: `a world save can't be taken${where}: ${blockers.map((b) => b.message).join("; ")}`,
    path: "/depth",
    ...(line !== undefined ? { line } : {}),
    entityIds: blockers.flatMap((b) => ("owner" in b && b.owner !== undefined ? [b.owner] : [])),
    detail: { causes: blockers.map((b) => ({ ...b })) },
  });
}

const failed = (issue: SceneIssue) => ({ ok: false as const, issue });

/** The run hash a save of the loaded main scene is taken under. */
function runHashOf(runtime: SceneRuntimeHandle, host: SaveHost): string {
  const { ctx } = runtime;
  return runHash(host.mainScene()!, ctx.time, ctx.registry, ctx.project, host.prefabs());
}

const notJson = (slot: string, problem: string) =>
  failed(
    makeIssue("schema", {
      message: `slot "${slot}" can't be saved: ${problem}`,
      path: problem.slice(0, problem.indexOf(":")),
    }),
  );

/**
 * A save of `runtime` at `opts.depth`, taken between ticks. `progress`
 * holds the scene, its sublevels, `persist` and the game's `snapshot()`;
 * `world` adds everything the run needs to continue exactly, and is
 * refused as `save-unsupported` with every cause `worldSaveBlockers`
 * names. `meta.savedAt` is the host's `now`, never read by the run.
 */
export function captureSave(
  runtime: SceneRuntimeHandle,
  opts: { depth: SaveDepth; slot: string; title?: string; now: number },
): { ok: true; file: SaveFile } | { ok: false; issue: SceneIssue } {
  const host = saveHostOf(runtime.ctx);
  const main = host?.mainScene() ?? null;
  const id = host?.sceneId() ?? null;
  if (!host || !main || id === null) {
    return failed(
      makeIssue("save-unsupported", {
        message: `slot "${opts.slot}" can't be saved: no scene is loaded`,
      }),
    );
  }
  const badSlot = slotNameIssue(opts.slot);
  if (badSlot) return failed(badSlot);
  const { ctx } = runtime;
  const game = ctx.registry.game;
  const persist = ctx.persist.value;
  const data = (runtime.snapshot() ?? null) as JsonValue;
  const problem = plainJsonProblem({ persist, data });
  if (problem) return notJson(opts.slot, problem);
  const progress: SaveFile = {
    kind: "save",
    v: SAVE_VERSION,
    game: game?.id ?? ctx.registry.id,
    gameVersion: game?.saves?.version ?? 1,
    engine: ENGINE_VERSION,
    release: null,
    project: null,
    slot: opts.slot,
    meta: {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      scene: id,
      savedAt: opts.now,
      playTicks: host.playClock().ticks,
    },
    depth: "progress",
    persist: structuredClone(persist),
    scene: {
      id,
      runHash: runHashOf(runtime, host),
      ...(ctx.flow.entry !== null ? { entry: ctx.flow.entry } : {}),
      sublevels: ctx.flow.sublevels().map((s) => ({ ...s, at: [s.at[0], s.at[1]] })),
    },
    data: structuredClone(data),
  };
  if (opts.depth === "progress") return { ok: true, file: progress };

  const blockers = worldSaveBlockers(runtime);
  if (blockers.length > 0)
    return failed(unsupported(blockers, opts.slot, formatSaveFile(progress)));
  const captured = host.captureWorld();
  const tweens = tweenSystemOf(ctx)?.capture();
  const world =
    tweens === undefined
      ? captured
      : { ...captured, systems: { ...captured.systems, [SAVE_TWEENS_KEY]: { run: tweens } } };
  const worldProblem = plainJsonProblem({ world });
  if (worldProblem) return notJson(opts.slot, worldProblem);
  return { ok: true, file: { ...progress, depth: "world", world: structuredClone(world) } };
}

/**
 * Loads `id` fresh: from the runtime's scene list when it has one, else
 * the main scene it has loaded, which must be `id`.
 */
function freshLoad(
  runtime: SceneRuntimeHandle,
  host: SaveHost,
  id: string,
  entry: string | undefined,
): { ok: true; report: Extract<LoadReport, { ok: true }> } | { ok: false; issue: SceneIssue } {
  const play = host.play();
  if (flowLoaderOf(runtime.ctx)?.read()) {
    const loaded = loadListed(runtime, id, {
      ...(entry !== undefined ? { entry } : {}),
      ...(play ? { play } : {}),
    });
    return loaded.ok ? { ok: true, report: loaded.report } : loaded;
  }
  const current = host.sceneId();
  if (current !== id) {
    return failed(
      makeIssue("scene-unlisted", {
        severity: "error",
        message:
          current === null
            ? `the save is of "${id}", and this runtime has no scene list or scene to load it from`
            : `the save is of "${id}", but this runtime has "${current}" loaded and no scene list`,
        entityIds: [id],
      }),
    );
  }
  const report = host.reloadMain();
  return report.ok ? { ok: true, report } : failed(loadRefusalIssue(id, report));
}

const sameSublevels = (a: readonly SublevelInfo[], b: readonly SublevelInfo[]) =>
  a.length === b.length &&
  a.every((s, i) => {
    const t = b[i]!;
    return s.label === t.label && s.scene === t.scene && s.at[0] === t.at[0] && s.at[1] === t.at[1];
  });

/**
 * Loads `file`'s scene into `runtime` fresh, through the entry it was
 * reached by, and puts back what it saved, between ticks. The save's
 * `persist` is judged by `persistProblem` against the game's schema first,
 * in production too; a game that declares no persist takes only null. Progress depth: the fresh load, the game's `restore`
 * with the saved data, then `persist` and the play clock. World depth puts
 * the world back between the load and the game's `restore` (sublevels,
 * spawns, destroys, counters, enabled flags, the tick, poses and each
 * owner's state, timers, tweens, `ctx.random` and its forks, seats), raising no
 * event. A scene whose run hash changed since the save loads with an info
 * issue; a refused step leaves the scene freshly loaded.
 */
export function restoreSave(
  runtime: SceneRuntimeHandle,
  file: SaveFile,
):
  | { ok: true; report: Extract<LoadReport, { ok: true }>; issues: SceneIssue[] }
  | { ok: false; issue: SceneIssue } {
  const host = saveHostOf(runtime.ctx);
  if (!host) throw new Error("restoreSave needs a runtime built by createSceneRuntime");
  if (host.stepping()) throw new Error("restoreSave runs between ticks, never inside a step");
  const { ctx } = runtime;
  const gameId = ctx.registry.game?.id ?? ctx.registry.id;
  if (file.game !== gameId) {
    return failed(
      makeIssue("schema", {
        message: `this save is for the game "${file.game}", not "${gameId}"`,
        path: "/game",
        got: file.game,
      }),
    );
  }
  const world = file.depth === "world" ? file.world : undefined;
  if (file.depth === "world" && !world) {
    return failed(makeIssue("schema", { message: "a world save holds `world`", path: "/world" }));
  }
  const declared = ctx.registry.game?.persist;
  if (!declared && file.persist !== null) {
    return failed(
      makeIssue("schema", {
        message: `the save holds a persistent value, but "${gameId}" declares no persist`,
        path: "/persist",
      }),
    );
  }
  const persistBad = persistProblem(file.persist, declared?.schema);
  if (persistBad) {
    return failed(
      makeIssue("schema", {
        message: `the save's persist ${persistBad}`,
        path: "/persist",
      }),
    );
  }
  const loaded = freshLoad(runtime, host, file.scene.id, file.scene.entry);
  if (!loaded.ok) return loaded;

  const issues: SceneIssue[] = [];
  const now = runHashOf(runtime, host);
  if (file.scene.runHash !== now) {
    issues.push(
      makeIssue("hash-mismatch", {
        severity: "info",
        message: `"${file.scene.id}" changed since this save (run hash ${file.scene.runHash || "none"}, now ${now}); it loads into the scene as it is now`,
        hint: "Nothing to fix: a save outlives edits to its scene, and what it saved is put back over the current one.",
        entityIds: [file.scene.id],
        detail: { kind: "save", saved: file.scene.runHash, now },
      }),
    );
  }
  const refused = restoreLoaded(runtime, file);
  if (refused) {
    host.reloadMain();
    return failed(refused);
  }
  return { ok: true, report: loaded.report, issues };
}

/**
 * Puts `file` back onto `runtime`'s scene, just loaded fresh, in a
 * restore's order: the world at world depth (sublevels, spawns, destroys,
 * counters, enabled flags, the tick, poses and each owner's state, timers,
 * tweens, `ctx.random` and its forks, seats), the game's `restore` with the saved
 * data, `persist`, then the play clock. The issue of the first part that
 * can't be put back, after which the scene is only partly restored.
 */
export function restoreLoaded(runtime: SceneRuntimeHandle, file: SaveFile): SceneIssue | null {
  const host = saveHostOf(runtime.ctx);
  if (!host) throw new Error("restoreLoaded needs a runtime built by createSceneRuntime");
  const { ctx } = runtime;
  const world = file.depth === "world" ? file.world : undefined;
  if (world) {
    if (ctx.settings.physics === "rapier") return unsupported([PHYSICS_BLOCKER]);
    const refused = host.restoreWorld(world, file.scene.sublevels);
    if (refused) return refused;
    tweenSystemOf(ctx)?.restoreCaptured(world.systems[SAVE_TWEENS_KEY]?.run);
    if (!sameSublevels(ctx.flow.sublevels(), file.scene.sublevels)) {
      return makeIssue("sublevel-invalid", {
        message: `the save's sublevels (${file.scene.sublevels.map((s) => s.label).join(", ") || "none"}) couldn't all be attached again`,
        entityIds: [file.scene.id],
      });
    }
  }
  try {
    runtime.game?.restore?.(structuredClone(file.data));
  } catch (err) {
    return makeIssue("schema", {
      message: `the game's restore refused the save's data: ${errorText(err)}`,
      path: "/data",
    });
  }
  try {
    ctx.persist.set(file.persist);
  } catch (err) {
    return makeIssue("schema", {
      message: `the save's persist was refused: ${errorText(err)}`,
      path: "/persist",
    });
  }
  host.playClock().ticks = file.meta.playTicks;
  return null;
}

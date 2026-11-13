import type { LibraryScene } from "../game/flow";
import {
  clampTiming,
  versionName,
  type SceneSwap,
  type SwapStrategy,
  type SwapTiming,
} from "../game/live";
import type { ResolvedTime } from "../game/time";
import { EngineError, type GameDefinition, type Registry } from "../game/types";
import { stableJson } from "../project/canonical";
import { byCodeUnit } from "../project/kinds/define";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { readSceneVersion, type SceneVersion } from "../project/scene-version";
import type { AssetId, Sha256 } from "../project/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { errorText, leadIssue, liveIssue, makeIssue } from "../scene/issues";
import { sceneHashWith } from "../scene/prefab";
import type { RecordedSwap } from "../scene/recording-schema";
import type {
  ExpandedScene,
  IssueCode,
  PrefabLibrary,
  SceneDefinition,
  SceneIssue,
} from "../scene/types";
import type { GameEventMap, GameLive, StagedVersion } from "../types";
import { flowLoaderOf } from "./flow";
import { runHash } from "./play-session";
import { LOAD_GENERATION } from "./pool";
import { saveHostOf } from "./runtime";
import type { SceneRuntimeHandle } from "./types";

/** A staged version as the layer keeps it: read, validated and expanded once. */
export type PreparedVersion = {
  id: Sha256;
  version: SceneVersion;
  def: SceneDefinition;
  scene: ExpandedScene;
  prefabs: PrefabLibrary;
};

/** A staging that stopped: `live-swap-failed` in the stage phase, `cause` as its hint. */
export function stageIssue(scene: AssetId, cause: string): SceneIssue {
  return liveIssue({ code: "live-swap-failed", scene, cause, phase: "stage" });
}

/** The refusal of a version of `scene` when the game's scene list doesn't hold it; null when it does, or there is no list. */
export function unlistedStageIssue(
  scene: AssetId,
  list: readonly { scene: AssetId }[] | null | undefined,
): SceneIssue | null {
  if (!list || list.some((e) => e.scene === scene)) return null;
  return stageIssue(scene, `${scene} isn't in the game's scene list`);
}

/**
 * The issue for an error thrown out of a step or the game's `live.check`
 * around a swap: an `EngineError` keeps its code, as a blocked run reports
 * it, `what` leading its message; anything else is `live-swap-failed` with
 * `what` and the error as its hint, in phase `after` once the swap applied.
 */
export function thrownSwapIssue(
  err: unknown,
  what: string,
  scene: AssetId,
  registry: Registry,
  applied: boolean,
): SceneIssue {
  if (err instanceof EngineError) {
    const code = err.code as IssueCode;
    const fields = {
      message: `${what}: ${err.message}`,
      entityIds: err.entityId ? [err.entityId] : [],
    };
    return registry.issueCodes[code]
      ? makeIssue(code, fields, registry.issueCodes)
      : { severity: "error", code, ...fields };
  }
  const cause = `${what}: ${errorText(err)}`;
  return liveIssue({
    code: "live-swap-failed",
    scene,
    cause,
    ...(applied ? { phase: "after" } : {}),
  });
}

/** The issue for the game's `live.check` throwing `when` (`right after the swap`, `60 ticks after the swap`). */
export const liveCheckThrew = (
  err: unknown,
  when: string,
  scene: AssetId,
  registry: Registry,
): SceneIssue => thrownSwapIssue(err, `live.check threw ${when}`, scene, registry, true);

/**
 * A fetched version read for play (`readSceneVersion`, with the game's
 * registry) into the form the live layer keeps. When it doesn't read:
 * every issue the read found, and `issue`, the one a staging reports.
 */
export function preparedVersion(
  v: StagedVersion,
  registry: Registry,
  game: GameDefinition | null,
  engine?: Readonly<Record<string, unknown>>,
):
  | { ok: true; prepared: PreparedVersion }
  | { ok: false; issue: SceneIssue; issues: SceneIssue[] } {
  const read = readSceneVersion(v.version, v.texts, registry, game, engine ? { engine } : {});
  if (!read.ok)
    return {
      ok: false,
      issue: leadIssue(read.issues) ?? stageIssue(v.version.scene, "it didn't read"),
      issues: read.issues,
    };
  return {
    ok: true,
    prepared: {
      id: v.id,
      version: v.version,
      def: read.def,
      scene: read.scene,
      prefabs: read.prefabs,
    },
  };
}

type LiveEvent = "live:swapped" | "live:failed";

export type LiveLayerOptions = {
  game: GameDefinition | null;
  /** The runtime playing the main scene now, or null. */
  runtime: () => SceneRuntimeHandle | null;
  /** What `runHash` reads; default the runtime's own. */
  registry?: Registry;
  time?: ResolvedTime;
  project?: ProjectRuntimeView | null | (() => ProjectRuntimeView | null);
  /**
   * The release's own definition of a scene: what a swap back to the
   * release (version null) applies, and the hash a swap from it names.
   */
  release?: (id: AssetId) => LibraryScene | null;
  /** Where `live:swapped` and `live:failed` go: the instance's event bus. */
  emit?: <K extends LiveEvent>(event: K, payload: GameEventMap[K]) => void;
};

export type LiveApplyOptions = {
  timing: SwapTiming;
  /** `reload` forces one; otherwise the swap reconciles when the header is unchanged. */
  strategy?: SwapStrategy;
  /** Default `ctx.tick` at the swap. */
  tick?: number;
};

export type LiveApplyResult = { ok: true; swap: SceneSwap } | { ok: false; issue: SceneIssue };

/**
 * `activate`'s answer: the timing it got, and the issue when it didn't get
 * what was asked (`live-timing-unsupported` for a clamp, `live-swap-failed`
 * for a version that isn't staged). A scene attached as a sublevel of the
 * one playing takes a version at its next attach, so `boundary` and `now`
 * come back as `next-load`, clamped, with no issue.
 */
export type LiveActivation = { timing: SwapTiming; clamped: boolean; issue?: SceneIssue };

/**
 * The versions an instance holds per scene (staged, active and pending), the
 * pin, and the one path that applies a swap: the shell, headless replay, the
 * swap check and Live in Play all go through it. Pixi-free; preloading is
 * the shell's.
 */
export type LiveLayer = Pick<GameLive, "current" | "pending" | "pin" | "unpin"> & {
  /** Keeps a read version resident for its scene; a newer one replaces one not yet activated. */
  stage(prepared: PreparedVersion): { ok: true } | { ok: false; issue: SceneIssue };
  activate(scene: AssetId, version: Sha256 | null, timing: SwapTiming): LiveActivation;
  /**
   * What the runtime's `ctx.live` reads, and `sublevel`, which an attach
   * reads: the scene's active version (or the release's own) once that moved
   * since the running scene's load, else null for the run's library's.
   */
  readonly hooks: {
    version(): Sha256 | null;
    boundary(label?: string): void;
    sublevel(id: AssetId): LibraryScene | null;
  };
  /**
   * The load just made played a definition of the host's own (Play of an
   * editor's doc) whose scene hash is `sceneHash`: the run's version is the
   * scene's active one when that is the same scene, else null.
   */
  loadedDoc(sceneHash: string): void;
  /** Drops `scene`'s waiting boundary or now swap, keeping its active version: a load has left the scene. */
  dropPending(scene: AssetId): void;
  /** After each tick the host stepped; nothing swaps while paused or while a scene change runs. */
  afterTick(state: { paused: boolean; changing: boolean }): void;
  /**
   * Swaps `prepared` (null: the release's own) into the running `scene`,
   * then runs `onSwap`; undoes the swap when it throws. Either way the
   * version is the one the scene's next load uses.
   */
  apply(scene: AssetId, prepared: PreparedVersion | null, opts: LiveApplyOptions): LiveApplyResult;
  /** The active version's definition and prefabs for a load or sublevel attach of `id`; null for the release's own. */
  sceneFor(id: AssetId): PreparedVersion | null;
  /**
   * The listed scenes other than the one playing whose loads use a live
   * version, each as the `next-load` swap that would move it there: what a
   * recording of this load starts with, so its replay attaches the same
   * versions.
   */
  liveSublevels(): SceneSwap[];
  /**
   * Calls `fn` after each applied swap, and when a version of a listed scene
   * other than the one playing is activated during a run (timing
   * `next-load`, nothing changed yet): the run's next attach of that scene
   * uses it, so a recording holds it to replay. Returns the unsubscribe.
   */
  onApplied(fn: (swap: SceneSwap) => void): () => void;
};

/** What a swap applies: a staged version, or the release's own scene (`id` null). */
type Target = {
  id: Sha256 | null;
  sceneHash: string;
  scene: ExpandedScene;
  prefabs: PrefabLibrary;
};

type Pending = { prepared: PreparedVersion | null; timing: SwapTiming };

export function createLiveLayer(opts: LiveLayerOptions): LiveLayer {
  const live = opts.game?.live;
  /** Read but not yet activated, one per scene. */
  const staged = new Map<AssetId, PreparedVersion>();
  /** The version each scene's loads use; absent for the release's own. */
  const active = new Map<AssetId, PreparedVersion>();
  const pending = new Map<AssetId, Pending>();
  const listeners = new Set<(swap: SceneSwap) => void>();
  let pinned = false;
  let marked = false;
  /**
   * The main scene the runtime plays and its version, as of the load `seen`
   * names; `sceneHash` when the load played a definition of the host's own.
   */
  let running: { scene: AssetId; version: PreparedVersion | null; sceneHash?: string } | null =
    null;
  let seen: { runtime: SceneRuntimeHandle; generation: number } | null = null;
  /** Scenes whose active version changed since the running scene's load: an attach of one reads it. */
  const moved = new Set<AssetId>();

  const generationOf = (rt: SceneRuntimeHandle): number =>
    (rt.ctx as { [LOAD_GENERATION]?: () => number })[LOAD_GENERATION]?.() ?? 0;

  const sceneIdOf = (rt: SceneRuntimeHandle): AssetId | null =>
    saveHostOf(rt.ctx)?.sceneId() ?? null;

  /**
   * Notices a load since the last look: the scene it loaded runs the version
   * that scene's loads use, and a swap still waiting is done, since the load
   * used the version (or left the scene).
   */
  function sync(): SceneRuntimeHandle | null {
    const rt = opts.runtime();
    if (!rt) {
      seen = null;
      running = null;
      return null;
    }
    const generation = generationOf(rt);
    if (seen?.runtime === rt && seen.generation === generation) return rt;
    seen = { runtime: rt, generation };
    const scene = sceneIdOf(rt);
    running =
      rt.scene() !== null && scene !== null ? { scene, version: active.get(scene) ?? null } : null;
    pending.clear();
    moved.clear();
    return rt;
  }

  /** After a swap, which may have reloaded: its load is the one `running` already names. */
  function settle(rt: SceneRuntimeHandle): void {
    seen = { runtime: rt, generation: generationOf(rt) };
  }

  function setActive(scene: AssetId, prepared: PreparedVersion | null): void {
    if ((active.get(scene)?.id ?? null) !== (prepared?.id ?? null)) moved.add(scene);
    if (prepared) active.set(scene, prepared);
    else active.delete(scene);
  }

  function emit<K extends LiveEvent>(event: K, payload: GameEventMap[K]): void {
    opts.emit?.(event, payload);
  }

  function projectOf(rt: SceneRuntimeHandle): ProjectRuntimeView | null {
    const given = opts.project;
    if (typeof given === "function") return given();
    return given === undefined ? rt.ctx.project : given;
  }

  function hashRun(rt: SceneRuntimeHandle, scene: ExpandedScene, prefabs: PrefabLibrary): string {
    const registry = opts.registry ?? rt.ctx.registry;
    return runHash(scene, opts.time ?? rt.ctx.time, registry, projectOf(rt), prefabs);
  }

  /** The release's own scene, expanded as a load would; null when the host gave no way to read it. */
  function releaseTarget(rt: SceneRuntimeHandle, scene: AssetId): Target | null {
    const own = opts.release?.(scene);
    if (!own) return null;
    const registry = opts.registry ?? rt.ctx.registry;
    const expanded = expandScene(own.def, registry, {
      prefabs: own.prefabs,
      engine: projectOf(rt)?.engine,
    });
    return {
      id: null,
      sceneHash: sceneHashWith(own.def, own.prefabs),
      scene: expanded,
      prefabs: own.prefabs,
    };
  }

  const targetOf = (p: PreparedVersion): Target => ({
    id: p.id,
    sceneHash: p.version.sceneHash,
    scene: p.scene,
    prefabs: p.prefabs,
  });

  /** The main scene as it loaded and the prefabs the run froze. */
  function loadedOf(rt: SceneRuntimeHandle): { main: ExpandedScene; library: PrefabLibrary } {
    const host = saveHostOf(rt.ctx);
    return { main: host?.mainScene() ?? rt.scene()!, library: host?.prefabs() ?? new Map() };
  }

  /** The side a swap leaves: the running version's hashes, or the release's own. */
  function fromSide(rt: SceneRuntimeHandle, scene: AssetId): SceneSwap["from"] {
    const { main, library } = loadedOf(rt);
    const playing = running?.scene === scene ? running : null;
    const version = playing?.version ?? null;
    const own = version || playing?.sceneHash ? null : opts.release?.(scene);
    const sceneHash = version
      ? version.version.sceneHash
      : (playing?.sceneHash ??
        (own ? sceneHashWith(own.def, own.prefabs) : hashText(stableJson(main))));
    return { version: version?.id ?? null, sceneHash, runHash: hashRun(rt, main, library) };
  }

  /** A version's scene hash, or the release's own scene's ("" when the host gave no way to read it). */
  function sceneHashOf(scene: AssetId, version: PreparedVersion | null): string {
    if (version) return version.version.sceneHash;
    const own = opts.release?.(scene);
    return own ? sceneHashWith(own.def, own.prefabs) : "";
  }

  /** The scenes the running flow lists other than the one playing; none outside a run. */
  function offScenes(rt: SceneRuntimeHandle | null): AssetId[] {
    if (!rt || !running) return [];
    const list = flowLoaderOf(rt.ctx)?.current()?.list ?? [];
    return list.map((e) => e.scene).filter((s) => s !== running?.scene);
  }

  /** `scene`, not the one playing, moving from `before` to `prepared` as a `next-load` swap that changed nothing yet. */
  function offSwap(
    rt: SceneRuntimeHandle,
    scene: AssetId,
    prepared: PreparedVersion | null,
    before: PreparedVersion | null,
  ): SceneSwap {
    const { main, library } = loadedOf(rt);
    const runHash = hashRun(rt, main, library);
    return {
      scene,
      from: { version: before?.id ?? null, sceneHash: sceneHashOf(scene, before), runHash },
      to: { version: prepared?.id ?? null, sceneHash: sceneHashOf(scene, prepared), runHash },
      strategy: "reload",
      carried: "all",
      diff: { added: [], removed: [], changed: [], header: false },
      timing: "next-load",
      tick: rt.ctx.tick,
    };
  }

  /**
   * After `scene`, listed but not the one playing, moved from `before` to
   * `prepared` (null: the release's own) during a run: the listeners hear it
   * as a `next-load` swap, which the run's next attach of the scene uses.
   */
  function activatedOff(
    rt: SceneRuntimeHandle | null,
    scene: AssetId,
    prepared: PreparedVersion | null,
    before: PreparedVersion | null,
  ): void {
    if ((before?.id ?? null) === (prepared?.id ?? null)) return;
    if (!rt || !offScenes(rt).includes(scene)) return;
    const swap = offSwap(rt, scene, prepared, before);
    for (const fn of [...listeners]) fn(swap);
  }

  /** Whether `scene` is attached as a sublevel of the scene playing. */
  const attached = (scene: AssetId): boolean =>
    opts
      .runtime()
      ?.ctx.flow.sublevels()
      .some((s) => s.scene === scene) ?? false;

  function failed(scene: AssetId, version: Sha256 | null, issue: SceneIssue): LiveApplyResult {
    emit("live:failed", { scene, version, issue });
    return { ok: false, issue };
  }

  function apply(
    scene: AssetId,
    prepared: PreparedVersion | null,
    applyOpts: LiveApplyOptions,
  ): LiveApplyResult {
    const version = prepared?.id ?? null;
    const rt = sync();
    setActive(scene, prepared);
    const refuse = (cause: string, phase: "swap" | "onSwap") =>
      failed(scene, version, liveIssue({ code: "live-swap-failed", scene, cause, phase }));
    if (!rt || running?.scene !== scene) return refuse(`${scene} isn't the scene playing`, "swap");
    let target: Target | null;
    try {
      target = prepared ? targetOf(prepared) : releaseTarget(rt, scene);
    } catch (err) {
      return refuse(`the release's own ${scene} couldn't be expanded: ${errorText(err)}`, "swap");
    }
    if (!target) return refuse(`the release's own ${scene} isn't available`, "swap");

    const from = fromSide(rt, scene);
    const report = rt.swap(target.scene, {
      prefabs: target.prefabs,
      strategy: applyOpts.strategy === "reload" ? "reload" : "auto",
    });
    settle(rt);
    if (!report.ok) return failed(scene, version, report.issue);

    const swap: SceneSwap = {
      scene,
      from,
      to: {
        version,
        sceneHash: target.sceneHash,
        runHash: hashRun(rt, target.scene, target.prefabs),
      },
      strategy: report.strategy,
      carried: report.carried,
      diff: report.diff,
      timing: applyOpts.timing,
      tick: applyOpts.tick ?? rt.ctx.tick,
    };
    const before = new Set(rt.ctx.query.select({ enabled: false }));
    try {
      rt.game?.onSwap?.(swap);
    } catch (err) {
      for (const id of rt.ctx.query.select({ enabled: false })) {
        if (!before.has(id) && rt.ctx.exists(id)) rt.ctx.destroy(id);
      }
      let cause = errorText(err);
      try {
        report.undo();
      } catch (undoErr) {
        cause += `; ${errorText(undoErr)}`;
      }
      settle(rt);
      return refuse(cause, "onSwap");
    }
    running = { scene, version: prepared };
    emit("live:swapped", swap);
    for (const fn of [...listeners]) fn(swap);
    return { ok: true, swap };
  }

  return {
    stage(prepared) {
      staged.set(prepared.version.scene, prepared);
      return { ok: true };
    },
    activate(scene, version, timing) {
      const rt = sync();
      const game = clampTiming(live, timing);
      const out: LiveActivation = game.clamped
        ? {
            ...game,
            issue: liveIssue({
              code: "live-timing-unsupported",
              version: versionName(scene, version),
              accepted: live?.timings ?? [],
            }),
          }
        : { ...game };
      if (out.timing !== "next-load" && running?.scene !== scene && attached(scene)) {
        out.timing = "next-load";
        out.clamped = true;
      }
      const clamp = { timing: out.timing, clamped: out.clamped };
      if (pinned) return out;
      let prepared: PreparedVersion | null = null;
      if (version !== null) {
        const found = [staged.get(scene), active.get(scene)].find((p) => p?.id === version);
        if (!found)
          return {
            ...clamp,
            issue: stageIssue(scene, `${versionName(scene, version)} isn't staged`),
          };
        prepared = found;
      }
      if (staged.get(scene)?.id === version) staged.delete(scene);
      const before = active.get(scene) ?? null;
      setActive(scene, prepared);
      pending.delete(scene);
      const swaps = clamp.timing !== "next-load";
      if (swaps && running?.scene === scene && (running.version?.id ?? null) !== version) {
        pending.set(scene, { prepared, timing: clamp.timing });
      }
      activatedOff(rt, scene, prepared, before);
      return out;
    },
    current: (scene) => active.get(scene)?.id ?? null,
    pending: () =>
      [...pending.keys()].sort(byCodeUnit).map((scene) => {
        const p = pending.get(scene)!;
        return { scene, version: p.prepared?.id ?? null, timing: p.timing };
      }),
    pin(versions) {
      const rt = sync();
      pinned = true;
      pending.clear();
      for (const [scene, version] of Object.entries(versions)) {
        const found = [staged.get(scene), active.get(scene)].find((p) => p?.id === version);
        if (!found) continue;
        if (staged.get(scene) === found) staged.delete(scene);
        const before = active.get(scene) ?? null;
        setActive(scene, found);
        activatedOff(rt, scene, found, before);
      }
    },
    unpin() {
      pinned = false;
    },
    dropPending(scene) {
      pending.delete(scene);
    },
    hooks: {
      version: () => {
        sync();
        return running?.version?.id ?? null;
      },
      boundary: () => {
        const rt = opts.runtime();
        if (rt && saveHostOf(rt.ctx)?.stepping()) marked = true;
      },
      sublevel(id) {
        sync();
        if (!moved.has(id)) return null;
        return active.get(id) ?? opts.release?.(id) ?? null;
      },
    },
    loadedDoc(sceneHash) {
      const rt = opts.runtime();
      if (!rt) return;
      seen = { runtime: rt, generation: generationOf(rt) };
      const scene = sceneIdOf(rt);
      const version = scene === null ? undefined : active.get(scene);
      running =
        rt.scene() === null || scene === null
          ? null
          : version?.version.sceneHash === sceneHash
            ? { scene, version }
            : { scene, version: null, sceneHash };
      pending.clear();
      moved.clear();
    },
    afterTick({ paused, changing }) {
      const boundary = marked;
      marked = false;
      if (paused || changing) return;
      const rt = sync();
      if (!rt) return;
      for (const scene of [...pending.keys()].sort(byCodeUnit)) {
        const p = pending.get(scene)!;
        if (p.timing === "boundary" && !boundary) continue;
        pending.delete(scene);
        if (running?.scene === scene) apply(scene, p.prepared, { timing: p.timing });
      }
    },
    apply,
    sceneFor: (id) => active.get(id) ?? null,
    liveSublevels() {
      const rt = sync();
      if (!rt) return [];
      return offScenes(rt).flatMap((scene) => {
        const version = active.get(scene);
        return version ? [offSwap(rt, scene, version, null)] : [];
      });
    },
    onApplied(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

/**
 * The version `id` a recording names, through the host's `versions`:
 * `scene-version-removed` (with the swap's `tick`) when the host has none,
 * or gives another.
 */
export function recordedVersion(
  versions: ((id: Sha256) => StagedVersion | null) | undefined,
  scene: AssetId,
  id: Sha256,
  tick?: number,
): { ok: true; staged: StagedVersion } | { ok: false; issue: SceneIssue } {
  const staged = versions?.(id) ?? null;
  if (staged?.id === id) return { ok: true, staged };
  const issue = liveIssue({
    code: "scene-version-removed",
    version: versionName(scene, id),
    ...(tick !== undefined ? { tick } : {}),
  });
  return { ok: false, issue };
}

export type SwapReplayOptions = {
  live: Pick<LiveLayer, "stage" | "activate" | "apply">;
  swaps: readonly RecordedSwap[];
  /** The scene playing now, which a swap back to the release's own applies to. */
  scene(): AssetId;
  /** A recorded version of `scene` read for play, or the issues that stop the replay; `at` is the swap's index. */
  resolve(
    id: Sha256,
    scene: AssetId,
    at: number,
    tick: number,
  ): { ok: true; prepared: PreparedVersion } | { ok: false; issues: SceneIssue[] };
  /** Called for each swap the replay can't make as recorded: from its tick on, the run is stale. */
  stale(tick: number, why: string): void;
};

/** Where a replay stopped: the swap's index, tick, scene and version, and why. */
export type SwapReplayStop = {
  at: number;
  tick: number;
  scene: AssetId;
  version: Sha256;
  issues: SceneIssue[];
};

const strategyWord = (s: SwapStrategy) => (s === "reload" ? "reloaded" : "reconciled");

/**
 * Replays a recording's swaps, the one way the shell and headless replays
 * do it: before each tick, every swap recorded for it goes through the live
 * layer with its recorded timing and strategy. A `next-load` swap only
 * stages and activates: a load that used it is in the recording already,
 * and a sublevel's next attach in the replay reads it (a swap that names
 * its `sublevel` moves that scene, back to the release's own when its
 * version is null). A swap whose tick
 * already passed, that doesn't apply, or that ran with another strategy or
 * run hash is stale; a version the host can't give stops the replay.
 */
export function createSwapReplay(opts: SwapReplayOptions): {
  before(tick: number): SwapReplayStop | null;
} {
  const { live, swaps } = opts;
  let next = 0;
  return {
    before(tick) {
      for (; next < swaps.length && swaps[next]!.tick <= tick; next++) {
        const at = next;
        const entry = swaps[at]!;
        if (entry.tick < tick) {
          opts.stale(
            entry.tick,
            `the run never stepped tick ${entry.tick}, where a swap was recorded`,
          );
          continue;
        }
        const named = entry.sublevel ?? opts.scene();
        let target: PreparedVersion | null = null;
        if (entry.version !== null) {
          const found = opts.resolve(entry.version, named, at, entry.tick);
          if (!found.ok) {
            next++;
            const { tick, version } = entry;
            return { at, tick, scene: named, version, issues: found.issues };
          }
          target = found.prepared;
        }
        const scene = target?.version.scene ?? named;
        if (entry.timing === "next-load") {
          if (target) live.stage(target);
          live.activate(scene, entry.version, "next-load");
          continue;
        }
        const applied = live.apply(scene, target, {
          timing: entry.timing,
          strategy: entry.strategy,
          tick: entry.tick,
        });
        if (!applied.ok) opts.stale(entry.tick, `the swap didn't apply: ${applied.issue.message}`);
        else if (applied.swap.strategy !== entry.strategy)
          opts.stale(
            entry.tick,
            `the swap ${strategyWord(applied.swap.strategy)} where the recorded run ${strategyWord(entry.strategy)}`,
          );
        else if (applied.swap.to.runHash !== entry.runHash)
          opts.stale(
            entry.tick,
            `what the run runs after the swap changed since it was recorded (run hash ${entry.runHash}, now ${applied.swap.to.runHash})`,
          );
      }
      return null;
    },
  };
}

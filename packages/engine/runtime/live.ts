import type { LibraryScene } from "../game/flow";
import {
  clampTiming,
  versionName,
  type SceneSwap,
  type SwapStrategy,
  type SwapTiming,
} from "../game/live";
import type { ResolvedTime } from "../game/time";
import type { GameDefinition, Registry } from "../game/types";
import { stableJson } from "../project/canonical";
import { byCodeUnit } from "../project/kinds/define";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { readSceneVersion, type SceneVersion } from "../project/scene-version";
import type { AssetId, Sha256 } from "../project/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { liveIssue } from "../scene/issues";
import { sceneHashWith } from "../scene/prefab";
import type { RecordedSwap } from "../scene/recording-schema";
import type { ExpandedScene, PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import type { GameEventMap, GameLive, StagedVersion } from "../types";
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

/**
 * A fetched version read for play (`readSceneVersion`, with the game's
 * registry) into the form the live layer keeps; the read's issues when it
 * doesn't read.
 */
export function preparedVersion(
  v: StagedVersion,
  registry: Registry,
  game: GameDefinition | null,
  engine?: Readonly<Record<string, unknown>>,
): { ok: true; prepared: PreparedVersion } | { ok: false; issues: SceneIssue[] } {
  const read = readSceneVersion(v.version, v.texts, registry, game, engine ? { engine } : {});
  if (!read.ok) return { ok: false, issues: read.issues };
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
 * one playing takes a version only at its next attach, so `boundary` and
 * `now` come back as `next-load`, clamped, with no issue.
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
  /** What the runtime's `ctx.live` reads. */
  readonly hooks: { version(): Sha256 | null; boundary(label?: string): void };
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
  /** Calls `fn` after each applied swap; returns the unsubscribe. */
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

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
  /** The main scene the runtime plays and its version, as of the load `seen` names. */
  let running: { scene: AssetId; version: PreparedVersion | null } | null = null;
  let seen: { runtime: SceneRuntimeHandle; generation: number } | null = null;

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
    return rt;
  }

  /** After a swap, which may have reloaded: its load is the one `running` already names. */
  function settle(rt: SceneRuntimeHandle): void {
    seen = { runtime: rt, generation: generationOf(rt) };
  }

  function setActive(scene: AssetId, prepared: PreparedVersion | null): void {
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

  /** The side a swap leaves: the running version's hashes, or the release's own. */
  function fromSide(rt: SceneRuntimeHandle, scene: AssetId): SceneSwap["from"] {
    const host = saveHostOf(rt.ctx);
    const main = host?.mainScene() ?? rt.scene()!;
    const library = host?.prefabs() ?? new Map();
    const version = running?.scene === scene ? running.version : null;
    const own = version ? null : opts.release?.(scene);
    const sceneHash = version
      ? version.version.sceneHash
      : own
        ? sceneHashWith(own.def, own.prefabs)
        : hashText(stableJson(main));
    return { version: version?.id ?? null, sceneHash, runHash: hashRun(rt, main, library) };
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
    setActive(scene, prepared);
    const refuse = (cause: string, phase: "swap" | "onSwap") =>
      failed(scene, version, liveIssue({ code: "live-swap-failed", scene, cause, phase }));
    const rt = sync();
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
      sync();
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
        if (!found) {
          const cause = `${versionName(scene, version)} isn't staged`;
          const issue = liveIssue({ code: "live-swap-failed", scene, cause, phase: "stage" });
          return { ...clamp, issue };
        }
        prepared = found;
      }
      if (staged.get(scene)?.id === version) staged.delete(scene);
      setActive(scene, prepared);
      pending.delete(scene);
      const swaps = clamp.timing !== "next-load";
      if (swaps && running?.scene === scene && (running.version?.id ?? null) !== version) {
        pending.set(scene, { prepared, timing: clamp.timing });
      }
      return out;
    },
    current: (scene) => active.get(scene)?.id ?? null,
    pending: () =>
      [...pending.keys()].sort(byCodeUnit).map((scene) => {
        const p = pending.get(scene)!;
        return { scene, version: p.prepared?.id ?? null, timing: p.timing };
      }),
    pin(versions) {
      pinned = true;
      pending.clear();
      for (const [scene, version] of Object.entries(versions)) {
        const found = [staged.get(scene), active.get(scene)].find((p) => p?.id === version);
        if (!found) continue;
        if (staged.get(scene) === found) staged.delete(scene);
        active.set(scene, found);
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
        marked = true;
      },
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
  /** A recorded version read for play, or the issues that stop the replay; `at` is the swap's index. */
  resolve(
    id: Sha256,
    scene: AssetId,
    at: number,
    tick: number,
  ): { ok: true; prepared: PreparedVersion } | { ok: false; issues: SceneIssue[] };
  /** Called for each swap the replay can't make as recorded: from its tick on, the run is stale. */
  stale(tick: number, why: string): void;
};

/** Where a replay stopped: the swap's index, tick and version, and why. */
export type SwapReplayStop = { at: number; tick: number; version: Sha256; issues: SceneIssue[] };

const strategyWord = (s: SwapStrategy) => (s === "reload" ? "reloaded" : "reconciled");

/**
 * Replays a recording's swaps, the one way the shell and headless replays
 * do it: before each tick, every swap recorded for it goes through the live
 * layer with its recorded timing and strategy. A `next-load` swap only
 * stages and activates, since the load that used it is in the recording
 * already. A swap whose tick already passed, that doesn't apply, or that
 * ran with another strategy or run hash is stale; a version the host can't
 * give stops the replay.
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
        const running = opts.scene();
        let target: PreparedVersion | null = null;
        if (entry.version !== null) {
          const found = opts.resolve(entry.version, running, at, entry.tick);
          if (!found.ok) {
            next++;
            return { at, tick: entry.tick, version: entry.version, issues: found.issues };
          }
          target = found.prepared;
        }
        const scene = target?.version.scene ?? running;
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

import { LIVE_DEFAULTS, type SwapTiming } from "../game/live";
import { sha256 } from "../project/hash";
import { byCodeUnit } from "../project/kinds/define";
import type { ReleaseManifest } from "../project/release";
import { checkSceneVersion, parseSceneVersion, type SceneVersion } from "../project/scene-version";
import type { AssetId, Sha256 } from "../project/types";
import { liveIssue, makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import type { GameEventMap, GameInstance } from "../types";
import { StandaloneBootError } from "./errors";
import type { LiveSceneEntry, LiveSnapshot, LiveStateMessage } from "./host-protocol";

export type LiveControllerOptions = {
  instance: GameInstance;
  manifest: ReleaseManifest;
  /** Fetches a file relative to release.json: the boot's own fetch. */
  fetchText(path: string): Promise<string>;
  report(state: LiveStateMessage): void;
  /**
   * Filled with the file each staged version's blobs load from, by hash: the
   * release's own path when it ships that hash, else `live/<sha256><ext>`.
   * The standalone loader's URL function reads it.
   */
  files?: Map<Sha256, string>;
};

/** The frame's side of live levels, for a host that announced `"live"`. */
export type LiveController = {
  /** Diffs against what is staged and active; stages what's new, activates what's ready. */
  update(live: LiveSnapshot): void;
  /** Resolves once `scene`'s preparation has finished, staged or refused; at once when none runs. */
  settled(scene: AssetId): Promise<void>;
  dispose(): void;
};

type Phase =
  /** Fetching, checking and staging. */
  | "staging"
  /** Staged, but the activation was ignored (the instance is pinned). */
  | "held"
  /** Activated; applies at its timing or the scene's next load. */
  | "activated"
  | "applied"
  | "refused";

type Track = {
  /** The version the snapshot points at; null: back to the release's own. */
  version: Sha256 | null;
  /** The pointer's timing, before the game's clamp. */
  timing: SwapTiming;
  phase: Phase;
  abort: AbortController | null;
  done: Promise<void>;
};

type Prepared = { ok: true } | { ok: false; issue: SceneIssue };

const LIVE_BLOB_FILE = /^live\/([0-9a-f]{64})(\.[a-z0-9]+)?$/;

/** Why a preparation stopped early: its deadline, a newer snapshot, or the controller's end. */
type StopReason = "deadline" | "superseded" | "disposed";

class Stopped extends Error {
  constructor(readonly reason: StopReason) {
    super(reason);
  }
}

const firstError = (issues: readonly SceneIssue[]): SceneIssue | undefined =>
  issues.find((i) => i.severity === "error");

/**
 * Follows the page's live snapshots: for each scene whose version differs
 * from what the frame runs, fetches `live/<version>.json` and checks that
 * it hashes to its id, parses and is compatible with the release; fetches
 * each doc it carries from the release's own `data/` when the release ships
 * that hash, else from `live/`, each hash-checked; stages it within one
 * `LIVE_DEFAULTS.preloadTimeoutMs` deadline for the whole preparation; and
 * activates it at its timing. Each step goes to `report`: `staging`,
 * `ready`, `waiting` (a boundary swap), `applied` (the swap, or the load
 * that used it) and `refused` or `failed` with the issue. A scene that
 * leaves the snapshot goes back to the release's own, at its pointer's
 * last timing, or at the next load when the version it ran had failed or
 * was removed. One preparation per scene runs at a time; a newer snapshot
 * cancels an older one.
 */
export function createLiveController(opts: LiveControllerOptions): LiveController {
  const { instance, manifest } = opts;
  const tracks = new Map<AssetId, Track>();
  /** Versions whose swap failed in this frame: leaving the snapshot after that is a block. */
  const failedVersions = new Set<Sha256>();
  let disposed = false;
  let last: { channel: LiveSnapshot["channel"]; rev: number } | null = null;

  /** The release's own file for each hash it ships, docs and blobs alike. */
  const shipped = new Map<Sha256, string>();
  for (const id of Object.keys(manifest.assets).sort(byCodeUnit)) {
    const asset = manifest.assets[id]!;
    if (!shipped.has(asset.sha256)) shipped.set(asset.sha256, asset.file);
  }

  const report = (state: LiveStateMessage) => {
    if (disposed) return;
    try {
      opts.report(state);
    } catch (error) {
      globalThis.reportError?.(error);
    }
  };

  function applied(
    scene: AssetId,
    t: Track,
    detail: Pick<LiveStateMessage, "timing" | "strategy" | "tick">,
  ) {
    t.phase = "applied";
    report({ scene, version: t.version, status: "applied", ...detail });
  }

  function activate(scene: AssetId, t: Track): void {
    const out = instance.live.activate(scene, t.version, t.timing);
    if (out.issue?.code === "live-swap-failed") {
      t.phase = "refused";
      report({ scene, version: t.version, status: "refused", issue: out.issue });
      return;
    }
    if (instance.live.current(scene) !== t.version) {
      t.phase = "held";
      return;
    }
    t.phase = "activated";
    report({
      scene,
      version: t.version,
      status: "ready",
      timing: out.timing,
      ...(out.issue ? { issue: out.issue } : {}),
    });
    const waiting = instance.live.pending().find((p) => p.scene === scene);
    if (waiting) {
      if (waiting.timing === "boundary")
        report({ scene, version: t.version, status: "waiting", timing: "boundary" });
      return;
    }
    // A swap timing with nothing pending on the scene playing means it already runs this version.
    if (out.timing !== "next-load" && instance.flow.current() === scene)
      applied(scene, t, { timing: out.timing });
  }

  /** Fetches and checks `entry`'s version and the docs it carries, then stages it. */
  async function prepare(entry: LiveSceneEntry, signal: AbortSignal): Promise<Prepared> {
    const { scene, version: id } = entry;
    const name = `${scene}@${entry.number}`;
    const refuse = (issue: SceneIssue): Prepared => ({ ok: false, issue });
    const guard = <T>(work: Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const stop = () => reject(new Stopped(signal.reason as StopReason));
        if (signal.aborted) return stop();
        signal.addEventListener("abort", stop, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
      });

    const text = await guard(opts.fetchText(`live/${id}.json`));
    const got = await guard(sha256(text));
    if (got !== id)
      return refuse(
        makeIssue("hash-mismatch", {
          message: `"live/${id}.json" hashes to ${got}, not the version id ${name} names; a stale cache served another file`,
          entityIds: [scene],
          expected: id,
          got,
        }),
      );
    const parsed = parseSceneVersion(text);
    if (!parsed.ok) {
      const issue = firstError(parsed.issues) ?? parsed.issues[0];
      return refuse(issue ?? stageIssue(scene, `${name} didn't parse`));
    }
    const version = parsed.version;
    if (version.scene !== scene)
      return refuse(
        makeIssue("schema", {
          message: `${name} points at a version of the scene ${version.scene}, not ${scene}`,
          path: "/scene",
          entityIds: [scene],
          expected: scene,
          got: version.scene,
        }),
      );
    const incompatible = firstError(
      checkSceneVersion(manifest, version, undefined, { names: { version: name } }),
    );
    if (incompatible) return refuse(incompatible);

    const blobs = blobFiles(version, name);
    if (!blobs.ok) return blobs;
    const texts = await guard(docTexts(version, name));
    if (!texts.ok) return texts;
    for (const [hash, file] of blobs.files) opts.files?.set(hash, file);
    return instance.live.stage({ id, version, texts: texts.texts }, { signal });
  }

  /** Where each blob the version carries loads from: the release's own file, or its `live/` one. */
  function blobFiles(
    version: SceneVersion,
    name: string,
  ): { ok: true; files: Map<Sha256, string> } | { ok: false; issue: SceneIssue } {
    const files = new Map<Sha256, string>();
    for (const id of Object.keys(version.assets).sort(byCodeUnit)) {
      const asset = version.assets[id]!;
      if (asset.storage !== "blob") continue;
      const own = shipped.get(asset.sha256);
      if (own !== undefined) {
        files.set(asset.sha256, own);
        continue;
      }
      if (LIVE_BLOB_FILE.exec(asset.file)?.[1] !== asset.sha256)
        return {
          ok: false,
          issue: makeIssue("schema", {
            message: `${name} names "${asset.file}" for ${id}, not a live/ file of its hash`,
            path: `/assets/${id}/file`,
            entityIds: [id],
            expected: `live/${asset.sha256}<ext>`,
            got: asset.file,
          }),
        };
      files.set(asset.sha256, asset.file);
    }
    return { ok: true, files };
  }

  /** Every doc the version carries, by hash: from the release's `data/` when it ships the hash, else `live/`. */
  async function docTexts(
    version: SceneVersion,
    name: string,
  ): Promise<{ ok: true; texts: Map<Sha256, string> } | { ok: false; issue: SceneIssue }> {
    const docs = new Map<Sha256, { id: AssetId; file: string }>();
    for (const id of Object.keys(version.assets).sort(byCodeUnit)) {
      const asset = version.assets[id]!;
      if (asset.storage !== "doc" || docs.has(asset.sha256)) continue;
      docs.set(asset.sha256, {
        id,
        file: shipped.get(asset.sha256) ?? `live/${asset.sha256}.json`,
      });
    }
    const read = await Promise.all(
      [...docs].map(async ([hash, { id, file }]) => {
        const text = await opts.fetchText(file);
        const got = await sha256(text);
        return { hash, id, file, text, got };
      }),
    );
    const texts = new Map<Sha256, string>();
    for (const { hash, id, file, text, got } of read) {
      if (got !== hash)
        return {
          ok: false,
          issue: makeIssue("hash-mismatch", {
            message: `"${file}" (${id}, carried by ${name}) hashes to ${got}, not ${hash}; a stale cache served another file`,
            entityIds: [id],
            expected: hash,
            got,
          }),
        };
      texts.set(hash, text);
    }
    return { ok: true, texts };
  }

  function stage(entry: LiveSceneEntry): void {
    const { scene } = entry;
    const abort = new AbortController();
    const t: Track = {
      version: entry.version,
      timing: entry.timing,
      phase: "staging",
      abort,
      done: Promise.resolve(),
    };
    tracks.set(scene, t);
    report({ scene, version: entry.version, status: "staging" });
    const timer = globalThis.setTimeout(
      () => abort.abort("deadline" satisfies StopReason),
      LIVE_DEFAULTS.preloadTimeoutMs,
    );
    const timedOut = () =>
      stageIssue(
        scene,
        `${scene}@${entry.number} didn't fetch, check and preload within ${LIVE_DEFAULTS.preloadTimeoutMs / 1000} s`,
      );
    t.done = prepare(entry, abort.signal)
      .catch((error: unknown): Prepared => {
        if (error instanceof Stopped) return { ok: false, issue: timedOut() };
        if (error instanceof StandaloneBootError && error.issues[0])
          return { ok: false, issue: error.issues[0] };
        return {
          ok: false,
          issue: stageIssue(scene, error instanceof Error ? error.message : String(error)),
        };
      })
      .then((result) => {
        globalThis.clearTimeout(timer);
        t.abort = null;
        if (disposed || tracks.get(scene) !== t) return;
        if (result.ok) return activate(scene, t);
        t.phase = "refused";
        const issue = abort.signal.reason === "deadline" ? timedOut() : result.issue;
        report({ scene, version: t.version, status: "refused", issue });
      });
  }

  function cancel(t: Track | undefined): void {
    t?.abort?.abort("superseded" satisfies StopReason);
  }

  function update(live: LiveSnapshot): void {
    if (disposed) return;
    if (last?.channel === live.channel && live.rev < last.rev) return;
    last = { channel: live.channel, rev: live.rev };
    const listed = new Set<AssetId>();
    const removed = new Set(live.removed);
    for (const entry of live.scenes) {
      listed.add(entry.scene);
      const t = tracks.get(entry.scene);
      if (t?.version === entry.version) {
        const retimed = t.timing !== entry.timing;
        t.timing = entry.timing;
        if (t.phase === "held" || (retimed && t.phase === "activated")) activate(entry.scene, t);
        continue;
      }
      cancel(t);
      stage(entry);
    }
    for (const [scene, t] of [...tracks]) {
      if (listed.has(scene) || t.version === null) continue;
      cancel(t);
      const runs = instance.live.current(scene) !== null;
      if (!runs && !instance.live.pending().some((p) => p.scene === scene)) {
        tracks.delete(scene);
        continue;
      }
      const blocked = removed.has(t.version) || failedVersions.has(t.version);
      const back: Track = {
        version: null,
        timing: blocked ? "next-load" : t.timing,
        phase: "activated",
        abort: null,
        done: Promise.resolve(),
      };
      tracks.set(scene, back);
      activate(scene, back);
    }
  }

  const onSwapped = (swap: GameEventMap["live:swapped"]) => {
    const t = tracks.get(swap.scene);
    if (t?.phase !== "activated" || t.version !== swap.to.version) return;
    applied(swap.scene, t, { timing: swap.timing, strategy: swap.strategy, tick: swap.tick });
  };
  const onFailed = ({ scene, version, issue }: GameEventMap["live:failed"]) => {
    if (version !== null) failedVersions.add(version);
    const t = tracks.get(scene);
    if (t?.phase !== "activated" || t.version !== version) return;
    report({ scene, version, status: "failed", issue });
  };
  const onLoad = ({ to }: GameEventMap["flow:change"]) => {
    const t = tracks.get(to);
    if (t?.phase !== "activated" || instance.live.current(to) !== t.version) return;
    applied(to, t, { timing: "next-load" });
  };
  instance.on("live:swapped", onSwapped);
  instance.on("live:failed", onFailed);
  instance.on("flow:change", onLoad);

  return {
    update,
    settled: (scene) => tracks.get(scene)?.done ?? Promise.resolve(),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of tracks.values()) t.abort?.abort("disposed" satisfies StopReason);
      tracks.clear();
      instance.off("live:swapped", onSwapped);
      instance.off("live:failed", onFailed);
      instance.off("flow:change", onLoad);
    },
  };
}

/** A preparation that stopped: `live-swap-failed` in the stage phase, the cause as its hint. */
function stageIssue(scene: AssetId, cause: string): SceneIssue {
  return liveIssue({ code: "live-swap-failed", scene, cause, phase: "stage" });
}

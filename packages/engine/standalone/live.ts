import {
  preloadDeadline,
  raceSignal,
  sceneVersionName,
  withinPreloadWords,
  type SwapTiming,
} from "../game/live";
import { byCodeUnit } from "../project/kinds/define";
import type { ReleaseAsset, ReleaseManifest } from "../project/release";
import { liveFiles } from "../project/release-assets";
import { checkSceneVersion, parseSceneVersion, type SceneVersion } from "../project/scene-version";
import type { AssetId, Sha256 } from "../project/types";
import { stageIssue } from "../runtime/live";
import type { SceneRuntimeHandle } from "../runtime/types";
import { errorText, firstError, leadIssue, makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import type { GameEventMap, GameInstance } from "../types";
import { fetchDocTexts, verifiedText } from "./data";
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

/** Why a preparation stopped early, besides its deadline: a newer snapshot, or the controller's end. */
type StopReason = "superseded" | "disposed";

/** A live file that doesn't hash to its pin: `about` names what it was, `pin` what it should have hashed to. */
const staleCache = (file: string, about: string, got: Sha256, pin: string) =>
  `"${file}"${about} hashes to ${got}, not ${pin}; a stale cache served another file`;

/**
 * Follows the page's live snapshots: for each scene whose version differs
 * from what the frame runs, fetches `live/<version>.json` and checks that
 * it hashes to its id, parses and is compatible with the release; fetches
 * each doc it carries from the release's own `data/` when the release ships
 * that hash, else from `live/`, each hash-checked; stages it within one
 * `LIVE_DEFAULTS.preloadTimeoutMs` deadline for the whole preparation; and
 * activates it at its timing. Each step goes to `report`: `staging`,
 * `ready`, `waiting` (a boundary swap), `applied` (the swap, or the load
 * or sublevel attach that used it) and `refused` or `failed` with the issue. A scene that
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
    const playing = instance.flow.current() === scene;
    // A swap timing with nothing pending on the scene playing means it already runs this version.
    if (out.timing !== "next-load" && playing) applied(scene, t, { timing: out.timing });
    // Off the main scene, a sublevel takes the version at its next attach: one attached now keeps what it runs.
    else if (!playing) attaches.set(scene, { track: t, before: new Set(labelsOf(scene)) });
  }

  /**
   * Activated versions of scenes not playing, waiting for their next attach
   * as a sublevel; `before` holds the labels the scene was attached under at
   * activation, still running what they attached with, until each is
   * detached or a load clears them.
   */
  const attaches = new Map<AssetId, { track: Track; before: Set<string> }>();

  /** The labels `scene` is attached under as a sublevel of the running scene. */
  function labelsOf(scene: AssetId): string[] {
    const rt = instance.runtime() as SceneRuntimeHandle | null;
    return (rt?.ctx.flow.sublevels() ?? []).filter((s) => s.scene === scene).map((s) => s.label);
  }

  /** Fetches and checks `entry`'s version (`name`) and the docs it carries, then stages it. */
  async function prepare(
    entry: LiveSceneEntry,
    name: string,
    signal: AbortSignal,
  ): Promise<Prepared> {
    const { scene, version: id } = entry;
    const refuse = (issue: SceneIssue): Prepared => ({ ok: false, issue });
    const guard = <T>(work: Promise<T>): Promise<T> => raceSignal(work, signal);

    // A mismatch throws, and the staging reports its issue.
    const file = liveFiles.doc(id);
    const text = await guard(
      opts
        .fetchText(file)
        .then((fetched) =>
          verifiedText(fetched, id, scene, (got) =>
            staleCache(file, "", got, `the version id ${name} names`),
          ),
        ),
    );
    const parsed = parseSceneVersion(text);
    if (!parsed.ok) {
      return refuse(leadIssue(parsed.issues) ?? stageIssue(scene, `${name} didn't parse`));
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

    const texts = await guard(docTexts(version, name));
    for (const asset of Object.values(version.assets))
      if (asset.storage === "blob") opts.files?.set(asset.sha256, fileOf(asset));
    return instance.live.stage({ id, version, texts }, { signal });
  }

  /** Where a carried asset loads from: the release's own file when it ships the hash, else the version's `live/` one. */
  const fileOf = (asset: ReleaseAsset): string => shipped.get(asset.sha256) ?? asset.file;

  /** Every doc the version carries, by hash, each hash-checked. */
  async function docTexts(version: SceneVersion, name: string): Promise<Map<Sha256, string>> {
    const byId = await fetchDocTexts(version.assets, (file) => opts.fetchText(file), {
      file: fileOf,
      mismatch: (file, id, got, pin) => staleCache(file, ` (${id}, carried by ${name})`, got, pin),
    });
    const texts = new Map<Sha256, string>();
    for (const [id, text] of byId) texts.set(version.assets[id]!.sha256, text);
    return texts;
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
    const deadline = preloadDeadline(abort.signal);
    const name = sceneVersionName(scene, entry.number);
    const timedOut = () =>
      stageIssue(scene, `${name} didn't fetch, check and preload ${withinPreloadWords()}`);
    t.done = prepare(entry, name, deadline.signal)
      .catch((error: unknown): Prepared => {
        if (deadline.signal.aborted) return { ok: false, issue: timedOut() };
        if (error instanceof StandaloneBootError && error.issues[0])
          return { ok: false, issue: error.issues[0] };
        return { ok: false, issue: stageIssue(scene, errorText(error)) };
      })
      .then((result) => {
        deadline.clear();
        t.abort = null;
        if (disposed || tracks.get(scene) !== t) return;
        if (result.ok) return activate(scene, t);
        t.phase = "refused";
        const issue = deadline.timedOut() ? timedOut() : result.issue;
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
    const blockedNow = new Set([...live.removed, ...(live.blocked ?? [])]);
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
      const blocked = blockedNow.has(t.version) || failedVersions.has(t.version);
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
    attaches.delete(to);
    for (const w of attaches.values()) w.before.clear();
    const t = tracks.get(to);
    if (t?.phase !== "activated" || instance.live.current(to) !== t.version) return;
    applied(to, t, { timing: "next-load" });
  };
  /** After each step: a waiting sublevel attached under a label it didn't hold at activation runs its active version. */
  const onStep = () => {
    for (const [scene, w] of attaches) {
      const t = w.track;
      if (tracks.get(scene) !== t || t.phase !== "activated") {
        attaches.delete(scene);
        continue;
      }
      const labels = labelsOf(scene);
      for (const label of w.before) if (!labels.includes(label)) w.before.delete(label);
      if (labels.every((label) => w.before.has(label))) continue;
      attaches.delete(scene);
      if (instance.live.current(scene) === t.version) applied(scene, t, { timing: "next-load" });
    }
  };
  instance.on("live:swapped", onSwapped);
  instance.on("live:failed", onFailed);
  instance.on("flow:change", onLoad);
  instance.on("scene:step", onStep);

  /** Waits for `scene`'s preparation, and for each newer one a snapshot started meanwhile. */
  async function settled(scene: AssetId): Promise<void> {
    for (let t = tracks.get(scene); t; ) {
      await t.done;
      const next = tracks.get(scene);
      if (next === t) return;
      t = next;
    }
  }

  return {
    update,
    settled,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of tracks.values()) t.abort?.abort("disposed" satisfies StopReason);
      tracks.clear();
      instance.off("live:swapped", onSwapped);
      instance.off("live:failed", onFailed);
      instance.off("flow:change", onLoad);
      instance.off("scene:step", onStep);
      attaches.clear();
    },
  };
}

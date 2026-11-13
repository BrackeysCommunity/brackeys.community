import type { SwapTiming } from "@jams/engine/game";
import type { AssetId, Sha256 } from "@jams/engine/project";
import type { LiveSnapshot, LiveStateMessage } from "@jams/engine/standalone";

import type { HostServer } from "./host-server";
import { LIVE_CRASH_WINDOW_SECONDS, LIVE_POLL_SECONDS } from "./limits";
import { engineLiveStreamPath } from "./route-paths";

type LiveChannel = "preview" | "production";

/** What the frame did with a version, as the page reports it. */
export type LiveOutcome = "applied" | "refused" | "failed" | "crashed";

/** The two procedures the loop calls; the site's oRPC client unless a test stands in. */
export type LiveProcedures = {
  live(input: { projectId: string; channel: LiveChannel }): Promise<LiveSnapshot | null>;
  report(input: {
    projectId: string;
    versionId: Sha256;
    channel: LiveChannel;
    outcome: LiveOutcome;
    issueCode?: string;
  }): Promise<unknown>;
};

/** A swap the player saw happen: `boundary` or `now`, applied in the running frame. */
export type AppliedSwap = { scene: AssetId; version: Sha256 | null; timing: SwapTiming };

/** The frame's lifecycle state, as the host server's `onState` hands it on. */
export type FrameState = { jamsState: string };

export type LiveClient = {
  /** Takes each state the frame reports, so an error soon after a swap is reported as `crashed`. */
  frameState(state: FrameState): void;
  dispose(): void;
};

export type LiveClientOptions = {
  projectId: string;
  channel: LiveChannel;
  /** The play payload's live state; its release is the one the frame runs. */
  initial: LiveSnapshot;
  host: Pick<HostServer, "sendLive" | "onLiveState">;
  /** The channel's release moved: the page offers a reload. */
  onReleaseMoved(): void;
  /** A version the frame runs was hidden: the page reloads the frame with the notice. */
  onRemoved(): void;
  /** A `boundary` or `now` swap was applied: the page tells the player, briefly. */
  onSwapApplied?(swap: AppliedSwap): void;
  procedures?: LiveProcedures;
};

const ISSUE_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OUTCOMES: Partial<Record<LiveStateMessage["status"], LiveOutcome>> = {
  applied: "applied",
  refused: "refused",
  failed: "failed",
};

const siteProcedures: LiveProcedures = {
  async live(input) {
    const { client } = await import("@/orpc/client");
    return client.getGameLive(input);
  },
  async report(input) {
    const { client } = await import("@/orpc/client");
    return client.reportLiveState(input);
  },
};

/** What the frame acts on: the release, each scene's version and timing, and what was removed. */
const contentOf = (s: LiveSnapshot) =>
  JSON.stringify([s.release, s.scenes.map((e) => [e.scene, e.version, e.timing]), s.removed]);

/**
 * The play page's side of live levels. It follows the channel's stream and
 * reads the live state once per new rev, or polls while the page is visible
 * when there is no working stream. A new release is offered as a reload and
 * never sent; any other change goes to the frame. What the frame reports is
 * forwarded once per version, applied `boundary` and `now` swaps are
 * surfaced, and a hidden version the frame runs reloads it. A frame that
 * errors within the crash window after applying a version reports that
 * version as `crashed`.
 */
export function createLiveClient(opts: LiveClientOptions): LiveClient {
  const { projectId, channel, host, initial } = opts;
  const procedures = opts.procedures ?? siteProcedures;
  const frameRelease = initial.release;

  /** The highest rev asked for or received; an event at or below it asks nothing. */
  let knownRev = initial.rev;
  /** The highest rev whose snapshot was acted on. */
  let appliedRev = initial.rev;
  let lastSent = contentOf(initial);
  let movedTo: Sha256 | null = null;
  let disposed = false;

  /** Per scene, the version the frame runs (null: the release's own) and the one it is preparing. */
  const running = new Map<AssetId, Sha256 | null>(initial.scenes.map((e) => [e.scene, e.version]));
  const preparing = new Map<AssetId, Sha256>();
  const timings = new Map<string, SwapTiming>(
    initial.scenes.map((e) => [`${e.scene}@${e.version}`, e.timing]),
  );
  const reported = new Set<Sha256>();
  /** When each version was applied in the running frame. */
  const appliedAt = new Map<Sha256, number>();
  const crashed = new Set<Sha256>();
  let frameErrored = false;
  const removedSeen = new Set<Sha256>();

  const frameRuns = (version: Sha256) =>
    [...running.values()].includes(version) || [...preparing.values()].includes(version);

  function take(snapshot: LiveSnapshot | null): void {
    if (disposed || !snapshot || snapshot.channel !== channel) return;
    if (snapshot.rev < appliedRev) return;
    appliedRev = snapshot.rev;
    knownRev = Math.max(knownRev, snapshot.rev);

    if (snapshot.release !== frameRelease) {
      if (movedTo !== snapshot.release) {
        movedTo = snapshot.release;
        opts.onReleaseMoved();
      }
      return;
    }
    movedTo = null;
    for (const e of snapshot.scenes) timings.set(`${e.scene}@${e.version}`, e.timing);

    const hidden = snapshot.removed.filter((v) => frameRuns(v) && !removedSeen.has(v));
    const content = contentOf(snapshot);
    if (content !== lastSent) {
      lastSent = content;
      host.sendLive(snapshot);
    }
    if (hidden.length > 0) {
      for (const v of hidden) removedSeen.add(v);
      running.clear();
      preparing.clear();
      for (const e of snapshot.scenes) running.set(e.scene, e.version);
      opts.onRemoved();
    }
  }

  async function fetchState(): Promise<void> {
    if (disposed) return;
    let snapshot: LiveSnapshot | null;
    try {
      snapshot = await procedures.live({ projectId, channel });
    } catch {
      knownRev = appliedRev;
      return;
    }
    take(snapshot);
  }

  function onLiveState(state: LiveStateMessage): void {
    if (disposed) return;
    const { scene, version, status } = state;
    if (status === "staging" || status === "ready" || status === "waiting") {
      if (version !== null) preparing.set(scene, version);
    } else {
      if (preparing.get(scene) === version) preparing.delete(scene);
      if (status === "applied") {
        if (version !== null) appliedAt.set(version, Date.now());
        const before = running.get(scene);
        running.set(scene, version);
        const timing = state.timing ?? timings.get(`${scene}@${version}`);
        if (before !== version && (timing === "boundary" || timing === "now"))
          opts.onSwapApplied?.({ scene, version, timing });
      }
    }

    const outcome = OUTCOMES[status];
    if (!outcome || version === null || reported.has(version)) return;
    reported.add(version);
    report(version, outcome, state.issue?.code);
  }

  function report(version: Sha256, outcome: LiveOutcome, code?: string): void {
    void procedures
      .report({
        projectId,
        versionId: version,
        channel,
        outcome,
        ...(code && ISSUE_CODE.test(code) ? { issueCode: code } : {}),
      })
      .catch(() => {
        // A report that doesn't arrive changes nothing the player sees.
      });
  }

  function frameState({ jamsState }: FrameState): void {
    const becameError = jamsState === "error" && !frameErrored;
    frameErrored = jamsState === "error";
    if (disposed || !becameError) return;
    const now = Date.now();
    for (const [version, at] of appliedAt) {
      if (crashed.has(version) || now - at > LIVE_CRASH_WINDOW_SECONDS * 1_000) continue;
      crashed.add(version);
      report(version, "crashed");
    }
  }

  const stopStates = host.onLiveState(onLiveState);

  let timer: ReturnType<typeof setInterval> | null = null;
  const onVisibility = () => {
    if (document.visibilityState === "visible") void fetchState();
  };
  function startPolling(): void {
    if (disposed || timer !== null) return;
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void fetchState();
    }, LIVE_POLL_SECONDS * 1_000);
    document.addEventListener("visibilitychange", onVisibility);
  }

  let source: EventSource | null = null;
  if (typeof EventSource === "undefined") startPolling();
  else {
    source = new EventSource(engineLiveStreamPath(projectId, channel));
    let interrupted = false;
    source.addEventListener("live", (message) => {
      let rev: unknown;
      try {
        ({ rev } = JSON.parse((message as MessageEvent<string>).data) as { rev?: unknown });
      } catch {
        return;
      }
      if (typeof rev !== "number" || rev <= knownRev) return;
      knownRev = rev;
      void fetchState();
    });
    // A reconnect may have missed moves, so it reads the state once.
    source.addEventListener("open", () => {
      if (interrupted) void fetchState();
      interrupted = false;
    });
    source.addEventListener("error", () => {
      interrupted = true;
      if (source?.readyState !== EventSource.CLOSED) return;
      source.close();
      source = null;
      startPolling();
      void fetchState();
    });
  }

  return {
    frameState,
    dispose() {
      if (disposed) return;
      disposed = true;
      source?.close();
      source = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
      stopStates();
    },
  };
}

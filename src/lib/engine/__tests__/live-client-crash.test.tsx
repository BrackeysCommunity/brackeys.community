// @vitest-environment jsdom
import type { LiveSnapshot, LiveStateMessage } from "@jams/engine/standalone";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LIVE_CRASH_WINDOW_SECONDS } from "../limits";
import { createLiveClient, type LiveClient, type LiveProcedures } from "../live-client";

const PROJECT = "project-1";
const RELEASE = "a".repeat(64);
const V1 = "1".repeat(64);
const V2 = "2".repeat(64);

const snapshot = (): LiveSnapshot => ({
  channel: "production",
  rev: 1,
  release: RELEASE,
  scenes: [],
  removed: [],
});

const applied = (scene: string, version: string): LiveStateMessage => ({
  scene,
  version,
  status: "applied",
  timing: "now",
});

let states: Array<(s: LiveStateMessage) => void> = [];
let report: ReturnType<typeof vi.fn<LiveProcedures["report"]>>;
let live: LiveClient;

const frame = (s: LiveStateMessage) => {
  for (const fn of states) fn(s);
};

const crashes = () =>
  report.mock.calls.filter(([input]) => input.outcome === "crashed").map(([input]) => input);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", undefined);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  states = [];
  report = vi.fn<LiveProcedures["report"]>(() => Promise.resolve(null));
  live = createLiveClient({
    projectId: PROJECT,
    channel: "production",
    initial: snapshot(),
    host: {
      sendLive: () => true,
      onLiveState: (fn) => {
        states.push(fn);
        return () => void (states = states.filter((f) => f !== fn));
      },
    },
    onReleaseMoved: () => {},
    onRemoved: () => {},
    procedures: { live: () => Promise.resolve(null), report },
  });
});

afterEach(() => {
  live.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("crash detection", () => {
  it("reports crashed for a version when the frame errors 9 s after applying it", () => {
    live.frameState({ jamsState: "ready" });
    frame(applied("level-1", V1));
    vi.advanceTimersByTime(9_000);
    live.frameState({ jamsState: "error" });

    expect(crashes()).toEqual([
      { projectId: PROJECT, versionId: V1, channel: "production", outcome: "crashed" },
    ]);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: V1, outcome: "applied" }),
    );
  });

  it("reports nothing for an error 11 s after the swap", () => {
    expect(LIVE_CRASH_WINDOW_SECONDS).toBe(10);
    live.frameState({ jamsState: "ready" });
    frame(applied("level-1", V1));
    vi.advanceTimersByTime(11_000);
    live.frameState({ jamsState: "error" });

    expect(crashes()).toEqual([]);
  });

  it("reports a crash once per version", () => {
    frame(applied("level-1", V1));
    vi.advanceTimersByTime(2_000);
    live.frameState({ jamsState: "error" });
    live.frameState({ jamsState: "error" });
    live.frameState({ jamsState: "loading" });
    live.frameState({ jamsState: "ready" });
    frame(applied("level-1", V1));
    live.frameState({ jamsState: "error" });

    expect(crashes()).toHaveLength(1);
  });

  it("reports nothing for an error with no applied swap", () => {
    frame({ scene: "level-1", version: V1, status: "staging" });
    frame({ scene: "level-1", version: V1, status: "failed" });
    frame({ scene: "level-2", version: null, status: "applied", timing: "now" });
    live.frameState({ jamsState: "error" });

    expect(crashes()).toEqual([]);
  });

  it("reports every version applied within the window, and none once disposed", () => {
    frame(applied("level-1", V1));
    vi.advanceTimersByTime(5_000);
    frame(applied("level-2", V2));
    vi.advanceTimersByTime(6_000);
    live.frameState({ jamsState: "error" });
    expect(crashes().map((c) => c.versionId)).toEqual([V2]);

    live.frameState({ jamsState: "ready" });
    frame(applied("level-1", V1));
    live.dispose();
    live.frameState({ jamsState: "error" });
    expect(crashes()).toHaveLength(1);
  });
});

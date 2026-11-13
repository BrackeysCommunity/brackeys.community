// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { clampTiming, LIVE_DEFAULTS, type LiveDeclaration } from "../game/live";
import { createLiveLayer } from "../runtime/live";
import { createRunRecorder } from "../runtime/recorder";
import { createSceneRuntime } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import { parseRecording, type RunRecording } from "../scene/recording-schema";
import type { SceneDefinition } from "../scene/types";
import {
  frameMessageSchema,
  HOST_REQUESTS,
  hostMessageSchema,
  welcomeSchema,
  type LiveSnapshot,
} from "../standalone/host-protocol";
import { testGame } from "./fixtures/test-game";

const declared = (...timings: LiveDeclaration["timings"]): LiveDeclaration => ({ timings });

const SHA = "a".repeat(64);

const DEF: SceneDefinition = {
  v: 4,
  name: "t",
  bounds: [0, 0, 10, 10],
  settings: { physics: "none" },
  entities: [{ id: "start", type: "marker", at: [1, 1] }],
};

describe("clampTiming", () => {
  it("always allows next-load", () => {
    expect(clampTiming(undefined, "next-load")).toEqual({ timing: "next-load", clamped: false });
    expect(clampTiming(declared(), "next-load")).toEqual({ timing: "next-load", clamped: false });
  });

  it("keeps a listed timing", () => {
    expect(clampTiming(declared("now"), "now")).toEqual({ timing: "now", clamped: false });
    expect(clampTiming(declared("boundary"), "boundary")).toEqual({
      timing: "boundary",
      clamped: false,
    });
  });

  it("drops an unlisted timing to the strongest listed one below it", () => {
    expect(clampTiming(undefined, "now")).toEqual({ timing: "next-load", clamped: true });
    expect(clampTiming(declared("boundary"), "now")).toEqual({
      timing: "boundary",
      clamped: true,
    });
    expect(clampTiming(declared("now"), "boundary")).toEqual({
      timing: "next-load",
      clamped: true,
    });
  });

  it("states the live defaults", () => {
    expect(LIVE_DEFAULTS).toEqual({
      preloadTimeoutMs: 60_000,
      livePlayDebounceMs: 300,
      checkAt: [0.25, 0.5, 0.75],
      checkTicks: 120,
    });
    expect(Object.isFrozen(LIVE_DEFAULTS)).toBe(true);
  });
});

describe("the live contract", () => {
  it("gives ctx.live no version and a boundary that does nothing", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
    expect(rt.load(expandScene(DEF, rt.ctx.registry)).ok).toBe(true);
    expect(rt.ctx.live.version).toBeNull();
    expect(() => rt.ctx.live.boundary("checkpoint")).not.toThrow();
    rt.destroy();
  });

  it("reads ctx.live through the runtime's live option", () => {
    const marks: (string | undefined)[] = [];
    const rt = createSceneRuntime({
      rapier: null,
      view: null,
      live: { version: () => SHA, boundary: (label) => void marks.push(label) },
    });
    rt.ctx.live.boundary("turn");
    expect(rt.ctx.live.version).toBe(SHA);
    expect(marks).toEqual(["turn"]);
    rt.destroy();
  });

  it("reloads on a header change, carrying progress for a game with no restore", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
    const scene = expandScene(DEF, rt.ctx.registry);
    expect(rt.load(scene).ok).toBe(true);
    const wider = {
      ...scene,
      bounds: [0, 0, scene.bounds[2] + 1, scene.bounds[3]] as typeof scene.bounds,
    };
    const report = rt.swap(wider, { prefabs: new Map() });
    expect(report).toMatchObject({ ok: true, strategy: "reload", carried: "progress" });
    expect(rt.ctx.bounds).toEqual(wider.bounds);
    expect(rt.get("start")).toBeDefined();
    rt.destroy();
  });

  it("builds a live layer whose activate clamps", () => {
    const layer = createLiveLayer({ game: testGame, runtime: () => null });
    expect(layer.activate("level-1", SHA, "now")).toMatchObject({
      timing: "next-load",
      clamped: true,
      issue: { code: "live-swap-failed" },
    });
    expect(layer.current("level-1")).toBeNull();
    expect(layer.pending()).toEqual([]);
    expect(layer.sceneFor("level-1")).toBeNull();
    expect(layer.hooks.version()).toBeNull();
    layer.pin({ "level-1": SHA });
    layer.unpin();
    layer.afterTick({ paused: false, changing: false });
    layer.onApplied(() => {})();
  });
});

describe("recordings and live versions", () => {
  const recorder = (sceneVersion?: string | null) =>
    createRunRecorder({
      rapier: null,
      game: testGame,
      registry: createRegistry(testGame),
      scene: "t",
      sceneHash: "h" as RunRecording["sceneHash"],
      runHash: "r",
      start: {},
      ...(sceneVersion !== undefined ? { sceneVersion } : {}),
    });
  const end = { result: "quit", tick: 0, ticks: 1 } as const;

  it("writes neither key for a run with no live version and no swap", () => {
    for (const rec of [recorder().finish(end, null), recorder(null).finish(end, null)]) {
      expect(rec).not.toHaveProperty("sceneVersion");
      expect(rec).not.toHaveProperty("swaps");
    }
  });

  it("writes the version a segment started on", () => {
    const rec = recorder(SHA).finish(end, null);
    expect(rec.sceneVersion).toBe(SHA);
    expect(parseRecording(JSON.parse(JSON.stringify(rec))).ok).toBe(true);
  });

  it("parses swaps and refuses a swap with an unknown key", () => {
    const rec = recorder().finish(end, null);
    const swap = {
      tick: 3,
      version: null,
      strategy: "reconcile",
      timing: "now",
      sceneHash: "h",
      runHash: "r2",
    };
    expect(parseRecording({ ...rec, swaps: [swap] }).ok).toBe(true);
    expect(parseRecording({ ...rec, swaps: [{ ...swap, extra: 1 }] }).ok).toBe(false);
  });
});

describe("the host channel's live messages", () => {
  const snapshot: LiveSnapshot = {
    channel: "production",
    rev: 4,
    release: SHA,
    scenes: [
      { scene: "level-1", version: SHA, number: 4, timing: "boundary", since: "2026-11-13T00:00Z" },
    ],
    removed: [],
  };

  it("takes features in hello only when it lists one", () => {
    const hello = { engine: "0.14.4", release: SHA, game: "g" };
    expect(HOST_REQUESTS.hello.params.safeParse(hello).success).toBe(true);
    expect(HOST_REQUESTS.hello.params.safeParse({ ...hello, features: ["live"] }).success).toBe(
      true,
    );
    expect(HOST_REQUESTS.hello.params.safeParse({ ...hello, features: [] }).success).toBe(false);
  });

  it("carries the snapshot in welcome and live.update, and the frame's live.state", () => {
    const welcome = {
      player: { signedIn: false, name: null },
      saves: { describe: "", limits: { maxBytes: 0, maxSlots: 0 }, mode: "none" },
      prefs: { remap: null, prefs: null },
      online: false,
    };
    expect(welcomeSchema.parse(welcome)).not.toHaveProperty("live");
    expect(welcomeSchema.parse({ ...welcome, live: snapshot }).live).toEqual(snapshot);
    expect(hostMessageSchema.safeParse({ type: "live.update", live: snapshot }).success).toBe(true);
    const state = { type: "live.state", scene: "level-1", version: SHA, status: "applied" };
    expect(frameMessageSchema.safeParse(state).success).toBe(true);
    expect(frameMessageSchema.safeParse({ ...state, status: "done" }).success).toBe(false);
  });
});

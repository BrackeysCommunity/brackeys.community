// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  clickTimes,
  latencyFromTaps,
  MUSIC_DRIFT_LIMIT_MS,
  musicDriftMs,
  wrapClipMs,
} from "../audio/clock";
import { fakeAudioBackend, type FakeAudioBackend } from "../audio/fake";
import { synthDurationMs, SYNTH_SAMPLE_RATE } from "../audio/synth";
import { CLICK_PATCH } from "../audio/synth-presets";
import { createAudioSystem, type AudioSystemHandle } from "../audio/system";
import { createGame } from "../engine";
import { LATENCY_COMMAND } from "../game/commands";
import { createRegistry, defineGame } from "../game/define";
import type { EngineContext, GameDefinition } from "../game/types";
import { replayRecording } from "../headless/recording";
import { createInputState } from "../input/state";
import { memoryPrefsStore } from "../prefs";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AudioRequest } from "../runtime/present";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { SCENE_FORMAT_VERSION, type ExpandedScene, type SceneDefinition } from "../scene/types";
import type { ToolEvent } from "../tool-router";
import type { GameConfig, GameInstance } from "../types";
import { manualFrames, type FrameClock } from "./fixtures/frame-clock";

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

const SONG_PATCH = { kind: "synth", v: 1, wave: "sine", freq: 220, sustainMs: 2000, decayMs: 0 };
const SONG_MS = 2000;

const project: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  doc: <T>(kind: string, id: string): T | undefined => {
    if (kind === "sound" && id === "song")
      return {
        kind: "sound",
        v: 1,
        bus: "music",
        loop: true,
        variants: [{ clip: "song-patch" }],
      } as T;
    if (kind === "sound" && id === "tick")
      return { kind: "sound", v: 1, bus: "sfx", variants: [{ clip: "click-patch" }] } as T;
    if (kind === "synth" && id === "song-patch") return SONG_PATCH as T;
    if (kind === "synth" && id === "click-patch")
      return { kind: "synth", v: 1, wave: "square", freq: 800, sustainMs: 10, decayMs: 10 } as T;
    return undefined;
  },
  docs: (kind) =>
    kind === "sound" ? ["song", "tick"] : kind === "synth" ? ["song-patch", "click-patch"] : [],
};

/** Starts the song on its tick at tick 3 and keeps the latency it reads. */
const metronome: GameDefinition<{ n: number; latency: number }> = defineGame({
  id: "metronome",
  types: [],
  actions: [
    {
      action: "tap",
      ui: true,
      description: "Taps along to a click.",
      bindings: [{ device: "key", code: "Enter" }],
    },
  ],
  world: { physics: "none" },
  time: { kind: "fixed", rate: 60 },
  createRuntime(ctx: EngineContext) {
    let n = 0;
    let latency = 0;
    return {
      afterStep() {
        if (ctx.tick === 3) ctx.present.audio.music("song", { at: "tick" });
        n += ctx.tick;
        latency = ctx.input.latencyMs();
      },
      snapshot: () => ({ n, latency }),
      restore: (state) => {
        n = state.n;
        latency = state.latency;
      },
    };
  },
});
const registry = createRegistry(metronome as GameDefinition);

const doc: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "metronome",
  name: "metronome",
  bounds: [0, 0, 40, 20],
  settings: { physics: "none" },
  entities: [{ id: "post", type: "marker", at: [5, 5] }],
};
const expanded: ExpandedScene = {
  name: "metronome",
  game: "metronome",
  bounds: [0, 0, 40, 20],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities: doc.entities as ExpandedScene["entities"],
};

const VIEW = { centre: { x: 0, y: 0 }, halfWidth: 10 };

function audioSystem(backend: FakeAudioBackend, latencyMs?: () => number): AudioSystemHandle {
  return createAudioSystem({
    backend,
    project,
    registry,
    fetchClip: () => Promise.reject(new Error("no clips")),
    clipUrl: () => "about:blank",
    poses: { get: () => undefined },
    prefs: memoryPrefsStore(),
    gameId: "metronome",
    tickMs: 1000 / 60,
    reducedMotion: () => false,
    emit: () => {},
    ...(latencyMs ? { latencyMs } : {}),
  });
}

/**
 * Steps the scene `ticks` times, each tick's audio requests to `system`
 * when given, the context clock running `speed` times the simulation's,
 * and a frame after each tick. Returns the snapshots it stepped through.
 */
function run(ticks: number, system?: AudioSystemHandle, backend?: FakeAudioBackend, speed = 1) {
  const rt = createSceneRuntime({
    rapier: null,
    view: null,
    game: metronome as GameDefinition,
    project,
    recordPresentation: true,
  });
  expect(rt.load(expanded).ok).toBe(true);
  const tickMs = rt.ctx.time.tickMs;
  const states: unknown[] = [];
  for (let i = 0; i < ticks; i++) {
    const result = rt.step(tickMs, []);
    states.push([result.tick, result.game]);
    const audio = (result.present ?? []).flatMap((r) => (r.kind === "audio" ? [r.op] : []));
    system?.tick(result.tick, result.events, audio);
    backend?.advance((tickMs * speed) / 1000);
    system?.frame(VIEW, rt.ctx.tick * tickMs);
  }
  rt.destroy();
  return states;
}

describe("the clock's arithmetic", () => {
  it("wraps a looping clip's position into its loop, and measures drift the short way round", () => {
    const span = { durationMs: 1000, loop: true, loopStartMs: 200, loopEndMs: 800 };
    expect(wrapClipMs(500, span)).toBe(500);
    expect(wrapClipMs(900, span)).toBe(300);
    expect(wrapClipMs(900, { durationMs: 1000, loop: false })).toBe(900);
    expect(musicDriftMs(210, 790, span)).toBeCloseTo(20);
    expect(musicDriftMs(1300, 1250, { durationMs: 2000, loop: false })).toBe(50);
  });

  it("times taps against their nearest click within half a beat, keeping the nearer of two", () => {
    const clicks = clickTimes(0, 10, 120);
    expect(clicks[0]).toBeCloseTo(0.5);
    expect(clicks[9]).toBeCloseTo(5);
    const taps = clicks.map((c) => c + 0.03);
    taps.push(clicks[2]! + 0.2, 9);
    expect(latencyFromTaps(clicks, taps, 120)).toEqual({
      ms: expect.closeTo(30, 6),
      spread: expect.closeTo(0, 6),
    });
    expect(latencyFromTaps(clicks, taps.slice(0, 7), 120)).toBeNull();
  });
});

describe("tick-aligned music", () => {
  it("is scheduled at the context time of its tick, which timeOfTick and simPositionMs map", () => {
    const backend = fakeAudioBackend({ state: "running" });
    backend.advance(5);
    const system = audioSystem(backend);
    expect(system.clock.timeOfTick(3)).toBeNull();
    run(4, system, backend);
    const play = backend.log.find((c) => c.op === "play");
    expect(play).toMatchObject({ op: "play", opts: { bus: "music", loop: true } });
    const when = play?.op === "play" ? play.opts.when : undefined;
    expect(when).toBeCloseTo(5 + (3 * (1000 / 60)) / 1000, 9);
    expect(system.clock.timeOfTick(3)).toBeCloseTo(when!, 9);
    expect(system.clock.timeOfTick(63)).toBeCloseTo(when! + 1, 9);
    expect(system.clock.simPositionMs(3)).toBe(0);
    expect(system.clock.simPositionMs(63)).toBeCloseTo(1000, 9);
    system.stopAll();
    expect(system.clock.timeOfTick(3)).toBeNull();
  });

  it("joins the song where the ticks have it when unlocked late", async () => {
    const backend = fakeAudioBackend();
    const system = audioSystem(backend);
    run(33, system, backend);
    expect(backend.log.some((c) => c.op === "play")).toBe(false);
    await system.unlock();
    const play = backend.log.find((c) => c.op === "play");
    expect(play?.op === "play" ? play.opts.offset : undefined).toBeCloseTo(0.5, 6);
  });

  it("reseeks music on a clock 1% fast once it drifts past 40 ms, and never moves the ticks", () => {
    const quiet = run(600);
    const backend = fakeAudioBackend({ state: "running" });
    const system = audioSystem(backend);
    expect(run(600, system, backend, 1.01)).toEqual(quiet);
    const seeks = backend.log.flatMap((c) => (c.op === "seek" ? [c] : []));
    // 1% of 10 s is 100 ms of drift: a reseek each time it passes 40 ms.
    expect(seeks).toHaveLength(2);
    const tickMs = 1000 / 60;
    seeks.forEach((seek, i) => {
      // The song started on tick 3; the context clock reads 1.01 × the simulation's.
      const songMs = (seek.at * 1000) / 1.01 - 3 * tickMs;
      expect(Math.abs(songMs - ((i + 1) * MUSIC_DRIFT_LIMIT_MS) / 0.01)).toBeLessThan(3 * tickMs);
      expect(seek.seconds * 1000).toBeCloseTo(
        wrapClipMs(songMs, { durationMs: SONG_MS, loop: true }),
        3,
      );
    });
    expect(Math.abs(system.clock.driftMs)).toBeLessThanOrEqual(MUSIC_DRIFT_LIMIT_MS);
  });

  it("leaves music started free alone", () => {
    const backend = fakeAudioBackend({ state: "running" });
    const system = audioSystem(backend);
    const free: AudioRequest = { op: "music", sound: "song", at: "start", tick: 0 };
    system.tick(0, [], [free]);
    for (let i = 1; i < 600; i++) {
      backend.advance((1.01 * (1000 / 60)) / 1000);
      system.frame(VIEW, i * (1000 / 60));
    }
    expect(backend.log.some((c) => c.op === "seek")).toBe(false);
    expect(system.clock.timeOfTick(0)).toBeNull();
  });
});

describe("latencyMs", () => {
  it("reads the last @latency the ticks carried, 0 before one", () => {
    const input = createInputState(registry);
    const tick = (commands: { name: string; args?: unknown }[]) =>
      input.update({ tick: 0, actions: [], commands, pointers: [], joins: [] });
    expect(input.latencyMs()).toBe(0);
    tick([{ name: LATENCY_COMMAND, args: { ms: 40 } }]);
    expect(input.latencyMs()).toBe(40);
    tick([]);
    expect(input.latencyMs()).toBe(40);
    tick([
      { name: LATENCY_COMMAND, args: { ms: 12 } },
      { name: LATENCY_COMMAND, args: { ms: -7 } },
    ]);
    expect(input.latencyMs()).toBe(-7);
  });

  it("is what the clock reports", () => {
    let latency = 25;
    const system = audioSystem(fakeAudioBackend({ state: "running" }), () => latency);
    expect(system.clock.latencyMs).toBe(25);
    latency = 30;
    expect(system.clock.latencyMs).toBe(30);
  });
});

describe("calibration over the audio system", () => {
  /** Taps every click `lateMs` late, then runs the clock past the track. */
  async function tapAlong(
    backend: FakeAudioBackend,
    system: AudioSystemHandle,
    opts: { sound?: string; taps?: number; lateMs?: number } = {},
  ) {
    let tap = () => {};
    const from = backend.log.length;
    const result = system.calibrate({
      ...(opts.sound !== undefined ? { sound: opts.sound } : {}),
      onTap: (fn) => {
        tap = fn;
        return () => {
          tap = () => {};
        };
      },
      wait: () => Promise.resolve(),
    });
    // The clip loads before the track starts; let it.
    await Promise.resolve();
    await Promise.resolve();
    const clicks = backend.log
      .slice(from)
      .flatMap((c) => (c.op === "play" && c.opts.when !== undefined ? [c.opts.when] : []));
    for (const when of clicks.slice(0, opts.taps ?? clicks.length)) {
      backend.advance(when + (opts.lateMs ?? 60) / 1000 - backend.now);
      tap();
    }
    backend.advance(2);
    return { result: await result, clicks };
  }

  it("gives 60 ± 1 ms for 16 taps 60 ms late, rendering the click patch once", async () => {
    const backend = fakeAudioBackend({ state: "running" });
    const system = audioSystem(backend);
    const first = await tapAlong(backend, system);
    expect(first.clicks).toHaveLength(16);
    expect(first.clicks[1]! - first.clicks[0]!).toBeCloseTo(0.6, 9);
    expect(first.result?.ms).toBeGreaterThanOrEqual(59);
    expect(first.result?.ms).toBeLessThanOrEqual(61);
    const second = await tapAlong(backend, system, { lateMs: 20 });
    expect(second.result?.ms).toBeCloseTo(20, 3);
    const buffers = backend.log.filter((c) => c.op === "buffer");
    expect(buffers).toEqual([
      expect.objectContaining({
        channels: 1,
        length: Math.round((synthDurationMs(CLICK_PATCH) * SYNTH_SAMPLE_RATE) / 1000),
      }),
    ]);
    const plays = backend.log.filter((c) => c.op === "play");
    expect(plays.every((c) => c.op === "play" && c.opts.bus === "ui")).toBe(true);
  });

  it("plays the given sound as the click, on its bus", async () => {
    const backend = fakeAudioBackend({ state: "running" });
    const system = audioSystem(backend);
    const { result } = await tapAlong(backend, system, { sound: "tick" });
    expect(result?.ms).toBeCloseTo(60, 3);
    const plays = backend.log.filter((c) => c.op === "play");
    expect(plays).toHaveLength(16);
    expect(plays.every((c) => c.op === "play" && c.opts.bus === "sfx")).toBe(true);
  });

  it("resolves null under 8 taps, while locked, and for a sound with no clip", async () => {
    const backend = fakeAudioBackend({ state: "running" });
    const system = audioSystem(backend);
    expect((await tapAlong(backend, system, { taps: 7 })).result).toBeNull();
    expect((await tapAlong(backend, system, { sound: "missing" })).result).toBeNull();
    const locked = audioSystem(fakeAudioBackend());
    expect((await tapAlong(fakeAudioBackend(), locked)).result).toBeNull();
  });
});

describe("calibrateLatency in the shell", () => {
  const games: GameInstance[] = [];
  let frames: FrameClock;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    frames = manualFrames({ timers: true });
    document.body.appendChild(document.createElement("canvas"));
  });

  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function playing(config: Partial<GameConfig> = {}): Promise<GameInstance> {
    const game = await createGame(document.querySelector("canvas")!, {
      game: metronome as GameDefinition,
      project,
      ...config,
    });
    games.push(game);
    game.start();
    expect(game.play(doc)).toMatchObject({ ok: true });
    return game;
  }

  const key = (type: "down" | "up"): ToolEvent => ({
    kind: "key",
    type,
    key: "Enter",
    code: "Enter",
    native: new KeyboardEvent(`key${type}`, { key: "Enter", code: "Enter" }),
  });

  const latencyOf = (g: GameInstance) => (g.runtime() as SceneRuntimeHandle).ctx.input.latencyMs();

  it("sends the median as @latency, saves it, and starts the next Play with it; a replay judges alike", async () => {
    const backend = fakeAudioBackend({ state: "running" });
    const prefs = memoryPrefsStore();
    const game = await playing({ audio: { backend, prefs } });
    frames.ticks(2);
    const calibrating = game.calibrateLatency({ beats: 12, bpm: 120 });
    await vi.advanceTimersByTimeAsync(0);
    const clicks = backend.log.flatMap((c) =>
      c.op === "play" && c.opts.bus === "ui" && c.opts.when !== undefined ? [c.opts.when] : [],
    );
    expect(clicks).toHaveLength(12);
    for (const when of clicks) {
      backend.advance(when + 0.045 - backend.now);
      game.router.dispatch(key("down"));
      game.router.dispatch(key("up"));
    }
    backend.advance(1);
    await vi.advanceTimersByTimeAsync(200);
    const result = await calibrating;
    expect(result?.ms).toBeCloseTo(45, 3);
    expect(prefs.load("metronome")["audio.latencyMs"]).toBe(45);

    frames.ticks(3);
    expect(latencyOf(game)).toBe(45);
    expect(game.audio?.clock.latencyMs).toBe(45);
    game.stop();
    const recording = game.recording()!;
    expect(JSON.stringify(recording)).toContain(LATENCY_COMMAND);
    const replay = replayRecording({ game: metronome as GameDefinition, scene: doc, recording });
    if (replay.blocked) throw new Error("replay blocked");
    expect(replay.matches, replay.divergence ?? "").toBe(true);

    expect(game.play(doc)).toMatchObject({ ok: true });
    frames.ticks(2);
    expect(latencyOf(game)).toBe(45);
  });

  it("resolves null with no audio", async () => {
    const game = await playing({ audio: { backend: false } });
    await expect(game.calibrateLatency()).resolves.toBeNull();
  });
});

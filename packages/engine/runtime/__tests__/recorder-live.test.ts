// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { preparedOf } from "../../__tests__/fixtures/live-version";
import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { SceneSwap } from "../../game/live";
import { expandScene } from "../../scene/expand";
import { parseRecording, type RecordedSwap, type RunRecording } from "../../scene/recording-schema";
import type { SceneDefinition } from "../../scene/types";
import { createLiveLayer } from "../live";
import { createSessionRecording, playWorld } from "../play-session";
import { createRunRecorder, recordedSwap, type RecorderOptions } from "../recorder";
import { createSceneRuntime } from "../runtime";
import type { SceneRuntimeHandle } from "../types";

const V1 = "1".repeat(64);
const V2 = "2".repeat(64);
const registry = createRegistry(testGame);
const END = { result: "quit", tick: 9, ticks: 10 } as const;

const options = (more: Partial<RecorderOptions> = {}): RecorderOptions => ({
  rapier: null,
  game: testGame,
  registry,
  scene: "yard",
  sceneHash: "h0" as RunRecording["sceneHash"],
  runHash: "r0",
  start: {},
  platform: { arch: "arm64", runtime: "node 24", flavour: null },
  projectRef: null,
  ...more,
});

const swapAt = (tick: number, version: string | null, more: Partial<RecordedSwap> = {}) =>
  ({
    tick,
    version,
    strategy: "reconcile",
    timing: "now",
    sceneHash: `s${tick}`,
    runHash: `r${tick}`,
    ...more,
  }) as RecordedSwap;

const roundTrips = (rec: RunRecording) => {
  const parsed = parseRecording(JSON.stringify(rec));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.recording).toEqual(rec);
};

describe("the recorder's live keys", () => {
  it("writes a run without swaps byte for byte as before: neither key, the same key order", () => {
    const plain = createRunRecorder(options()).finish(END, null);
    expect(Object.keys(plain)).toEqual([
      "v",
      "engine",
      "platform",
      "game",
      "scene",
      "sceneHash",
      "runHash",
      "project",
      "configHash",
      "time",
      "seed",
      "start",
      "players",
      "actions",
      "commands",
      "inputs",
      "system",
      "ticks",
      "outcome",
      "markers",
      "end",
      "trail",
    ]);
    const nulled = createRunRecorder(options({ sceneVersion: null }));
    expect(JSON.stringify(nulled.finish(END, null))).toBe(JSON.stringify(plain));
  });

  it("writes the version the segment started on, and only that, without a swap", () => {
    const rec = createRunRecorder(options({ sceneVersion: V1 })).finish(END, null);
    expect(rec.sceneVersion).toBe(V1);
    expect(rec).not.toHaveProperty("swaps");
    roundTrips(rec);
  });

  it("appends each swap in the order given, with the spec's keys only", () => {
    const recorder = createRunRecorder(options({ sceneVersion: V1 }));
    const first = { ...swapAt(3, V2), extra: true } as RecordedSwap;
    recorder.swap(first);
    recorder.swap(swapAt(7, null, { strategy: "reload", timing: "boundary" }));
    first.tick = 99;
    const rec = recorder.finish(END, null);
    expect(rec.swaps).toEqual([
      swapAt(3, V2),
      swapAt(7, null, { strategy: "reload", timing: "boundary" }),
    ]);
    expect(Object.keys(rec.swaps![0]!)).toEqual([
      "tick",
      "version",
      "strategy",
      "timing",
      "sceneHash",
      "runHash",
    ]);
    roundTrips(rec);
  });

  it("shares no swap with a recording it already finished", () => {
    const recorder = createRunRecorder(options());
    recorder.swap(swapAt(1, V1));
    const rec = recorder.finish(END, null);
    recorder.swap(swapAt(2, V2));
    expect(rec.swaps).toEqual([swapAt(1, V1)]);
  });
});

const DEF: SceneDefinition = {
  v: 4,
  name: "yard",
  bounds: [0, 0, 20, 10],
  settings: { physics: "none" },
  entities: [{ id: "start", type: "marker", at: [1, 1] }],
};

describe("a Play's session recording of a swap", () => {
  it("records the live layer's applied swap with its tick, and finishes with the start's version", () => {
    let rt: SceneRuntimeHandle | null = null;
    const layer = createLiveLayer({
      game: testGame,
      runtime: () => rt,
      release: (id) => (id === "yard" ? { def: DEF, prefabs: new Map() } : null),
    });
    const handle = createSceneRuntime({
      rapier: null,
      view: null,
      game: testGame,
      registry,
      live: layer.hooks,
    });
    rt = handle;
    expect(handle.load(expandScene(DEF, registry)).ok).toBe(true);
    const session = createSessionRecording({
      ...options({ sceneVersion: handle.ctx.live.version }),
      world: playWorld(handle.ctx),
    });
    layer.onApplied((swap: SceneSwap) => session.swap(recordedSwap(swap)));

    const step = () => {
      const result = handle.step(handle.ctx.time.tickMs, []);
      session.stepped(result, [], null);
      layer.afterTick({ paused: false, changing: false });
    };
    for (let i = 0; i < 4; i++) step();
    const moved: SceneDefinition = {
      ...DEF,
      entities: [{ id: "start", type: "marker", at: [3, 1] }],
    };
    const applied = layer.apply("yard", preparedOf(V1, moved, registry), { timing: "now" });
    expect(applied.ok).toBe(true);
    for (let i = 0; i < 3; i++) step();
    const rec = session.stop()!;

    expect(rec).not.toHaveProperty("sceneVersion");
    if (!applied.ok) return;
    expect(rec.swaps).toEqual([
      {
        tick: 4,
        version: V1,
        strategy: applied.swap.strategy,
        timing: "now",
        sceneHash: "hash-1111",
        runHash: applied.swap.to.runHash,
      },
    ]);
    session.swap(swapAt(9, null));
    expect(session.done!.swaps).toHaveLength(1);
    roundTrips(rec);
  });
});

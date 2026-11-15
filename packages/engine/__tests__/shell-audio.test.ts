// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import { fakeAudioBackend, type FakeAudioBackend } from "../audio/fake";
import type { AudioSystemHandle, AudioSystemOptions } from "../audio/system";
import { webAudioBackend } from "../audio/web-audio";
import { createGame } from "../engine";
import type { BehaviorSystem } from "../game/behaviors";
import { AUDIO, type AudioBlock } from "../game/behaviors/audio";
import { defineGame } from "../game/define";
import type { EngineContext, GameDefinition } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { runPlaytest } from "../headless/playtest";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { createPixiView } from "../render/pixi-view";
import { audioVoiceKey, createAudioBehaviorSystem } from "../runtime/behaviors/audio";
import type { AudioRequest } from "../runtime/present";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreLoaded } from "../runtime/save-state";
import type { SceneRuntimeHandle } from "../runtime/types";
import { DEFAULT_LAYERS } from "../scene/layers";
import {
  SCENE_FORMAT_VERSION,
  type ExpandedScene,
  type RuntimeEntity,
  type SceneDefinition,
} from "../scene/types";
import type { ToolEvent } from "../tool-router";
import type { GameConfig, GameInstance } from "../types";
import { manualFrames, type FrameClock } from "./fixtures/frame-clock";

/** Every audio system the shell built, with what it was handed each tick. */
type Made = {
  opts: AudioSystemOptions;
  system: AudioSystemHandle;
  ticks: { tick: number; requests: AudioRequest[] }[];
  frames: number;
  destroyed: boolean;
};
const made = vi.hoisted(() => [] as Made[]);

vi.mock("../audio/system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audio/system")>();
  return {
    ...actual,
    createAudioSystem: (opts: AudioSystemOptions) => {
      const system = actual.createAudioSystem(opts);
      const rec: Made = { opts, system, ticks: [], frames: 0, destroyed: false };
      const tick = system.tick.bind(system);
      const frame = system.frame.bind(system);
      const destroy = system.destroy.bind(system);
      system.tick = (t, events, requests) => {
        rec.ticks.push({ tick: t, requests: structuredClone([...requests]) });
        tick(t, events, requests);
      };
      system.frame = (view, simMs) => {
        rec.frames++;
        frame(view, simMs);
      };
      system.destroy = () => {
        rec.destroyed = true;
        destroy();
      };
      made.push(rec);
      return system;
    },
  };
});

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

/** A looping positional hum: one synth patch, so nothing is fetched. */
const project: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  doc: <T>(kind: string, id: string): T | undefined => {
    if (kind === "sound" && id === "hum")
      return {
        kind: "sound",
        v: 1,
        bus: "sfx",
        loop: true,
        positional: true,
        variants: [{ clip: "hum-patch" }],
      } as T;
    if (kind === "synth" && id === "hum-patch")
      return { kind: "synth", v: 1, wave: "sine", freq: 220, sustainMs: 200, decayMs: 50 } as T;
    return undefined;
  },
  docs: (kind) => (kind === "sound" ? ["hum"] : kind === "synth" ? ["hum-patch"] : []),
};

/** Walks a counter; tick 2 plays a keyed hum, tick 4 stops the box's hum through its handle. */
const humming: GameDefinition<{ n: number }> = defineGame({
  id: "humming",
  types: [],
  actions: [],
  world: { physics: "none" },
  time: { kind: "fixed", rate: 60 },
  createRuntime(ctx: EngineContext) {
    let n = 0;
    return {
      afterStep() {
        n += ctx.tick;
        if (ctx.tick === 2) ctx.present.audio.play("hum", { key: "extra", at: { x: 1, y: 1 } });
        if (ctx.tick === 4) ctx.entity("box")?.getBehavior(AUDIO)?.stop();
      },
      snapshot: () => ({ n }),
      restore: (state) => {
        n = state.n;
      },
    };
  },
});

const doc: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "humming",
  name: "humming",
  bounds: [0, 0, 40, 20],
  settings: { physics: "none" },
  entities: [
    { id: "box", type: "marker", at: [5, 5], behaviors: { audio: { sound: "hum" } } },
    {
      id: "kid",
      type: "marker",
      parent: "box",
      at: [1, 0],
      behaviors: { audio: { sound: "hum", volume: 0.5 } },
    },
  ],
};

const expanded: ExpandedScene = {
  name: "humming",
  game: "humming",
  bounds: [0, 0, 40, 20],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities: doc.entities as ExpandedScene["entities"],
};

/** The scene in a runtime with a view, where visual behaviors are built. */
function viewedRuntime(): SceneRuntimeHandle {
  const view = createPixiView(new Container(), { layers: DEFAULT_LAYERS });
  const rt = createSceneRuntime({ rapier: null, view, game: humming as GameDefinition, project });
  const report = rt.load(expanded);
  expect(report.ok, JSON.stringify(report)).toBe(true);
  return rt;
}

const pointerDown = (): ToolEvent => ({
  kind: "pointer",
  type: "down",
  screen: { x: 10, y: 10 },
  button: 0,
  deltaY: 0,
  native: new MouseEvent("pointerdown"),
});

const games: GameInstance[] = [];
let frames: FrameClock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  frames = manualFrames({ timers: true });
  document.body.appendChild(document.createElement("canvas"));
  made.length = 0;
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function makeGame(config: Partial<GameConfig> = {}): Promise<GameInstance> {
  const game = await createGame(document.querySelector("canvas")!, {
    game: humming as GameDefinition,
    project,
    ...config,
  });
  games.push(game);
  return game;
}

/** Into edit mode, as the editor opens. */
async function editing(config: Partial<GameConfig> = {}): Promise<GameInstance> {
  const game = await makeGame({ scene: doc, ...config });
  game.start();
  game.stop();
  expect(game.getMode()).toBe("edit");
  return game;
}

async function playing(config: Partial<GameConfig> = {}): Promise<GameInstance> {
  const game = await makeGame(config);
  game.start();
  expect(game.play(doc)).toMatchObject({ ok: true });
  return game;
}

const tickOf = (g: GameInstance) => g.getStore().state.tick;
function runTicks(g: GameInstance, n: number): void {
  const until = tickOf(g) + n;
  for (let ms = 0; tickOf(g) < until && ms < 5000; ms += 10) frames.advance(10);
  expect(tickOf(g)).toBe(until);
}

const plays = (backend: FakeAudioBackend) => backend.log.filter((c) => c.op === "play");

describe("no backend", () => {
  it("builds no audio system with backend: false, and GameInstance.audio stays null", async () => {
    const asked = vi.fn((): false => false);
    const off = await playing({ audio: { backend: false } });
    runTicks(off, 6);
    expect(off.audio).toBeNull();
    const fn = await playing({ audio: { backend: asked } });
    runTicks(fn, 6);
    expect(fn.audio).toBeNull();
    // The function form is asked once per Play, and answering false builds nothing.
    expect(asked).toHaveBeenCalledTimes(1);
    expect(made).toEqual([]);
  });

  it("is never built headless: no audio system and no audio behavior system", () => {
    const backend = fakeAudioBackend();
    const rt = createHeadlessRuntime({ game: humming as GameDefinition, scene: expanded, project });
    expect(rt.ctx.behavior("audio")).toBeUndefined();
    for (let i = 0; i < 6; i++) rt.step(rt.ctx.time.tickMs, []);
    rt.destroy();
    const run = runPlaytest({
      game: humming as GameDefinition,
      scene: doc,
      project,
      script: { v: 1, steps: [{ wait: 6 }] },
    });
    expect(run.blocked).toBe(false);
    expect(made).toEqual([]);
    expect(backend.log).toEqual([]);
  });
});

describe("the shell's audio system", () => {
  it("hands each tick's audio requests to the system after the tick, in order, and frames it", async () => {
    const backend = fakeAudioBackend({ state: "running" });
    const game = await playing({ audio: { backend } });
    runTicks(game, 6);
    expect(made).toHaveLength(1);
    const [rec] = made;
    const asked = rec!.ticks.filter((t) => t.requests.length > 0);
    expect(asked).toEqual([
      {
        tick: 0,
        requests: [
          { op: "play", sound: "hum", entity: "box", key: "box#audio" },
          { op: "play", sound: "hum", entity: "kid", key: "kid#audio", volume: 0.5 },
        ],
      },
      { tick: 2, requests: [{ op: "play", sound: "hum", key: "extra", at: { x: 1, y: 1 } }] },
      { tick: 4, requests: [{ op: "stop", key: "box#audio" }] },
    ]);
    expect(rec!.frames).toBeGreaterThan(0);
    expect(plays(backend).map((c) => c.opts.key)).toEqual(["box#audio", "kid#audio", "extra"]);
    expect(plays(backend)[0]!.opts.loop).toBe(true);
    expect(backend.log.some((c) => c.op === "buffer" && c.channels === 1)).toBe(true);
    expect(game.audio?.unlocked).toBe(true);
  });

  it("reads a child's world pose, so a source under a parent pans from where it is", async () => {
    const game = await playing({ audio: { backend: fakeAudioBackend({ state: "running" }) } });
    runTicks(game, 1);
    expect(made[0]!.opts.poses.get("kid")).toMatchObject({ x: 6, y: 5 });
    expect(made[0]!.opts.entity?.("kid")?.type).toBe("marker");
  });

  it("stops the world's keyed sounds when the world goes, and closes nothing it was handed", async () => {
    const backend = fakeAudioBackend({ state: "running" });
    const game = await playing({ audio: { backend } });
    runTicks(game, 3);
    expect(game.play(doc)).toMatchObject({ ok: true });
    const stops = made[0]!.ticks.at(-1)!.requests;
    expect(
      stops.flatMap((r) => (r.op === "stop" ? [r.key] : [])).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["box#audio", "extra", "kid#audio"]);
    game.stop();
    expect(backend.log.some((c) => c.op === "close")).toBe(false);
    game.destroy();
    expect(backend.log.filter((c) => c.op === "close")).toHaveLength(1);
  });

  it("unlocks on the first gesture through the tool router and raises audio:unlocked once", async () => {
    const backend = fakeAudioBackend();
    const game = await playing({ audio: { backend } });
    const unlocked = vi.fn();
    game.on("audio:unlocked", unlocked);
    runTicks(game, 3);
    expect(game.audio?.unlocked).toBe(false);
    // Before unlock a one-shot is dropped.
    expect(plays(backend)).toEqual([]);

    game.router.dispatch(pointerDown());
    await vi.waitFor(() => expect(game.audio?.unlocked).toBe(true));
    game.router.dispatch(pointerDown());
    await Promise.resolve();
    expect(backend.log.filter((c) => c.op === "unlock")).toHaveLength(1);
    expect(unlocked).toHaveBeenCalledTimes(1);
  });

  it("unlocks at once when Play starts after a gesture made while editing", async () => {
    const backend = fakeAudioBackend();
    const game = await editing({ audio: { backend: () => backend } });
    game.router.dispatch(pointerDown());
    expect(backend.log).toEqual([]);
    game.setMode("play");
    await vi.waitFor(() => expect(game.audio?.unlocked).toBe(true));
  });

  it("a touch ending on the input target unlocks, as iOS needs", async () => {
    const backend = fakeAudioBackend();
    const game = await playing({ audio: { backend } });
    runTicks(game, 1);
    document.querySelector("canvas")!.dispatchEvent(new Event("touchend"));
    await vi.waitFor(() => expect(game.audio?.unlocked).toBe(true));
  });

  it("tries again on a touch's end when its pointerdown couldn't resume the context", async () => {
    let tries = 0;
    const { context } = fakeContext({
      resume: (ctx) => {
        tries++;
        if (tries === 1) return Promise.reject(new Error("not allowed on a pointerdown"));
        ctx.state = "running";
        return Promise.resolve();
      },
    });
    const backend = webAudioBackend({ context });
    const game = await playing({ audio: { backend } });
    const unlocked = vi.fn();
    game.on("audio:unlocked", unlocked);
    runTicks(game, 1);
    game.router.dispatch(pointerDown());
    await vi.waitFor(() => expect(tries).toBe(1));
    await Promise.resolve();
    expect(backend.state).toBe("locked");
    expect(game.audio?.unlocked).toBe(false);

    document.querySelector("canvas")!.dispatchEvent(new Event("touchend"));
    await vi.waitFor(() => expect(game.audio?.unlocked).toBe(true));
    expect(tries).toBe(2);
    expect(backend.state).toBe("running");
    expect(unlocked).toHaveBeenCalledTimes(1);
  });

  it("asks the function form when Play starts and closes what it built when Play ends", async () => {
    const backends: FakeAudioBackend[] = [];
    const ask = vi.fn(() => {
      const b = fakeAudioBackend({ state: "running" });
      backends.push(b);
      return b;
    });
    const game = await editing({ audio: { backend: ask } });
    expect(ask).not.toHaveBeenCalled();
    expect(game.audio).toBeNull();

    game.setMode("play");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(game.audio).not.toBeNull();
    runTicks(game, 2);
    game.setMode("edit");
    expect(made[0]!.destroyed).toBe(true);
    expect(backends[0]!.log.at(-1)?.op).toBe("close");
    expect(game.audio).toBeNull();

    game.setMode("play");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(made).toHaveLength(2);
  });

  it("plays a sound on entity:destroyed by the destroyed entity's type and tags", async () => {
    const pops: ProjectRuntimeView = {
      ...project,
      doc: <T>(kind: string, id: string): T | undefined => {
        if (kind === "sound" && (id === "pop" || id === "chime"))
          return {
            kind: "sound",
            v: 1,
            bus: "sfx",
            variants: [{ clip: `${id}-patch` }],
            on: [
              id === "pop"
                ? { event: "entity:destroyed", type: "marker" }
                : { event: "entity:destroyed", tag: "coin" },
            ],
          } as T;
        if (kind === "synth" && (id === "pop-patch" || id === "chime-patch"))
          return {
            kind: "synth",
            v: 1,
            wave: "square",
            freq: 880,
            sustainMs: 20,
            decayMs: 20,
          } as T;
        return undefined;
      },
      docs: (kind) =>
        kind === "sound" ? ["chime", "pop"] : kind === "synth" ? ["chime-patch", "pop-patch"] : [],
    };
    const collecting: GameDefinition = defineGame({
      id: "collecting",
      types: [],
      actions: [],
      world: { physics: "none" },
      time: { kind: "fixed", rate: 60 },
      createRuntime: (ctx: EngineContext) => ({
        afterStep() {
          if (ctx.tick === 2) ctx.destroy("coin");
        },
        snapshot: () => null,
      }),
    }) as GameDefinition;
    const backend = fakeAudioBackend({ state: "running" });
    const game = await makeGame({
      game: collecting,
      audio: { backend },
      ...({ project: pops } as Partial<GameConfig>),
    });
    game.start();
    const scene: SceneDefinition = {
      ...doc,
      game: "collecting",
      entities: [{ id: "coin", type: "marker", at: [5, 5], tags: ["coin"] }],
    };
    expect(game.play(scene)).toMatchObject({ ok: true });
    runTicks(game, 4);
    expect(made[0]!.opts.entity?.("coin")).toBeUndefined();
    const buffers = backend.log.flatMap((c) => (c.op === "buffer" ? [c.clip] : []));
    expect(buffers).toHaveLength(2);
    expect(new Set(plays(backend).map((c) => c.clip))).toEqual(new Set(buffers));
    expect(plays(backend)).toHaveLength(2);
    expect(plays(backend).every((c) => c.at === plays(backend)[0]!.at)).toBe(true);
  });

  it("a playtest with the audio system and one without end on one digest", async () => {
    const run = async (config: Partial<GameConfig>) => {
      const game = await playing(config);
      runTicks(game, 30);
      game.router.dispatch(pointerDown());
      runTicks(game, 30);
      game.stop();
      return game.recording()!;
    };
    const silent = await run({ audio: { backend: false } });
    const heard = await run({ audio: { backend: fakeAudioBackend() } });
    expect(made).toHaveLength(1);
    expect(heard.ticks).toBe(silent.ticks);
    expect(heard.end).toBe(silent.end);
  });
});

// ─── The behavior's requests ───

/** The audio behavior's system over a queue that records what it's asked. */
function behaviorSystem() {
  const asked: AudioRequest[] = [];
  const ctx = {
    present: {
      audio: {
        play: (sound: string, opts: Record<string, unknown> = {}) =>
          void asked.push({ op: "play", sound, ...opts } as AudioRequest),
        stop: (key: string) => void asked.push({ op: "stop", key }),
        music: () => {},
      },
    },
  } as unknown as EngineContext;
  const system = createAudioBehaviorSystem(ctx, {} as never) as BehaviorSystem<AudioBlock>;
  const take = () => asked.splice(0);
  return { system, take };
}

const entity = { id: "e", type: "marker" } as RuntimeEntity;

describe("the audio behavior", () => {
  it("plays keyed by its entity on attach, stops on detach, and does both on update", () => {
    const { system, take } = behaviorSystem();
    system.attach("e", { sound: "hum" }, entity);
    expect(take()).toEqual([{ op: "play", sound: "hum", entity: "e", key: audioVoiceKey("e") }]);
    system.update!("e", { sound: "drone", volume: 0.4 }, { sound: "hum" }, entity);
    expect(take()).toEqual([
      { op: "stop", key: "e#audio" },
      { op: "play", sound: "drone", entity: "e", key: "e#audio", volume: 0.4 },
    ]);
    system.update!("e", { sound: "drone", playing: false }, { sound: "drone" }, entity);
    expect(take()).toEqual([{ op: "stop", key: "e#audio" }]);
    system.detach("e");
    expect(take()).toEqual([]);

    system.attach("e", { sound: "hum", playing: false }, entity);
    expect(take()).toEqual([]);
    system.update!("e", { sound: "hum" }, { sound: "hum", playing: false }, entity);
    expect(take()).toEqual([{ op: "play", sound: "hum", entity: "e", key: "e#audio" }]);
    system.detach("e");
    expect(take()).toEqual([{ op: "stop", key: "e#audio" }]);
    system.detach("e");
    expect(take()).toEqual([]);
    expect(system.size()).toBe(0);
  });

  it("starts through its handle by the same requests, again on each play, and stops once", () => {
    const { system, take } = behaviorSystem();
    system.attach("e", { sound: "hum", playing: false }, entity);
    const handle = system.handle!("e") as { play(): void; stop(): void; playing: boolean };
    expect(handle.playing).toBe(false);
    handle.play();
    expect(take()).toEqual([{ op: "play", sound: "hum", entity: "e", key: "e#audio" }]);
    handle.play();
    expect(handle.playing).toBe(true);
    expect(take()).toEqual([
      { op: "stop", key: "e#audio" },
      { op: "play", sound: "hum", entity: "e", key: "e#audio" },
    ]);
    handle.stop();
    handle.stop();
    expect(handle.playing).toBe(false);
    expect(take()).toEqual([{ op: "stop", key: "e#audio" }]);
  });

  it("saves only what its handle changed, and puts it back after the block attaches again", () => {
    const { system, take } = behaviorSystem();
    system.attach("e", { sound: "hum" }, entity);
    expect(system.save!("e")).toBeUndefined();
    (system.handle!("e") as { stop(): void }).stop();
    const saved = system.save!("e");
    expect(saved).toEqual({ playing: false });
    system.detach("e");
    take();

    system.attach("e", { sound: "hum" }, entity);
    system.restore!("e", saved!);
    expect(take()).toEqual([
      { op: "play", sound: "hum", entity: "e", key: "e#audio" },
      { op: "stop", key: "e#audio" },
    ]);
    expect(system.save!("e")).toEqual({ playing: false });
    system.restore!("e", { playing: true });
    expect(take()).toEqual([{ op: "play", sound: "hum", entity: "e", key: "e#audio" }]);
    expect(system.save!("e")).toBeUndefined();
  });

  it("a world save in a view keeps what the handle stopped; headless there is nothing to save", () => {
    const viewed = viewedRuntime();
    for (let i = 0; i < 6; i++) viewed.step(viewed.ctx.time.tickMs, []);
    const handle = () => viewed.ctx.entity("box")?.getBehavior(AUDIO);
    expect(handle()?.playing).toBe(false);
    const saved = captureSave(viewed, { depth: "world", slot: "s", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    expect(JSON.stringify(saved.file.world)).toContain('"audio":{"playing":false}');

    const again = viewedRuntime();
    expect(again.ctx.entity("box")?.getBehavior(AUDIO)?.playing).toBe(true);
    expect(restoreLoaded(again, structuredClone(saved.file))).toBeNull();
    expect(again.ctx.entity("box")?.getBehavior(AUDIO)?.playing).toBe(false);
    expect(again.ctx.entity("kid")?.getBehavior(AUDIO)?.playing).toBe(true);

    const headless = createHeadlessRuntime({
      game: humming as GameDefinition,
      scene: expanded,
      project,
    });
    for (let i = 0; i < 6; i++) headless.step(headless.ctx.time.tickMs, []);
    const plain = captureSave(headless, { depth: "world", slot: "s", now: 0 });
    if (!plain.ok) throw new Error(plain.issue.message);
    expect(JSON.stringify(plain.file.world)).not.toContain("audio");
    // A view's save restores headless, the audio state left for the system that isn't there.
    const other = createHeadlessRuntime({
      game: humming as GameDefinition,
      scene: expanded,
      project,
    });
    expect(restoreLoaded(other, structuredClone(saved.file))).toBeNull();
    expect(other.snapshot()).toEqual(headless.snapshot());
    for (const rt of [viewed, again, headless, other]) rt.destroy();
  });
});

// ─── The Web Audio backend's graph, over a stand-in context ───

class FakeParam {
  value: number;
  calls: [string, ...number[]][] = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["ramp", v, t]);
    this.value = v;
  }
  setTargetAtTime(v: number, t: number, k: number) {
    this.calls.push(["target", v, t, k]);
    this.value = v;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", t]);
  }
}

class FakeNode {
  constructor(readonly name: string) {}
  out: FakeNode[] = [];
  connect(n: FakeNode) {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.out = [];
  }
}

type FakeBuffer = {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  copied: [Float32Array, number][];
  copyToChannel(a: Float32Array, i: number): void;
};

type FakeSource = FakeNode & {
  playbackRate: FakeParam;
  loop: boolean;
  started: [number, number] | null;
  stopped: number | null;
};

type FakeContextState = { state: string };

function fakeContext(
  opts: {
    offline?: boolean;
    channels?: number;
    /** Stands in for `resume()`; the default starts the context running. */
    resume?: (ctx: FakeContextState) => Promise<void>;
  } = {},
) {
  const made = {
    sources: [] as FakeSource[],
    decoded: [] as ArrayBuffer[],
  };
  const buffer = (n: number, length: number, sampleRate: number): FakeBuffer => {
    const b: FakeBuffer = {
      numberOfChannels: n,
      length,
      sampleRate,
      duration: length / sampleRate,
      copied: [],
      copyToChannel: (a, i) => void b.copied.push([a, i]),
    };
    return b;
  };
  const destination = Object.assign(new FakeNode("destination"), {
    channelCount: opts.channels ?? 2,
    maxChannelCount: opts.channels ?? 2,
  });
  const ctx = {
    currentTime: 1,
    sampleRate: 44_100,
    state: "suspended",
    destination,
    outputLatency: 0.02,
    baseLatency: 0.005,
    createGain: () => Object.assign(new FakeNode("gain"), { gain: new FakeParam(1) }),
    createStereoPanner: () => Object.assign(new FakeNode("panner"), { pan: new FakeParam(0) }),
    createBufferSource: () => {
      const source = Object.assign(new FakeNode("source"), {
        buffer: null as FakeBuffer | null,
        playbackRate: new FakeParam(1),
        loop: false,
        started: null as [number, number] | null,
        stopped: null as number | null,
        onended: null as (() => void) | null,
        start(when: number, offset = 0) {
          source.started = [when, offset];
        },
        stop(when = 0) {
          source.stopped = when;
        },
      });
      made.sources.push(source);
      return source;
    },
    createBuffer: buffer,
    decodeAudioData: (bytes: ArrayBuffer) => {
      made.decoded.push(bytes);
      return Promise.resolve(buffer(2, 44_100, 44_100));
    },
    resume: () => {
      if (opts.resume) return opts.resume(ctx);
      ctx.state = "running";
      return Promise.resolve();
    },
    close: () => {
      ctx.state = "closed";
      return Promise.resolve();
    },
    ...(opts.offline
      ? { startRendering: () => Promise.resolve() }
      : { createMediaElementSource: () => new FakeNode("media") }),
  };
  return { ctx, made, context: ctx as unknown as BaseAudioContext };
}

describe("webAudioBackend", () => {
  it("routes every voice source → gain → stereo panner → its bus → master → the destination", () => {
    const { context, made } = fakeContext();
    const backend = webAudioBackend({ context });
    const clip = backend.buffer([new Float32Array(441)], 44_100);
    expect(clip).toMatchObject({ channels: 1, streamed: false, duration: 0.01 });
    backend.play(clip, { bus: "sfx", volume: 0.5, rate: 1.5, pan: -1, loop: true, key: "k" });
    const source = made.sources.at(-1)!;
    const [gain] = source.out as (FakeNode & { gain: FakeParam })[];
    const [panner] = gain!.out as (FakeNode & { pan: FakeParam })[];
    const [bus] = panner!.out;
    const [master] = bus!.out;
    expect([gain!.name, panner!.name, bus!.name, master!.name]).toEqual([
      "gain",
      "panner",
      "gain",
      "gain",
    ]);
    expect(master!.out[0]!.name).toBe("destination");
    expect(gain!.gain.value).toBe(0.5);
    expect(panner!.pan.value).toBe(-1);
    expect(source).toMatchObject({ loop: true, started: [1, 0] });
    expect((source.playbackRate as FakeParam).value).toBe(1.5);
  });

  it("buffers one channel per array through createBuffer and copyToChannel", () => {
    const { context } = fakeContext();
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    const clip = webAudioBackend({ context }).buffer([left, right], 22_050);
    expect(clip.channels).toBe(2);
    expect(clip.duration).toBeCloseTo(100 / 22_050);
  });

  it("decodes a copy through decodeAudioData, so the caller's bytes stay whole", async () => {
    const { context, made } = fakeContext();
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const clip = await webAudioBackend({ context }).decode(bytes);
    expect(clip).toMatchObject({ channels: 2, duration: 1, streamed: false });
    expect(made.decoded[0]).not.toBe(bytes);
    expect(new Uint8Array(made.decoded[0]!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("is locked until unlock resumes it, reports output plus base latency, and closes", async () => {
    const { context, ctx, made } = fakeContext();
    const backend = webAudioBackend({ context });
    expect(backend.state).toBe("locked");
    expect(backend.latency).toBeCloseTo(0.025);
    await backend.unlock();
    expect(backend.state).toBe("running");
    // A silent sample starts inside the gesture, which iOS needs besides resume().
    expect(made.sources[0]!.started).not.toBeNull();
    const voice = backend.play(backend.buffer([new Float32Array(10)], 44_100), {
      bus: "music",
      volume: 1,
      rate: 1,
      pan: 0,
      loop: false,
      fadeInMs: 100,
    });
    voice.setPan(2);
    const panner = made.sources.at(-1)!.out[0]!.out[0] as FakeNode & { pan: FakeParam };
    expect(panner.pan.value).toBe(1);
    voice.stop(50);
    expect(made.sources.at(-1)!.stopped).toBeCloseTo(1.05);
    backend.close();
    expect(backend.state).toBe("closed");
    expect(ctx.state).toBe("closed");
  });

  it("plays the silent sample and resumes again on every unlock until the context runs", async () => {
    let tries = 0;
    let finishFirst = () => {};
    const { context, made } = fakeContext({
      resume: (ctx) => {
        tries++;
        if (tries === 1) return new Promise<void>((resolve) => (finishFirst = resolve));
        ctx.state = "running";
        return Promise.resolve();
      },
    });
    const backend = webAudioBackend({ context });
    const first = backend.unlock();
    expect(backend.state).toBe("suspended");
    await backend.unlock();
    expect(tries).toBe(2);
    expect(made.sources.filter((s) => s.started !== null)).toHaveLength(2);
    expect(backend.state).toBe("running");
    finishFirst();
    await first;
    await backend.unlock();
    expect(tries).toBe(2);
  });

  it("reads suspended while an asked resume hasn't settled, and locked again once it's refused", async () => {
    let refuse = () => {};
    const { context, ctx } = fakeContext({
      resume: () =>
        new Promise<void>((_resolve, reject) => (refuse = () => reject(new Error("no")))),
    });
    const backend = webAudioBackend({ context });
    // A context with no output device (Firefox's, without one) never settles its resume.
    const unlocking = backend.unlock();
    expect(backend.state).toBe("suspended");
    expect(ctx.state).toBe("suspended");
    refuse();
    await expect(unlocking).rejects.toThrow("no");
    expect(backend.state).toBe("locked");
  });

  it("a context that stops after running reads suspended, not locked", async () => {
    const { context, ctx } = fakeContext();
    const backend = webAudioBackend({ context });
    await backend.unlock();
    ctx.state = "suspended";
    expect(backend.state).toBe("suspended");
  });

  it("keeps a streamed clip's loop points, which a media element's own loop can't", () => {
    const element = Object.assign(new EventTarget(), {
      crossOrigin: null as string | null,
      preload: "",
      loop: false,
      playbackRate: 1,
      src: "",
      currentTime: 0,
      duration: 8,
      readyState: 4,
      paused: true,
      play: vi.fn(() => {
        element.paused = false;
        return Promise.resolve();
      }),
      pause: vi.fn(() => void (element.paused = true)),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    });
    // The backend creates nothing else while it plays a stream.
    const created = vi
      .spyOn(document, "createElement")
      .mockReturnValue(element as unknown as HTMLElement);
    onTestFinished(() => created.mockRestore());
    const { context } = fakeContext();
    const backend = webAudioBackend({ context });
    const clip = backend.stream("song.ogg");
    const base = { bus: "music", volume: 1, pan: 0, loop: true } as const;
    const voice = backend.play(clip, { ...base, rate: 2, loopStart: 1, loopEnd: 3 });
    expect(element.loop).toBe(false);
    expect(element.play).toHaveBeenCalledTimes(1);

    element.currentTime = 2;
    element.dispatchEvent(new Event("playing"));
    // A second to the loop end at double speed is half a second of wall time.
    vi.advanceTimersByTime(480);
    expect(element.currentTime).toBe(2);
    element.currentTime = 3;
    vi.advanceTimersByTime(20);
    expect(element.currentTime).toBe(1);

    // Past the loop end (a late timer, a seek): back into the loop by the overshoot.
    element.currentTime = 3.5;
    element.dispatchEvent(new Event("timeupdate"));
    expect(element.currentTime).toBeCloseTo(1.5);

    // With only a start, the file's end goes back to it.
    voice.stop();
    const fromOnly = backend.play(clip, { ...base, rate: 1, loopStart: 2 });
    element.currentTime = 8;
    element.dispatchEvent(new Event("ended"));
    expect(element.currentTime).toBe(2);
    expect(fromOnly.ended).toBe(false);
    fromOnly.stop();

    // A whole-file loop stays the element's own.
    backend.play(clip, { ...base, rate: 1 });
    expect(element.loop).toBe(true);
  });

  it("plays loop points that don't fit the clip as a buffered clip does: to its end, or all of it", () => {
    const element = Object.assign(new EventTarget(), {
      crossOrigin: null as string | null,
      preload: "",
      loop: false,
      playbackRate: 1,
      src: "",
      currentTime: 0,
      duration: 8,
      readyState: 4,
      paused: true,
      play: vi.fn(() => {
        element.paused = false;
        return Promise.resolve();
      }),
      pause: vi.fn(() => void (element.paused = true)),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    });
    const created = vi
      .spyOn(document, "createElement")
      .mockReturnValue(element as unknown as HTMLElement);
    onTestFinished(() => created.mockRestore());
    const { context, made } = fakeContext();
    const backend = webAudioBackend({ context });
    const base = { bus: "music", volume: 1, rate: 1, pan: 0, loop: true } as const;

    // A 1 s buffer: a lone start still loops to the end, which Web Audio wouldn't without loopEnd.
    const buffered = backend.buffer([new Float32Array(44_100)], 44_100);
    backend.play(buffered, { ...base, loopStart: 0.25 });
    expect(made.sources.at(-1)).toMatchObject({ loopStart: 0.25, loopEnd: 1 });
    backend.play(buffered, { ...base, loopStart: 0.5, loopEnd: 3 });
    expect(made.sources.at(-1)).toMatchObject({ loopStart: 0.5, loopEnd: 1 });
    const whole = backend.play(buffered, { ...base, loopStart: 2 });
    expect(made.sources.at(-1)).toMatchObject({ loopStart: 0, loopEnd: 1 });
    (context as unknown as { currentTime: number }).currentTime = 2.5;
    expect(whole.position()).toBeCloseTo(0.5);

    // The same start past an 8 s stream's end loops the whole file, from 0.
    const streamed = backend.stream("song.ogg");
    const pastEnd = backend.play(streamed, { ...base, loopStart: 9 });
    element.currentTime = 8;
    element.dispatchEvent(new Event("ended"));
    expect(element.currentTime).toBe(0);
    expect(pastEnd.ended).toBe(false);
    pastEnd.stop();

    // A loop end past it jumps back at the file's end.
    backend.play(streamed, { ...base, loopStart: 1, loopEnd: 12 });
    element.currentTime = 8;
    element.dispatchEvent(new Event("timeupdate"));
    expect(element.currentTime).toBe(1);
  });

  it("over an offline context: no latency, running once unlocked, a mono destination left as is", async () => {
    const { context } = fakeContext({ offline: true, channels: 1 });
    const backend = webAudioBackend({ context });
    expect(backend.latency).toBe(0);
    expect(backend.state).toBe("locked");
    await backend.unlock();
    expect(backend.state).toBe("running");
    expect(() => backend.stream("x.ogg")).not.toThrow();
  });
});

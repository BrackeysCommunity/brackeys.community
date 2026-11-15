// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { MUSIC_DRIFT_LIMIT_MS } from "../audio/clock";
import { fakeAudioBackend, type FakeAudioBackend, type FakeAudioLogEntry } from "../audio/fake";
import { renderSynth, synthDurationMs, SYNTH_SAMPLE_RATE } from "../audio/synth";
import {
  createAudioSystem,
  pickSoundVariant,
  soundRate,
  type AudioSystemOptions,
} from "../audio/system";
import { soundTriggers } from "../audio/triggers";
import type { AudioClipHandle, Voice, VoiceOptions } from "../audio/types";
import { tryWebAudioBackend } from "../audio/web-audio";
import type { BehaviorSystem } from "../game/behaviors";
import type { AudioBlock, AudioHandle } from "../game/behaviors/audio";
import { defineEntityType, createRegistry, defineGame } from "../game/define";
import { tagsField } from "../game/fields";
import { primitiveFields } from "../game/primitives";
import type { EngineContext, GameDefinition, Registry } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { memoryRuntimeView } from "../headless/runtime-view";
import { browserPrefsStore, memoryPrefsStore, PREF_KEYS, snapshotPrefsStore } from "../prefs";
import type { AssetInfo } from "../project/asset-info";
import { docKindJsonSchema, parseAssetDoc, type KindEnv } from "../project/kinds";
import { audioBuses, soundKind, type SoundFile } from "../project/kinds/sound";
import type { SynthFile } from "../project/kinds/synth";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry, AssetId } from "../project/types";
import { projectView } from "../project/view";
import { audioVoiceKey, createAudioBehaviorSystem } from "../runtime/behaviors/audio";
import type { Pose } from "../runtime/poses";
import type { AudioRequest } from "../runtime/present";
import { createSceneRuntime } from "../runtime/runtime";
import { CONTACT_START, type StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import { createPropSystem } from "../systems/bodies";
import type { RapierModule } from "../types";

vi.mock("../audio/synth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audio/synth")>();
  return { ...actual, renderSynth: vi.fn(actual.renderSynth) };
});

const plain = createRegistry(null);
const ambient = createRegistry(
  defineGame({
    id: "ambient",
    types: [],
    actions: [],
    audio: { buses: [{ name: "ambience", volume: 0.5 }] },
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const sound = (over: Partial<SoundFile> = {}): SoundFile => ({
  kind: "sound",
  v: 1,
  bus: "sfx",
  variants: [{ clip: "hit-1", weight: 2 }, { clip: "hit-2" }],
  ...over,
});

const parse = (file: unknown, registry: Registry = plain) =>
  parseAssetDoc(soundKind, JSON.stringify(file, null, 2), { registry, project: null });

const asset = (id: string, kind: string): AssetEntry => ({
  key: `k-${id}`,
  id,
  kind,
  path: `sounds/${id}.${kind}`,
  created: { at: 0, by: "t" },
});
const project = projectView({
  meta: { projectId: "p", layout: 2, name: "P" },
  assets: {
    "k-hit-1": asset("hit-1", "audio"),
    "k-hit-2": asset("hit-2", "audio"),
    "k-blip": asset("blip", "synth"),
  },
  history: {},
  code: {},
  build: {},
});
const env: KindEnv = { registry: plain, project };

describe("the sound kind's schema", () => {
  it("reads the spec's sample", () => {
    const result = parse({
      ...sound({ volume: 0.8, pitch: [0.95, 1.05], cooldownMs: 40, maxVoices: 4 }),
      positional: true,
      caption: "caption.hit",
      on: [
        { event: "contact:start", type: "crate" },
        { event: "anim:frame", data: { event: "swing" } },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("refuses a bus neither the engine nor the game has as sound-bus-unknown, on its line", () => {
    const result = parse(sound({ bus: "ambience" }));
    expect(result.ok).toBe(false);
    const [issue] = result.issues;
    expect(issue).toMatchObject({
      code: "sound-bus-unknown",
      severity: "error",
      path: "/bus",
      line: 4,
      got: "ambience",
      expected: "master | music | sfx | voice | ui",
    });
    expect(issue?.hint).toContain("GameDefinition.audio.buses");
    expect(parse(sound({ bus: "musik" })).issues[0]?.message).toContain('did you mean "music"');
  });

  it("takes a bus the game declares, and every engine bus", () => {
    expect(parse(sound({ bus: "ambience" }), ambient).issues).toEqual([]);
    for (const bus of audioBuses(plain)) expect(parse(sound({ bus })).issues).toEqual([]);
  });

  it("lists the registry's buses in the generated schema", () => {
    const bus = (registry: Registry) =>
      JSON.stringify(
        (docKindJsonSchema(soundKind, { registry, project: null }).properties as { bus: unknown })
          .bus,
      );
    expect(bus(plain)).toContain("master, music, sfx, voice, ui;");
    expect(bus(ambient)).toContain("ui, ambience;");
  });

  it("keys variants by clip: a clip named twice is a dup-id", () => {
    const result = parse(sound({ variants: [{ clip: "hit-1" }, { clip: "hit-1", weight: 3 }] }));
    expect(result.issues).toMatchObject([
      { code: "dup-id", path: "/variants/1/clip", entityIds: ["hit-1"] },
    ]);
  });

  it("takes a caption only as a string key, and matchers only with an event", () => {
    expect(parse(sound({ caption: "Caption Hit!" })).issues[0]).toMatchObject({
      code: "schema",
      path: "/caption",
    });
    expect(parse(sound({ on: [{ event: "" }] })).issues[0]).toMatchObject({
      code: "schema",
      path: "/on/0/event",
    });
    expect(parse(sound({ on: [{ event: "hit", tag: "crate", data: { n: 1 } }] })).issues).toEqual(
      [],
    );
    expect(parse({ ...sound(), on: [{ event: "hit", speed: 2 }] }).issues[0]).toMatchObject({
      code: "unknown-key",
      path: "/on/0/speed",
    });
  });

  it("caps a sound doc at 32 KiB and 64 items", () => {
    expect(soundKind.limits).toEqual({ maxStateBytes: 32_768, maxItems: 64 });
  });
});

describe("the sound kind's references", () => {
  it("names each variant's clip as an audio clip or a synth patch", () => {
    const file = sound({ variants: [{ clip: "hit-1" }, { clip: "blip" }] });
    expect(soundKind.refs(file)).toEqual([
      { pointer: "/variants/0/clip", id: "hit-1", kinds: ["audio", "synth"] },
      { pointer: "/variants/1/clip", id: "blip", kinds: ["audio", "synth"] },
    ]);
  });

  it("bundles nothing without preload", () => {
    expect(soundKind.bundleRefs(sound(), env)).toEqual([]);
    expect(soundKind.bundleRefs(sound({ preload: false }), env)).toEqual([]);
  });

  it("bundles the audio clips with preload, and never a synth patch", () => {
    const file = sound({
      preload: true,
      variants: [{ clip: "hit-1" }, { clip: "blip" }, { clip: "hit-2" }],
    });
    expect(soundKind.bundleRefs(file, env)).toEqual([
      { pointer: "/variants/0/clip", id: "hit-1", kinds: ["audio", "synth"] },
      { pointer: "/variants/2/clip", id: "hit-2", kinds: ["audio", "synth"] },
    ]);
  });
});

// ─── The audio system ────────────────────────────────────

const TICK_MS = 1000 / 60;

const patch = (over: Partial<SynthFile> = {}): SynthFile => ({
  kind: "synth",
  v: 1,
  wave: "square",
  freq: 440,
  sustainMs: 50,
  decayMs: 50,
  ...over,
});

const patchLength = (p: SynthFile) => Math.round((synthDurationMs(p) * SYNTH_SAMPLE_RATE) / 1000);

type Docs = { sound?: Record<string, SoundFile>; synth?: Record<string, SynthFile> };

/** A runtime view over sound and synth docs, and audio blobs by id. */
function audioProject(docs: Docs, clips: readonly string[] = []): ProjectRuntimeView {
  const base = memoryRuntimeView({ docs: { sound: docs.sound ?? {}, synth: docs.synth ?? {} } });
  const infos = new Map<AssetId, AssetInfo>(
    clips.map((id) => [id, { id, kind: "audio", sha256: `sha-${id}`, bytes: 64 }]),
  );
  return { ...base, asset: (id) => infos.get(id) };
}

type Rig = {
  backend: FakeAudioBackend;
  system: ReturnType<typeof createAudioSystem>;
  events: string[];
  poses: Map<string, Pose>;
  fetched: string[];
};

function rig(
  project: ProjectRuntimeView,
  over: Partial<AudioSystemOptions> & { unlocked?: boolean } = {},
): Rig {
  const backend = (over.backend as FakeAudioBackend | undefined) ?? fakeAudioBackend();
  const events: string[] = [];
  const poses = new Map<string, Pose>();
  const fetched: string[] = [];
  const system = createAudioSystem({
    project,
    registry: plain,
    fetchClip: async (id) => {
      fetched.push(id);
      return new ArrayBuffer(64);
    },
    clipUrl: (id) => `/clips/${id}`,
    poses: { get: (id) => poses.get(id) },
    prefs: memoryPrefsStore(),
    gameId: "audio-test",
    tickMs: TICK_MS,
    reducedMotion: () => false,
    emit: (event) => void events.push(event),
    ...over,
    backend,
  });
  if (over.unlocked !== false) void backend.unlock();
  return { backend, system, events, poses, fetched };
}

const ops = (log: readonly FakeAudioLogEntry[], op: FakeAudioLogEntry["op"]) =>
  log.filter((c) => c.op === op);
const plays = (log: readonly FakeAudioLogEntry[]) =>
  log.filter((c): c is Extract<FakeAudioLogEntry, { op: "play" }> => c.op === "play");
const playReq = (sound: string, extra: Partial<Extract<AudioRequest, { op: "play" }>> = {}) =>
  ({ op: "play", sound, ...extra }) as AudioRequest;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const hit = (tick: number, data?: unknown): StepEvent => ({
  tick,
  type: "hit",
  at: { x: 0, y: 0 },
  ...(data !== undefined ? { data } : {}),
});

afterEach(() => {
  vi.mocked(renderSynth).mockClear();
});

describe("the sound triggers", () => {
  it("match each event in sound-id order, one play per sound, by type, tag and data", () => {
    const project = audioProject({
      sound: {
        zeta: sound({ on: [{ event: "hit" }, { event: "hit", data: { hard: true } }] }),
        alpha: sound({ on: [{ event: "hit", type: "crate" }] }),
        mid: sound({ on: [{ event: "hit", tag: "loud" }] }),
        quiet: sound({ on: [{ event: "hit", data: { hard: true } }] }),
      },
    });
    const entity = (id: string) =>
      id === "c1" ? { type: "crate", tags: new Set(["loud"]) } : undefined;
    const triggers = soundTriggers(project, entity);
    expect(triggers.match({ ...hit(1, { hard: true }), entityId: "c1" })).toEqual([
      "alpha",
      "mid",
      "quiet",
      "zeta",
    ]);
    expect(triggers.match(hit(1, { hard: false }))).toEqual(["zeta"]);
    expect(soundTriggers(project).match({ ...hit(1), entityId: "c1" })).toEqual(["zeta"]);
    expect(triggers.match({ ...hit(1), type: "miss" })).toEqual([]);
  });
});

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

const CRATE = defineEntityType({
  type: "crate",
  description: "A tagged prop.",
  base: "prop",
  fields: (env) => ({ ...primitiveFields("prop", env), tags: tagsField("Labels.") }),
  system: (ctx, type) => createPropSystem(ctx, type),
});
const crates: GameDefinition = defineGame({
  id: "crates",
  types: [CRATE],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

const dropScene: ExpandedScene = {
  name: "drop",
  bounds: [0, 0, 1000, 1000],
  settings: {
    gravity: [0, 1200],
    physics: "rapier",
    grid: null,
    view: { projection: "orthogonal" },
  },
  entities: [
    { id: "ground", type: "solid", shape: box(500, 980, 500, 20) },
    ...[0, 1, 2, 3].map(
      (i): RuntimeEntity => ({
        id: `crate-${i}`,
        type: "crate",
        shape: box(200 + i * 150, 300 + i * 140, 20, 20),
        density: 1,
        restitution: 0,
        tags: i % 2 === 0 ? ["loud"] : [],
      }),
    ),
  ],
};

const thudProject = () =>
  audioProject({
    sound: {
      thud: sound({
        variants: [{ clip: "thud-low", weight: 2 }, { clip: "thud-high" }],
        pitch: [0.9, 1.1],
        positional: true,
        on: [{ event: CONTACT_START, type: "crate", tag: "loud" }],
      }),
    },
    synth: { "thud-low": patch({ freq: 120 }), "thud-high": patch({ freq: 240, decayMs: 80 }) },
  });

describe("the variant and rate picks", () => {
  const variants = [{ clip: "a", weight: 3 }, { clip: "b" }, { clip: "c", weight: 0.5 }];

  it("walk the weights by the roll, skipping what isn't present", () => {
    expect(pickSoundVariant(variants, () => 0)?.clip).toBe("a");
    expect(pickSoundVariant(variants, () => 3.5 / 4.5)?.clip).toBe("b");
    expect(pickSoundVariant(variants, () => 0.999)?.clip).toBe("c");
    expect(
      pickSoundVariant(
        variants,
        () => 0,
        (id) => id !== "a",
      )?.clip,
    ).toBe("b");
    expect(
      pickSoundVariant(
        variants,
        () => 0,
        () => false,
      ),
    ).toBeUndefined();
  });

  it("draw a roll only when there is a choice to make", () => {
    const roll = vi.fn(() => 0.5);
    expect(pickSoundVariant([{ clip: "a" }, { clip: "b" }], roll, (id) => id === "b")?.clip).toBe(
      "b",
    );
    expect(soundRate({}, roll)).toBe(1);
    expect(soundRate({ pitch: [1.2, 1.2] }, roll)).toBe(1.2);
    expect(roll).not.toHaveBeenCalled();
    expect(soundRate({ pitch: [0.5, 1.5] }, roll)).toBe(1);
    expect(roll).toHaveBeenCalledTimes(1);
  });
});

describe("the audio system", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  /** A playtest's step events through the system, a tick of context time per tick. */
  function playtest() {
    const registry = createRegistry(crates);
    const rt = createSceneRuntime({ rapier, view: null, game: crates, registry });
    const report = rt.load(dropScene);
    if (!report.ok) throw new Error(report.error);
    rt.ctx.contacts.watch({ type: "crate" });
    const r = rig(thudProject(), { registry, poses: rt.ctx.poses, entity: rt.get });
    const started: number[] = [];
    const playedOn: number[] = [];
    for (let i = 0; i < 150; i++) {
      const { events, tick } = rt.step(TICK_MS, []);
      const before = plays(r.backend.log).length;
      for (const e of events) {
        if (e.type === CONTACT_START && e.entityId?.startsWith("crate-")) started.push(e.tick);
      }
      r.system.tick(tick, events, []);
      r.system.frame({ centre: { x: 500, y: 500 }, halfWidth: 500 }, tick * TICK_MS);
      for (let n = plays(r.backend.log).length - before; n > 0; n--) playedOn.push(tick);
      r.backend.advance(TICK_MS / 1000);
    }
    rt.destroy();
    return { log: r.backend.log, started, playedOn };
  }

  it("plays a playtest's contact:start events on their ticks, and replays the same calls", () => {
    const first = playtest();
    const loud = first.started.length;
    expect(loud).toBeGreaterThanOrEqual(4);
    // The tagged crates (0 and 2) land; untagged ones play nothing.
    expect(first.playedOn.length).toBeGreaterThanOrEqual(2);
    expect(first.playedOn.length).toBeLessThan(loud);
    for (const tick of first.playedOn) expect(first.started).toContain(tick);
    for (const play of plays(first.log)) {
      expect(play.opts.rate).toBeGreaterThanOrEqual(0.9);
      expect(play.opts.rate).toBeLessThanOrEqual(1.1);
    }
    expect(ops(first.log, "buffer").length).toBeLessThanOrEqual(2);
    expect(playtest().log).toEqual(first.log);
  });

  it("picks variants by weight over 10,000 plays within 2%", () => {
    const { backend, system } = rig(
      audioProject({
        sound: {
          blip: sound({
            variants: [
              { clip: "a", weight: 3 },
              { clip: "b", weight: 1 },
            ],
          }),
        },
        synth: { a: patch(), b: patch({ freq: 880 }) },
      }),
    );
    for (let i = 0; i < 10_000; i++) system.tick(i, [], [playReq("blip")]);
    const buffers = ops(backend.log, "buffer") as Extract<FakeAudioLogEntry, { op: "buffer" }>[];
    expect(buffers).toHaveLength(2);
    const counts = new Map<number, number>();
    for (const p of plays(backend.log)) counts.set(p.clip, (counts.get(p.clip) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(10_000);
    const shares = [...counts.values()].map((n) => n / total).sort((a, b) => a - b);
    expect(Math.abs(shares[0]! - 0.25)).toBeLessThan(0.02);
    expect(Math.abs(shares[1]! - 0.75)).toBeLessThan(0.02);
  });

  it("drops a play inside cooldownMs of wall time", () => {
    const { backend, system } = rig(
      audioProject({
        sound: { step: sound({ variants: [{ clip: "p" }], cooldownMs: 100 }) },
        synth: { p: patch() },
      }),
    );
    system.tick(1, [], [playReq("step")]);
    backend.advance(0.05);
    system.tick(2, [], [playReq("step")]);
    backend.advance(0.05);
    system.tick(3, [], [playReq("step")]);
    expect(plays(backend.log).map((p) => p.at)).toEqual([0, 0.1]);
  });

  it("stops a sound's oldest voice past maxVoices, and applies its pitch range to a patch", () => {
    const { backend, system } = rig(
      audioProject({
        sound: { zap: sound({ variants: [{ clip: "p" }], maxVoices: 2, pitch: [0.5, 2] }) },
        synth: { p: patch({ sustainMs: 2_000 }) },
      }),
    );
    for (let i = 0; i < 4; i++) system.tick(i, [], [playReq("zap")]);
    const voices = plays(backend.log).map((p) => p.voice);
    expect(voices).toHaveLength(4);
    expect(ops(backend.log, "stop")).toEqual([
      { op: "stop", voice: voices[0], at: 0 },
      { op: "stop", voice: voices[1], at: 0 },
    ]);
    const rates = plays(backend.log).map((p) => p.opts.rate);
    for (const rate of rates) {
      expect(rate).toBeGreaterThanOrEqual(0.5);
      expect(rate).toBeLessThanOrEqual(2);
    }
    expect(new Set(rates).size).toBe(4);
    expect(ops(backend.log, "buffer")).toHaveLength(1);
  });

  it("crossfades music over fadeMs, 800 by default, and fades out on music(null)", () => {
    const { backend, system } = rig(
      audioProject({
        sound: {
          title: sound({ bus: "music", variants: [{ clip: "t" }], loop: true }),
          level: sound({ bus: "music", variants: [{ clip: "l" }], loop: true }),
        },
        synth: { t: patch(), l: patch({ freq: 220 }) },
      }),
    );
    const music = (sound: string | null, fadeMs?: number): AudioRequest => ({
      op: "music",
      sound,
      at: "start",
      tick: 0,
      ...(fadeMs !== undefined ? { fadeMs } : {}),
    });
    system.tick(1, [], [music("title")]);
    system.tick(2, [], [music("title")]);
    system.tick(3, [], [music("level", 500)]);
    system.tick(4, [], [music("title")]);
    system.tick(5, [], [music(null)]);
    const [title, level, again] = plays(backend.log);
    expect(plays(backend.log)).toHaveLength(3);
    expect(title!.opts).toMatchObject({ bus: "music", loop: true });
    expect(title!.opts.fadeInMs).toBeUndefined();
    expect(level!.opts.fadeInMs).toBe(500);
    expect(again!.opts.fadeInMs).toBe(800);
    expect(ops(backend.log, "stop").map((c) => ({ ...c, at: undefined }))).toEqual([
      { op: "stop", voice: title!.voice, fadeMs: 500, at: undefined },
      { op: "stop", voice: level!.voice, fadeMs: 800, at: undefined },
      { op: "stop", voice: again!.voice, fadeMs: 800, at: undefined },
    ]);
  });

  it("drops one-shots before unlock and starts the music asked for on unlock", async () => {
    const r = rig(
      audioProject({
        sound: {
          step: sound({ variants: [{ clip: "p" }] }),
          title: sound({ bus: "music", variants: [{ clip: "t" }], loop: true }),
        },
        synth: { p: patch(), t: patch({ freq: 220 }) },
      }),
      { unlocked: false },
    );
    r.system.tick(1, [], [playReq("step"), { op: "music", sound: "title", at: "start", tick: 1 }]);
    expect(plays(r.backend.log)).toEqual([]);
    expect(r.system.unlocked).toBe(false);
    await r.system.unlock();
    expect(r.system.unlocked).toBe(true);
    expect(r.events).toEqual(["audio:unlocked"]);
    expect(plays(r.backend.log)).toHaveLength(1);
    expect(plays(r.backend.log)[0]!.opts.bus).toBe("music");
    await r.system.unlock();
    expect(r.events).toEqual(["audio:unlocked"]);
  });

  it("keeps a keyed loop asked for before unlock and starts it on unlock, unless its key stopped", async () => {
    const r = rig(
      audioProject({
        sound: {
          hum: sound({ variants: [{ clip: "p" }], loop: true, positional: true }),
          drip: sound({ variants: [{ clip: "q" }], loop: true }),
          step: sound({ variants: [{ clip: "q" }] }),
        },
        synth: { p: patch(), q: patch({ freq: 220 }) },
      }),
      { unlocked: false },
    );
    r.poses.set("lamp", { x: 5, y: 0, rot: 0 });
    r.system.frame({ centre: { x: 0, y: 0 }, halfWidth: 10 }, 0);
    r.system.tick(
      1,
      [],
      [
        playReq("hum", { key: "lamp", entity: "lamp", volume: 0.5 }),
        playReq("drip", { key: "tap" }),
        playReq("step", { key: "feet" }),
        playReq("drip"),
      ],
    );
    r.system.tick(2, [], [{ op: "stop", key: "tap" }]);
    expect(plays(r.backend.log)).toEqual([]);
    await r.system.unlock();
    const started = plays(r.backend.log);
    expect(started.map((p) => p.opts.key)).toEqual(["lamp"]);
    expect(started[0]!.opts.loop).toBe(true);
    expect(started[0]!.opts.pan).toBe(0.5);
    expect(started[0]!.opts.volume).toBeCloseTo(0.5);
    r.system.stopAll();
    r.system.tick(3, [], []);
    expect(plays(r.backend.log)).toHaveLength(1);
  });

  it("drops a keyed loop asked for before unlock once stopAll runs", async () => {
    const r = rig(
      audioProject({
        sound: { hum: sound({ variants: [{ clip: "p" }], loop: true }) },
        synth: { p: patch() },
      }),
      { unlocked: false },
    );
    r.system.tick(1, [], [playReq("hum", { key: "lamp" })]);
    r.system.stopAll();
    await r.system.unlock();
    expect(plays(r.backend.log)).toEqual([]);
  });

  it("never picks a variant whose clip isn't in the project", () => {
    const r = rig(
      audioProject({
        sound: {
          blip: sound({
            variants: [
              { clip: "gone", weight: 100 },
              { clip: "p", weight: 1 },
            ],
          }),
        },
        synth: { p: patch() },
      }),
    );
    for (let i = 0; i < 20; i++) r.system.tick(i, [], [playReq("blip")]);
    expect(plays(r.backend.log)).toHaveLength(20);
  });

  it("counts a backend the shell unlocked itself, and one already running", () => {
    const r = rig(audioProject({}), { unlocked: false });
    void r.backend.unlock();
    r.system.frame({ centre: { x: 0, y: 0 }, halfWidth: 1 }, 0);
    expect(r.events).toEqual(["audio:unlocked"]);
    const running = rig(audioProject({}), {
      unlocked: false,
      backend: fakeAudioBackend({ state: "running" }),
    });
    expect(running.system.unlocked).toBe(true);
  });

  for (const source of ["patch", "clip"] as const) {
    it(`pans a positional ${source} sound after its entity across the view, from -1 to 1`, async () => {
      const r = rig(
        audioProject(
          {
            sound: {
              buzz: sound({ variants: [{ clip: "v" }], positional: true, loop: true, range: 40 }),
            },
            synth: source === "patch" ? { v: patch() } : {},
          },
          source === "clip" ? ["v"] : [],
        ),
      );
      r.poses.set("fly", { x: -20, y: 0, rot: 0 });
      r.system.frame({ centre: { x: 0, y: 0 }, halfWidth: 10 }, 0);
      r.system.tick(1, [], [playReq("buzz", { entity: "fly" })]);
      await flush();
      const [play] = plays(r.backend.log);
      expect(play!.opts.pan).toBe(-1);
      expect(play!.opts.volume).toBeCloseTo(0.5);
      const pans: number[] = [];
      for (const x of [-10, -5, 0, 5, 10, 50]) {
        r.poses.set("fly", { x, y: 0, rot: 0 });
        r.system.frame({ centre: { x: 0, y: 0 }, halfWidth: 10 }, 0);
      }
      for (const c of ops(r.backend.log, "pan")) pans.push((c as { pan: number }).pan);
      expect(pans).toEqual([-0.5, 0, 0.5, 1]);
      const volumes = ops(r.backend.log, "volume").map((c) => (c as { volume: number }).volume);
      expect(volumes.at(-1)).toBe(0);
      expect(volumes).toContain(1);
    });
  }

  it("keeps a sound that isn't positional centred", () => {
    const r = rig(
      audioProject({ sound: { s: sound({ variants: [{ clip: "p" }] }) }, synth: { p: patch() } }),
    );
    r.system.frame({ centre: { x: 0, y: 0 }, halfWidth: 10 }, 0);
    r.system.tick(1, [], [playReq("s", { at: { x: 10, y: 0 } })]);
    expect(plays(r.backend.log)[0]!.opts.pan).toBe(0);
  });

  it("stops voices by key", () => {
    const r = rig(
      audioProject({
        sound: { s: sound({ variants: [{ clip: "p" }], loop: true }) },
        synth: { p: patch() },
      }),
    );
    r.system.tick(1, [], [playReq("s", { key: "engine" }), playReq("s")]);
    r.system.tick(2, [], [{ op: "stop", key: "engine", fadeMs: 50 }]);
    const [keyed] = plays(r.backend.log);
    expect(keyed!.opts.key).toBe("engine");
    expect(ops(r.backend.log, "stop")).toEqual([
      { op: "stop", voice: keyed!.voice, fadeMs: 50, at: 0 },
    ]);
  });

  it("plays an audio block's one-shot again on each play through its handle", () => {
    const r = rig(
      audioProject({ sound: { s: sound({ variants: [{ clip: "p" }] }) }, synth: { p: patch() } }),
    );
    const asked: AudioRequest[] = [];
    const ctx = {
      present: {
        audio: {
          play: (sound: string, o: object = {}) =>
            void asked.push({ op: "play", sound, ...o } as AudioRequest),
          stop: (key: string) => void asked.push({ op: "stop", key }),
        },
      },
    } as unknown as EngineContext;
    const behavior = createAudioBehaviorSystem(ctx, {} as never) as BehaviorSystem<AudioBlock>;
    behavior.attach("e", { sound: "s", playing: false }, { id: "e", type: "marker" });
    const handle = behavior.handle!("e") as AudioHandle;

    handle.play();
    r.system.tick(1, [], asked.splice(0));
    r.backend.advance(1);
    handle.play();
    r.system.tick(2, [], asked.splice(0));
    expect(plays(r.backend.log)).toHaveLength(2);
    expect(plays(r.backend.log).map((p) => p.opts.key)).toEqual([
      audioVoiceKey("e"),
      audioVoiceKey("e"),
    ]);
    expect(handle.playing).toBe(true);
  });

  it("decodes an audio clip once, then plays it, and a stopAll cancels a play still decoding", async () => {
    const r = rig(audioProject({ sound: { s: sound({ variants: [{ clip: "c" }] }) } }, ["c"]));
    r.system.tick(1, [], [playReq("s")]);
    r.system.stopAll();
    await flush();
    expect(plays(r.backend.log)).toEqual([]);
    r.system.tick(2, [], [playReq("s"), playReq("s")]);
    await flush();
    expect(r.fetched).toEqual(["c"]);
    expect(ops(r.backend.log, "decode")).toHaveLength(1);
    expect(plays(r.backend.log)).toHaveLength(2);
  });

  it("a stop of a key cancels that key's play still decoding, and no other", async () => {
    const r = rig(
      audioProject({ sound: { line: sound({ variants: [{ clip: "voice-1" }] }) } }, ["voice-1"]),
    );
    r.system.tick(1, [], [playReq("line", { key: "dialogue-voice" }), playReq("line")]);
    r.system.tick(2, [], [{ op: "stop", key: "dialogue-voice" }]);
    await flush();
    expect(plays(r.backend.log).map((p) => p.opts.key)).toEqual([undefined]);
    r.system.tick(3, [], [playReq("line", { key: "dialogue-voice" })]);
    await flush();
    expect(plays(r.backend.log).map((p) => p.opts.key)).toEqual([undefined, "dialogue-voice"]);
  });

  it("wraps looping tick-aligned music on a stream once its length arrives after it plays", () => {
    const backend = fakeAudioBackend({ state: "running" });
    const clip = { duration: Number.NaN, channels: 2, streamed: true };
    // A media element loops itself: its position wraps at the clip's end once that is known.
    const streaming = Object.assign(Object.create(backend) as FakeAudioBackend, {
      stream: () => clip,
      play: (handle: AudioClipHandle, opts: VoiceOptions): Voice => {
        const voice = backend.play(handle, opts);
        return Object.assign(Object.create(voice) as Voice, {
          position: () => {
            const at = voice.position();
            return opts.loop && Number.isFinite(clip.duration) ? at % clip.duration : at;
          },
        });
      },
    });
    const song = sound({ bus: "music", loop: true, variants: [{ clip: "song" }] });
    const info: AssetInfo = { id: "song", kind: "audio", sha256: "sha-song", stream: true };
    const r = rig(
      { ...audioProject({ sound: { song } }), asset: (id) => (id === "song" ? info : undefined) },
      { backend: streaming },
    );
    r.system.tick(0, [], [{ op: "music", sound: "song", at: "tick", tick: 0 }]);
    expect(plays(backend.log)[0]?.opts.loop).toBe(true);
    clip.duration = 1;
    // The context clock runs 5% fast, so the song drifts past the limit and is sought back.
    for (let tick = 1; tick <= 150; tick++) {
      backend.advance((1.05 * TICK_MS) / 1000);
      r.system.frame({ centre: { x: 0, y: 0 }, halfWidth: 10 }, tick * TICK_MS);
    }
    const seeks = ops(backend.log, "seek") as Extract<FakeAudioLogEntry, { op: "seek" }>[];
    expect(seeks.length).toBeGreaterThan(0);
    for (const seek of seeks) {
      expect(seek.seconds).toBeGreaterThanOrEqual(0);
      expect(seek.seconds).toBeLessThan(1);
    }
    expect(Math.abs(r.system.clock.driftMs)).toBeLessThanOrEqual(MUSIC_DRIFT_LIMIT_MS);
  });
});

describe("synth playback", () => {
  it("buffers a patch variant once, one channel of its length, then plays on the trigger's tick", () => {
    const blip = patch({ attackMs: 5 });
    const r = rig(
      audioProject({
        sound: { blip: sound({ variants: [{ clip: "p" }], on: [{ event: "hit" }] }) },
        synth: { p: blip },
      }),
    );
    r.backend.advance(1);
    r.system.tick(60, [hit(60)], []);
    const calls = r.backend.log.filter((c) => c.op === "buffer" || c.op === "play");
    expect(calls).toMatchObject([
      {
        op: "buffer",
        channels: 1,
        length: patchLength(blip),
        sampleRate: SYNTH_SAMPLE_RATE,
        at: 1,
      },
      { op: "play", at: 1, opts: { bus: "sfx", rate: 1, pan: 0, loop: false } },
    ]);
    expect(calls[1]).toMatchObject({ clip: (calls[0] as { clip: number }).clip });
    expect(vi.mocked(renderSynth)).toHaveBeenCalledTimes(1);
  });

  it("reuses the buffer on a second play, and buffers again once the patch's doc changes", () => {
    const docs = (p: SynthFile) => ({
      sound: { blip: sound({ variants: [{ clip: "p" }] }) },
      synth: { p },
    });
    const r = rig(audioProject(docs(patch())));
    r.system.tick(1, [], [playReq("blip")]);
    r.system.tick(2, [], [playReq("blip")]);
    expect(ops(r.backend.log, "buffer")).toHaveLength(1);
    r.system.reload(audioProject(docs(patch())));
    r.system.tick(3, [], [playReq("blip")]);
    expect(ops(r.backend.log, "buffer")).toHaveLength(1);
    const longer = patch({ decayMs: 300 });
    r.system.reload(audioProject(docs(longer)));
    r.system.tick(4, [], [playReq("blip")]);
    const buffers = ops(r.backend.log, "buffer");
    expect(buffers).toHaveLength(2);
    expect(buffers[1]).toMatchObject({ length: patchLength(longer) });
    expect(plays(r.backend.log).at(-1)!.clip).toBe((buffers[1] as { clip: number }).clip);
  });

  it("rebuilds the triggers on a doc change", () => {
    const docs = (event: string) => ({
      sound: { blip: sound({ variants: [{ clip: "p" }], on: [{ event }] }) },
      synth: { p: patch() },
    });
    const r = rig(audioProject(docs("hit")));
    r.system.tick(1, [hit(1)], []);
    r.system.reload(audioProject(docs("miss")));
    r.system.tick(2, [hit(2)], []);
    expect(plays(r.backend.log)).toHaveLength(1);
  });

  it("buffers a preload sound's patches at load, before any play", () => {
    const r = rig(
      audioProject({
        sound: {
          ready: sound({ variants: [{ clip: "a" }, { clip: "b" }], preload: true }),
          lazy: sound({ variants: [{ clip: "c" }] }),
        },
        synth: { a: patch(), b: patch({ freq: 660 }), c: patch({ freq: 990 }) },
      }),
    );
    expect(ops(r.backend.log, "buffer")).toHaveLength(2);
    expect(plays(r.backend.log)).toEqual([]);
  });

  it("picks between a clip and a patch by weight", async () => {
    const r = rig(
      audioProject(
        {
          sound: {
            mix: sound({
              variants: [
                { clip: "c", weight: 1 },
                { clip: "p", weight: 4 },
              ],
            }),
          },
          synth: { p: patch() },
        },
        ["c"],
      ),
    );
    for (let i = 0; i < 10_000; i++) r.system.tick(i, [], [playReq("mix")]);
    await flush();
    const [buffered] = ops(r.backend.log, "buffer") as { clip: number }[];
    const all = plays(r.backend.log);
    expect(all).toHaveLength(10_000);
    const patchShare = all.filter((p) => p.clip === buffered!.clip).length / all.length;
    expect(Math.abs(patchShare - 0.8)).toBeLessThan(0.02);
    expect(ops(r.backend.log, "decode")).toHaveLength(1);
  });

  it("never renders a patch headless", async () => {
    const rapier = await import("@dimforge/rapier2d");
    const headless = createHeadlessRuntime({
      rapier,
      game: crates,
      scene: dropScene,
      project: thudProject(),
    });
    try {
      headless.ctx.contacts.watch({ type: "crate" });
      let started = 0;
      for (let i = 0; i < 150; i++) {
        const { events } = headless.step(TICK_MS, []);
        started += events.filter((e) => e.type === CONTACT_START).length;
      }
      expect(started).toBeGreaterThan(0);
      expect(vi.mocked(renderSynth)).not.toHaveBeenCalled();
    } finally {
      headless.destroy();
    }
  });
});

describe("bus volumes", () => {
  const key = "jams-engine:prefs:audio-test";
  let restore: (() => void) | null = null;

  /** Puts `storage` (or a getter that throws) at globalThis.localStorage for one test. */
  function withStorage(storage: Storage | "throws"): void {
    const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        if (storage === "throws") throw new DOMException("denied", "SecurityError");
        return storage;
      },
    });
    restore = () => {
      if (had) Object.defineProperty(globalThis, "localStorage", had);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    };
  }

  function memoryStorage(opts: { full?: boolean } = {}): Storage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (k) => data.get(k) ?? null,
      key: (i) => [...data.keys()][i] ?? null,
      removeItem: (k) => void data.delete(k),
      setItem: (k, v) => {
        if (opts.full) throw new DOMException("full", "QuotaExceededError");
        data.set(k, v);
      },
    };
  }

  afterEach(() => {
    restore?.();
    restore = null;
  });

  const busRig = (registry: Registry = plain) =>
    rig(audioProject({}), { prefs: browserPrefsStore(), registry });

  it("persist through browserPrefsStore under audio.bus.<bus>, beside other prefs", () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ locale: "fr" }));
    withStorage(storage);
    const first = busRig(ambient);
    expect(Object.keys(first.system.buses())).toEqual([...audioBuses(ambient)]);
    expect(first.system.buses().ambience).toEqual({ volume: 0.5, muted: false });
    first.system.setBus("music", 0.25);
    first.system.setBus("sfx", 0.8, true);
    first.system.setBus("nowhere", 0.1);
    expect(first.backend.busVolumes.get("music")).toBe(0.25);
    expect(first.backend.busVolumes.get("sfx")).toBe(0);
    const saved = JSON.parse(storage.data.get(key)!) as Record<string, unknown>;
    expect(saved.locale).toBe("fr");
    expect(saved["audio.bus.music"]).toEqual({ volume: 0.25, muted: false });
    expect(saved).not.toHaveProperty(PREF_KEYS.busKey("nowhere"));

    const second = busRig(ambient);
    expect(second.system.buses().music).toEqual({ volume: 0.25, muted: false });
    expect(second.system.buses().sfx).toEqual({ volume: 0.8, muted: true });
    expect(second.backend.busVolumes.get("sfx")).toBe(0);
    expect(second.backend.busVolumes.get("music")).toBe(0.25);
  });

  it("keep a bus named like another preference apart from it", () => {
    const named = createRegistry(
      defineGame({
        id: "named",
        types: [],
        actions: [],
        audio: { buses: [{ name: "latencyMs" }, { name: "locale" }] },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const prefs = memoryPrefsStore();
    prefs.save("audio-test", { [PREF_KEYS.latencyMs]: 40, [PREF_KEYS.locale]: "fr" });
    const r = rig(audioProject({}), { prefs, registry: named });
    expect(r.system.buses().latencyMs).toEqual({ volume: 1, muted: false });
    r.system.setBus("latencyMs", 0.5);
    r.system.setBus("locale", 0.2);
    expect(prefs.load("audio-test")).toEqual({
      [PREF_KEYS.latencyMs]: 40,
      [PREF_KEYS.locale]: "fr",
      "audio.bus.latencyMs": { volume: 0.5, muted: false },
      "audio.bus.locale": { volume: 0.2, muted: false },
    });
  });

  it("still apply for the session when localStorage throws on every access", () => {
    withStorage("throws");
    const r = busRig();
    expect(() => r.system.setBus("music", 0.3)).not.toThrow();
    expect(r.system.buses().music).toEqual({ volume: 0.3, muted: false });
    expect(r.backend.busVolumes.get("music")).toBe(0.3);
    expect(browserPrefsStore().load("audio-test")).toEqual({});
  });

  it("still apply when storage is full, and read a stored value that isn't an object as none", () => {
    const storage = memoryStorage({ full: true });
    withStorage(storage);
    const r = busRig();
    expect(() => r.system.setBus("ui", 0.4)).not.toThrow();
    expect(r.system.buses().ui.volume).toBe(0.4);
    storage.data.set(key, "[1,2]");
    expect(browserPrefsStore().load("audio-test")).toEqual({});
    storage.data.set(key, "{not json");
    expect(browserPrefsStore().load("audio-test")).toEqual({});
  });
});

describe("snapshotPrefsStore", () => {
  it("loads the host's snapshot, then the latest change, and hands a run of changes back once", () => {
    vi.useFakeTimers();
    try {
      const saved: unknown[] = [];
      const store = snapshotPrefsStore(
        { "audio.bus.music": { volume: 0.5, muted: false } },
        (id, p) => saved.push([id, p]),
      );
      expect(store.load("g")).toEqual({ "audio.bus.music": { volume: 0.5, muted: false } });
      store.save("g", { "audio.bus.music": { volume: 0.4, muted: false } });
      store.save("g", { "audio.music": { volume: 0.3, muted: false } });
      expect(store.load("g")).toEqual({ "audio.music": { volume: 0.3, muted: false } });
      expect(saved).toEqual([]);
      vi.advanceTimersByTime(500);
      expect(saved).toEqual([["g", { "audio.music": { volume: 0.3, muted: false } }]]);
      expect(snapshotPrefsStore([1], () => {}).load("g")).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("tryWebAudioBackend", () => {
  it("is false where the browser has no Web Audio or its context can't start", () => {
    expect(typeof globalThis.AudioContext).toBe("undefined");
    expect(tryWebAudioBackend()).toBe(false);
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new DOMException("no device", "NotSupportedError");
        }
      },
    );
    try {
      expect(tryWebAudioBackend()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

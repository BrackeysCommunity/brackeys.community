// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { oneSceneVersion } from "../../__tests__/fixtures/live-version";
import { createRegistry, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { SceneLibrary } from "../../game/flow";
import type { SwapTiming } from "../../game/live";
import type { GameDefinition, GameRuntime, Registry, SceneSystem } from "../../game/types";
import { findSceneVersion } from "../../project/scene-version";
import { liveSwapLog, preparedVersion } from "../../runtime/live";
import { createRunRecorder, recordedSwap } from "../../runtime/recorder";
import { expandScene } from "../../scene/expand";
import { parseRecording, type RunRecording } from "../../scene/recording-schema";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type RuntimeEntity,
  type SceneDefinition,
} from "../../scene/types";
import type { RapierModule, StagedVersion } from "../../types";
import { createHeadlessRuntime } from "../headless";
import { prepareRun, runLoop, startRun } from "../play-loop";
import { replayRecording, type ReplayReport, type ReplayRun } from "../recording";
import { V1_FIXTURES } from "./fixtures/recordings/v1";
import { readV1Recording } from "./fixtures/recordings/v1/runs";

const GAME = "swap-yard";
const WALKER = `${GAME}-walker`;
const SCENE = "yard";
const TICKS = 400;
const NOW_AT = 240;
const BOUNDARY_ASKED = 260;
/** The tick game code calls `ctx.live.boundary()` in. */
const BOUNDARY_TICK = 300;

type Walker = RuntimeEntity<{ at: Pt; speed: number }>;

/**
 * Walkers that step right at their speed, and a score drawn from `ctx.random`,
 * so a swap moves the end digest; `cellarAtLoad` attaches the cellar in `onLoad`.
 */
function swapGame(
  opts: {
    restartAt?: number;
    physics?: "none" | "rapier";
    cellarAtLoad?: boolean;
    /** Gets `ctx.live.version` as each `onLoad` reads it. */
    versionAtLoad?: (version: string | null) => void;
  } = {},
): GameDefinition {
  return defineGame({
    id: GAME,
    world: { physics: opts.physics ?? "none" },
    actions: [],
    live: { timings: ["next-load", "boundary", "now"] },
    types: [
      {
        type: WALKER,
        description: "A point that walks right.",
        fields: {
          at: pointField("Where it starts."),
          speed: z.number().default(1).describe("Metres a second."),
        },
        system: (ctx): SceneSystem<Walker> => {
          const walkers = new Map<string, { x: number; speed: number }>();
          return {
            spawn(e) {
              walkers.set(e.id, { x: e.at[0], speed: e.speed });
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            despawn: (id) => void walkers.delete(id),
            clear: () => walkers.clear(),
            size: () => walkers.size,
            beforeStep(dtMs) {
              for (const [id, w] of walkers) {
                w.x += (w.speed * dtMs) / 1000;
                ctx.poses.set(id, w.x, ctx.poses.get(id)!.y, 0);
              }
            },
            save: (id) => {
              const w = walkers.get(id);
              return w ? { x: w.x } : undefined;
            },
            restore(id, state) {
              const w = walkers.get(id);
              if (w) w.x = (state as { x: number }).x;
            },
          };
        },
      },
    ],
    createRuntime(ctx) {
      let score = 0;
      const runtime: GameRuntime<{ score: number; xs: [string, number][] }> = {
        onLoad() {
          opts.versionAtLoad?.(ctx.live.version);
          if (opts.cellarAtLoad) ctx.flow.attach(CELLAR, { label: "low" });
        },
        afterStep() {
          score += ctx.random.below(10);
          if (ctx.tick === BOUNDARY_TICK) ctx.live.boundary("checkpoint");
          if (ctx.tick === opts.restartAt) ctx.flow.request({ to: SCENE });
        },
        snapshot: () => ({
          score,
          xs: ctx.query
            .select()
            .map((id): [string, number] => [id, ctx.poses.get(id)?.x ?? 0])
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        }),
        restore: (s) => void (score = s.score),
      };
      return runtime;
    },
  });
}

function yard(edit: (def: SceneDefinition) => void = () => {}): SceneDefinition {
  const entities: EntityDef[] = [
    { id: "w1", type: WALKER, at: [1, 1], speed: 1 },
    { id: "w2", type: WALKER, at: [2, 2], speed: 1 },
  ];
  const def: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: SCENE,
    game: GAME,
    bounds: [0, 0, 40, 10],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
  };
  edit(def);
  return def;
}

/** w1 walks twice as fast: an entity edit, so the swap reconciles. */
const faster = (def: SceneDefinition) =>
  void (def.entities![0] = { ...def.entities![0]!, speed: 2 } as EntityDef);
/** Wider bounds and a third walker: a header edit, so the swap reloads. */
const wider = (def: SceneDefinition) => {
  faster(def);
  def.bounds = [0, 0, 60, 10];
  def.entities!.push({ id: "w3", type: WALKER, at: [3, 3] });
};

/** A version of the yard as a host fetched it. */
const versionOf = (def: SceneDefinition, game: GameDefinition, physics?: "none" | "rapier") =>
  oneSceneVersion(def, game, physics ? { physics } : {});

const libraryOf = (def: SceneDefinition): SceneLibrary => ({
  list: [{ scene: SCENE }],
  scenes: new Map([[SCENE, { def, prefabs: new Map() }]]),
});

const CELLAR = "cellar";

/** A sublevel beside the yard: one walker, `c1`, and whatever `edit` adds. */
function cellar(edit: (def: SceneDefinition) => void = () => {}): SceneDefinition {
  const def: SceneDefinition = {
    ...yard(),
    name: CELLAR,
    bounds: [0, 0, 10, 10],
    entities: [{ id: "c1", type: WALKER, at: [1, 5], speed: 1 }],
  };
  edit(def);
  return def;
}

/** The yard's library with the cellar listed as a sublevel. */
const cellarLibrary = (): SceneLibrary => ({
  list: [{ scene: SCENE }, { scene: CELLAR, sublevel: true }],
  scenes: new Map([
    [SCENE, { def: yard(), prefabs: new Map() }],
    [CELLAR, { def: cellar(), prefabs: new Map() }],
  ]),
});

type Activation = { at: number; version: StagedVersion; timing: SwapTiming };

/**
 * Plays the yard headless for `TICKS` ticks through the live layer the
 * replay uses, recorded by the run recorder, staging and activating each
 * version after the tick `at` names.
 */
function recordRun(
  game: GameDefinition,
  registry: Registry,
  activations: readonly Activation[],
  on: {
    def?: SceneDefinition;
    rapier?: RapierModule;
    library?: SceneLibrary;
    /** Versions of other listed scenes active before the load, recorded as the shell records them. */
    sublevels?: readonly StagedVersion[];
    /** Versions of other listed scenes activated after the load, before the first step. */
    afterLoad?: readonly StagedVersion[];
  } = {},
): RunRecording {
  const def = on.def ?? yard();
  const rapier = on.rapier ?? null;
  const prepared = prepareRun(def, registry);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.blocked));
  const started = startRun({
    rapier,
    game,
    registry,
    scene: prepared.scene,
    play: {},
    flow: { scene: SCENE, entry: null, library: on.library ?? libraryOf(def) },
    beforeLoad(live) {
      for (const v of on.sublevels ?? []) {
        const read = preparedVersion(v, registry, game);
        if (!read.ok) throw new Error(JSON.stringify(read.issues));
        live.stage(read.prepared);
        live.activate(v.version.scene, v.id, "next-load");
      }
      return null;
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started.load));
  const { runtime, live } = started;
  const recorder = createRunRecorder({
    rapier,
    game,
    registry,
    scene: def.name,
    sceneHash: prepared.hash,
    runHash: prepared.runHash,
    start: {},
    entry: null,
    sceneVersion: runtime.ctx.live.version,
    time: runtime.ctx.time,
    players: runtime.ctx.input.players(),
  });
  const log = liveSwapLog(runtime.ctx.tick, live.liveSublevels());
  for (const swap of log.start) recorder.swap(recordedSwap(swap));
  live.onApplied((swap) => {
    for (const s of log.next(swap)) recorder.swap(recordedSwap(s));
  });
  for (const v of on.afterLoad ?? []) {
    const read = preparedVersion(v, registry, game);
    if (!read.ok) throw new Error(JSON.stringify(read.issues));
    live.stage(read.prepared);
    live.activate(v.version.scene, v.id, "next-load");
  }
  try {
    const end = runLoop({
      runtime,
      game,
      maxTicks: TICKS,
      input: { done: () => false },
      everySlot: true,
      live,
      onTick(state, focus, _edges, _commands, input) {
        recorder.tick(state, input, focus);
        for (const a of activations) {
          if (a.at !== state.tick) continue;
          const read = preparedVersion(a.version, registry, game);
          if (!read.ok) throw new Error(JSON.stringify(read.issues));
          expect(live.stage(read.prepared).ok).toBe(true);
          live.activate(SCENE, a.version.id, a.timing);
        }
      },
    });
    return recorder.finish(end, runtime.snapshot());
  } finally {
    runtime.destroy();
  }
}

function replayed(run: ReplayRun): ReplayReport {
  if (run.blocked) throw new Error(JSON.stringify(run, null, 2));
  return run;
}

describe("replaying a run with live swaps", () => {
  let game: GameDefinition;
  let registry: Registry;
  let v1: StagedVersion;
  let v2: StagedVersion;
  let recording: RunRecording;
  const held = () => [v1, v2];
  const replay = (rec: unknown, versions?: (id: string) => StagedVersion | null) =>
    replayRecording({
      game,
      registry,
      scene: yard(),
      flow: libraryOf(yard()),
      recording: rec,
      ...(versions ? { versions } : {}),
    });

  beforeAll(async () => {
    game = swapGame();
    registry = createRegistry(game);
    v1 = await versionOf(yard(faster), game);
    v2 = await versionOf(yard(wider), game);
    recording = recordRun(game, registry, [
      { at: NOW_AT - 1, version: v1, timing: "now" },
      { at: BOUNDARY_ASKED, version: v2, timing: "boundary" },
    ]);
  });

  it("records a now swap at its tick and a boundary swap after the tick that called boundary()", () => {
    expect(recording.ticks).toBe(TICKS);
    expect(recording.sceneVersion).toBeUndefined();
    expect(
      recording.swaps?.map(({ tick, version, strategy, timing }) => ({
        tick,
        version,
        strategy,
        timing,
      })),
    ).toEqual([
      { tick: NOW_AT, version: v1.id, strategy: "reconcile", timing: "now" },
      { tick: BOUNDARY_TICK + 1, version: v2.id, strategy: "reload", timing: "boundary" },
    ]);
    expect(parseRecording(recording, registry).ok).toBe(true);
  });

  it("replays to the same end digest through the same swaps", () => {
    const report = replayed(replay(recording, (id) => findSceneVersion(id, held())));
    expect(report.divergence).toBeNull();
    expect(report.matches).toBe(true);
    expect(report.stale).toBe(false);
    expect(report.recording.end).toBe(recording.end);
    expect(report.recording.swaps).toEqual(recording.swaps);
  });

  it("ends elsewhere without its swaps: they shape the run", () => {
    const { swaps: _, ...without } = recording;
    const report = replayed(replay(without));
    expect(report.matches).toBe(false);
    expect(report.recording.end).not.toBe(recording.end);
  });

  it("stops at the tick of a swap whose version is gone, with scene-version-removed", () => {
    const report = replayed(replay(recording, (id) => findSceneVersion(id, [v1])));
    expect(report.matches).toBe(false);
    expect(report.recording.ticks).toBe(BOUNDARY_TICK + 1);
    expect(report.recording.swaps?.map((s) => s.version)).toEqual([v1.id]);
    const removed = report.issues.filter((i) => i.code === "scene-version-removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      severity: "error",
      path: "/swaps/1/version",
      detail: { tick: BOUNDARY_TICK + 1 },
    });
    expect(removed[0]!.message).toContain(`${SCENE}@${v2.id.slice(0, 12)}`);
    expect(report.divergence).toContain(`tick ${BOUNDARY_TICK + 1}`);
  });

  it("is stale from a swap the replay makes with another strategy or run hash", () => {
    const strategy = structuredClone(recording);
    strategy.swaps![1]!.strategy = "reconcile";
    const byStrategy = replayed(replay(strategy, (id) => findSceneVersion(id, held())));
    expect(byStrategy.stale).toBe(true);
    expect(byStrategy.staleFrom).toBe(BOUNDARY_TICK + 1);
    expect(byStrategy.warnings.join("\n")).toContain("reloaded where the recorded run reconciled");

    const hash = structuredClone(recording);
    hash.swaps![0]!.runHash = "0".repeat(16);
    const byHash = replayed(replay(hash, (id) => findSceneVersion(id, held())));
    expect(byHash.stale).toBe(true);
    expect(byHash.staleFrom).toBe(NOW_AT);
    expect(byHash.matches).toBe(true);
  });

  it("doesn't start a recording that starts on a version it can't find", () => {
    const onV1 = { ...recording, sceneVersion: v1.id, swaps: [] };
    const run = replay(onV1, (id) => findSceneVersion(id, [v2]));
    expect(run.blocked).toBe(true);
    if (!run.blocked) return;
    expect(run.stage).toBe("load");
    expect(run.issues).toHaveLength(1);
    expect(run.issues[0]).toMatchObject({
      code: "scene-version-removed",
      severity: "error",
      path: "/sceneVersion",
    });
    expect(run.issues[0]!.detail).toBeUndefined();
    expect(replay(onV1).blocked).toBe(true);
  });

  it("starts a recording on its version, judging staleness against that start", () => {
    const { swaps: _, ...plain } = recording;
    const onV1 = { ...plain, sceneVersion: v1.id };
    const first = replayed(replay(onV1, (id) => findSceneVersion(id, held())));
    // Recorded on the release's scene, so its start's run hash is the release's, not v1's.
    expect(first.stale).toBe(true);
    expect(first.staleFrom).toBeUndefined();
    expect(first.recording.sceneVersion).toBe(v1.id);
    expect(first.recording.runHash).not.toBe(recording.runHash);

    const again = replayed(replay(first.recording, (id) => findSceneVersion(id, held())));
    expect(again.stale).toBe(false);
    expect(again.matches).toBe(true);
    expect(again.recording.end).toBe(first.recording.end);
  });

  it("replays a recording without the keys as before, and records neither key", () => {
    const plain = recordRun(game, registry, []);
    expect(plain).not.toHaveProperty("sceneVersion");
    expect(plain).not.toHaveProperty("swaps");
    const report = replayed(replay(plain));
    expect(report.matches).toBe(true);
    expect(report.stale).toBe(false);
    expect(report.recording).not.toHaveProperty("sceneVersion");
    expect(report.recording).not.toHaveProperty("swaps");
    expect(report.recording.end).toBe(plain.end);
  });

  it("parses both keys in v2 and still migrates v1", () => {
    const parsed = parseRecording(JSON.stringify({ ...recording, sceneVersion: v1.id }), registry);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.recording.sceneVersion).toBe(v1.id);
      expect(parsed.recording.swaps).toEqual(recording.swaps);
    }
    const v1Fixture = V1_FIXTURES.find((f) => f.file === "engine-yard.times-out.recording.json")!;
    const migrated = parseRecording(readV1Recording(v1Fixture));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.migratedFrom).toBe(1);
    expect(migrated.recording).not.toHaveProperty("sceneVersion");
    expect(migrated.recording).not.toHaveProperty("swaps");
  });
});

describe("replaying a run whose onLoad attaches a sublevel on a live version", () => {
  let game: GameDefinition;
  let registry: Registry;
  let deeper: StagedVersion;
  let recording: RunRecording;
  const replay = (rec: unknown, versions?: (id: string) => StagedVersion | null) =>
    replayRecording({
      game,
      registry,
      scene: yard(),
      flow: cellarLibrary(),
      recording: rec,
      ...(versions ? { versions } : {}),
    });

  beforeAll(async () => {
    game = swapGame({ cellarAtLoad: true });
    registry = createRegistry(game);
    deeper = await versionOf(
      cellar((def) => {
        def.entities!.push({ id: "c2", type: WALKER, at: [2, 6], speed: 3 });
      }),
      game,
    );
    recording = recordRun(game, registry, [], { library: cellarLibrary(), sublevels: [deeper] });
  });

  it("records the version the load's sublevel used at tick 0", () => {
    expect(recording.swaps).toEqual([
      expect.objectContaining({
        tick: 0,
        sublevel: CELLAR,
        version: deeper.id,
        timing: "next-load",
      }),
    ]);
  });

  it("attaches that version in the replay's onLoad and replays to the same end", () => {
    const report = replayed(replay(recording, (id) => findSceneVersion(id, [deeper])));
    expect(report.divergence).toBeNull();
    expect(report.matches).toBe(true);
    expect(report.stale).toBe(false);
    expect(report.recording.swaps).toEqual(recording.swaps);
    const { xs } = report.final as { xs: [string, number][] };
    expect(xs.map(([id]) => id)).toContain("low:c2");
  });

  it("refuses to load when the version is gone, naming the swap", () => {
    const run = replay(recording);
    expect(run.blocked).toBe(true);
    if (!run.blocked) return;
    expect(run.stage).toBe("load");
    expect(run.issues.at(-1)).toMatchObject({
      code: "scene-version-removed",
      path: "/swaps/0/version",
    });
  });
});

describe("replaying a run whose sublevel moved after its onLoad attach, before the first step", () => {
  let game: GameDefinition;
  let registry: Registry;
  let deeper: StagedVersion;
  let recording: RunRecording;

  beforeAll(async () => {
    game = swapGame({ cellarAtLoad: true });
    registry = createRegistry(game);
    deeper = await versionOf(
      cellar((def) => {
        def.entities!.push({ id: "c2", type: WALKER, at: [2, 6], speed: 3 });
      }),
      game,
    );
    recording = recordRun(game, registry, [], { library: cellarLibrary(), afterLoad: [deeper] });
  });

  it("records the release's own cellar the load attached, then the move", () => {
    expect(recording.swaps).toEqual([
      expect.objectContaining({ tick: 0, sublevel: CELLAR, version: null }),
      expect.objectContaining({ tick: 0, sublevel: CELLAR, version: deeper.id }),
    ]);
  });

  it("attaches the release's own cellar in the replay's onLoad, as the run did", () => {
    const report = replayed(
      replayRecording({
        game,
        registry,
        scene: yard(),
        flow: cellarLibrary(),
        recording,
        versions: (id) => findSceneVersion(id, [deeper]),
      }),
    );
    expect(report.divergence).toBeNull();
    expect(report.matches).toBe(true);
    expect(report.stale).toBe(false);
    expect(report.recording.swaps).toEqual(recording.swaps);
    const { xs } = report.final as { xs: [string, number][] };
    expect(xs.map(([id]) => id)).not.toContain("low:c2");
  });
});

describe("ctx.live.version in onLoad", () => {
  it("is the version a flow load plays, and the one a replay starts on", async () => {
    const seen: (string | null)[] = [];
    const game = swapGame({ restartAt: 5, versionAtLoad: (v) => seen.push(v) });
    const registry = createRegistry(game);
    const v1 = await versionOf(yard(faster), game);
    const rt = createHeadlessRuntime({
      game,
      registry,
      scene: expandScene(yard(), registry),
      flow: libraryOf(yard()),
    });
    try {
      expect(rt.live.stage(v1)).toEqual({ ok: true });
      rt.live.activate(SCENE, v1.id, "next-load");
      for (let i = 0; i < 6; i++) rt.step(rt.ctx.time.tickMs, []);
      expect(rt.ctx.live.version).toBe(v1.id);
    } finally {
      rt.destroy();
    }
    expect(seen).toEqual([null, v1.id]);

    seen.length = 0;
    const plainGame = swapGame();
    const plain = recordRun(plainGame, createRegistry(plainGame), []);
    const { swaps: _, ...start } = plain;
    replayRecording({
      game,
      registry,
      scene: yard(),
      flow: libraryOf(yard()),
      recording: { ...start, sceneVersion: v1.id, ticks: 3 },
      versions: (id) => findSceneVersion(id, [v1]),
    });
    expect(seen[0]).toBe(v1.id);
  });
});

describe("HeadlessRuntime.live", () => {
  async function headless(restartAt?: number) {
    const game = swapGame({ restartAt });
    const registry = createRegistry(game);
    const v1 = await versionOf(yard(faster), game);
    const rt = createHeadlessRuntime({
      game,
      registry,
      scene: expandScene(yard(), registry),
      flow: libraryOf(yard()),
    });
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
    };
    return { rt, v1, step };
  }

  it("stages without preloading, and a now activation swaps after the next step", async () => {
    const { rt, v1, step } = await headless();
    try {
      expect(rt.live.stage(v1)).toEqual({ ok: true });
      expect(rt.live.activate(SCENE, v1.id, "now")).toEqual({ timing: "now", clamped: false });
      expect(rt.live.pending()).toEqual([{ scene: SCENE, version: v1.id, timing: "now" }]);
      expect(rt.ctx.live.version).toBeNull();
      step();
      expect(rt.live.pending()).toEqual([]);
      expect(rt.ctx.live.version).toBe(v1.id);
      expect(rt.live.current(SCENE)).toBe(v1.id);
      expect((rt.get("w1") as Walker & { speed: number }).speed).toBe(2);
    } finally {
      rt.destroy();
    }
  });

  it("loads the active version when flow loads its scene", async () => {
    const { rt, v1, step } = await headless(5);
    try {
      expect(rt.live.stage(v1)).toEqual({ ok: true });
      expect(rt.live.activate(SCENE, v1.id, "next-load").timing).toBe("next-load");
      step(3);
      expect((rt.get("w1") as Walker & { speed: number }).speed).toBe(1);
      expect(rt.ctx.live.version).toBeNull();
      step(3);
      expect((rt.get("w1") as Walker & { speed: number }).speed).toBe(2);
      expect(rt.ctx.live.version).toBe(v1.id);
    } finally {
      rt.destroy();
    }
  });

  it("refuses a version of an unlisted scene, or of another game, and pins", async () => {
    const { rt, v1, step } = await headless();
    try {
      const other = await versionOf(yard(faster), defineGame({ ...swapGame(), id: "other" }));
      const refused = rt.live.stage(other);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.issue.code).toBe("live-incompatible");
      const unlisted = rt.live.stage({ ...v1, version: { ...v1.version, scene: "elsewhere" } });
      expect(unlisted.ok).toBe(false);
      if (!unlisted.ok) expect(unlisted.issue.code).toBe("live-swap-failed");

      rt.live.pin({});
      expect(rt.live.stage(v1)).toEqual({ ok: true });
      rt.live.activate(SCENE, v1.id, "now");
      step();
      expect(rt.ctx.live.version).toBeNull();
      rt.live.unpin();
      rt.live.activate(SCENE, v1.id, "now");
      step();
      expect(rt.ctx.live.version).toBe(v1.id);
    } finally {
      rt.destroy();
    }
  });
});

describe("replaying a Rapier run whose swap reloads at progress depth", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  /** The yard on Rapier, over a floor; `gravity` changes its header. */
  const onRapier = (gravity: Pt = [0, 9.8]) =>
    yard((def) => {
      def.settings = { physics: "rapier", gravity };
      def.entities!.push({ id: "floor", type: "solid", shape: ["box", 20, 9, 20, 1] });
    });

  it("keeps the tick, records the swap on it, and replays to the same end digest", async () => {
    const game = swapGame({ physics: "rapier" });
    const registry = createRegistry(game);
    const def = onRapier();
    const heavier = await versionOf(onRapier([0, 20]), game, "rapier");
    const recording = recordRun(
      game,
      registry,
      [{ at: NOW_AT - 1, version: heavier, timing: "now" }],
      { def, rapier },
    );
    expect(recording.swaps?.map((s) => [s.tick, s.strategy])).toEqual([[NOW_AT, "reload"]]);
    expect(recording.ticks).toBe(TICKS);
    expect(recording.outcome.tick).toBe(TICKS - 1);

    const report = replayed(
      replayRecording({
        game,
        registry,
        scene: def,
        flow: libraryOf(def),
        recording,
        rapier,
        versions: (id) => findSceneVersion(id, [heavier]),
      }),
    );
    expect(report.divergence).toBeNull();
    expect(report.matches).toBe(true);
    expect(report.stale).toBe(false);
    expect(report.recording.end).toBe(recording.end);
    expect(report.recording.swaps).toEqual(recording.swaps);
  });
});

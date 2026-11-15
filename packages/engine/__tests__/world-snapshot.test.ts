// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { listedSceneId, prepareRun, runLibrary, runLoop, startRun } from "../headless/play-loop";
import { gamePersistCell } from "../runtime/persist";
import { emptyTick, recordingStart, recordingTicks } from "../runtime/recorder";
import { resolveGame } from "../runtime/runtime";
import { captureSave, worldSaveBlockers } from "../runtime/save-state";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import { restoreWorld, snapshotWorld } from "../runtime/world-snapshot";
import { hashText } from "../scene/hash";
import type { RunRecording } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import {
  loadRapier,
  probePhysics,
  probeProjectView,
  probeRuns,
  probesFrom,
  probeTimeout,
  runGenreProbe,
  variantFlow,
  variantScene,
  type GenreProbe,
  type ProbeVariant,
} from "./genres/harness";

const PROBES = probesFrom(
  import.meta.glob<Record<string, unknown>>("./genres/*.probe.ts", { eager: true }),
);

const PHYSICS_FREE = PROBES.flatMap((probe) =>
  probeRuns(probe)
    .filter(({ variant }) => probePhysics(probe, variant) === "none")
    .map(({ name, variant }) => ({ probe, name, variant })),
);

/** A runtime of the probe's run, fed its recording's input by slot from wherever it stands. */
function replayer(probe: GenreProbe, variant: ProbeVariant | undefined, rec: RunRecording) {
  const { registry, game } = resolveGame({ game: probe.game as GameDefinition });
  const scene = variantScene(probe, variant);
  const project = probeProjectView(probe);
  const flow = variantFlow(probe, variant, scene);
  const library = runLibrary({ prefabs: probe.prefabs, library: probe.prefabs });
  const prepared = prepareRun(scene, registry, false, probe.prefabs, project?.engine, {
    library,
    project,
  });
  if (!prepared.ok) throw new Error(`${probe.id}: the scene is blocked`);
  const started = startRun({
    rapier: null,
    game,
    registry,
    scene: prepared.scene,
    play: recordingStart(rec.start, rec.seed),
    prefabs: library,
    project,
    persist: gamePersistCell(game, true),
    ...(flow
      ? {
          flow: {
            scene: listedSceneId(flow, scene) ?? scene.name,
            entry: null,
            library: flow,
          },
        }
      : {}),
  });
  if (!started.ok) throw new Error(`${probe.id}: the load failed: ${JSON.stringify(started.load)}`);
  const runtime = started.runtime;
  const fed = recordingTicks(rec, runtime.ctx.time, game);
  /** Plays `ticks` ticks from slot `from`: a digest of how they ended, what they emitted and the game's state. */
  const play = (from: number, ticks: number) => {
    const events: StepEvent[] = [];
    const end = runLoop({
      runtime,
      game,
      maxTicks: ticks,
      everySlot: true,
      input: {
        done: () => false,
        tick: (s) => fed.get(from + s) ?? emptyTick(from + s),
      },
      onTick: (state) => void events.push(...state.events),
    });
    return hashText(JSON.stringify([end, events, runtime.snapshot()]));
  };
  return { runtime, play };
}

/** The world a world save would hold, or why it can't. */
function worldOf(runtime: SceneRuntimeHandle): unknown {
  const saved = captureSave(runtime, { depth: "world", slot: "snapshot", now: 0 });
  return saved.ok ? saved.file.world : saved.issue.code;
}

describe("world snapshots on every physics-free probe", () => {
  it("finds the probes", () => {
    expect(PHYSICS_FREE.length).toBeGreaterThan(10);
  });

  let snapshotted = 0;
  for (const { probe, name, variant } of PHYSICS_FREE) {
    it(
      `${probe.id} ${name}: snapshot at N, run M, restore, run M again: equal digests`,
      async () => {
        const run = await runGenreProbe(probe, variant);
        const rec = run.report.recording;
        const at = variant?.saveAt ?? Math.floor(rec.ticks / 3);
        const span = Math.max(1, Math.min(Math.floor(rec.ticks / 3), rec.ticks - at - 1));
        const r = replayer(probe, variant, rec);
        try {
          r.play(0, at);
          const taken = snapshotWorld(r.runtime);
          if (!taken.ok) {
            const saved = captureSave(r.runtime, { depth: "world", slot: "s", now: 0 });
            expect(saved.ok).toBe(false);
            if (!saved.ok) expect(taken.issue.code).toBe(saved.issue.code);
            expect(taken.issue.detail).toStrictEqual({
              causes: worldSaveBlockers(r.runtime).map((b) => ({ ...b })),
            });
            return;
          }
          snapshotted++;
          expect(taken.snapshot.backend).toBe("geometry");
          expect(taken.snapshot.tick).toBe(r.runtime.ctx.tick);
          const before = worldOf(r.runtime);
          const first = r.play(at, span);
          restoreWorld(r.runtime, taken.snapshot);
          expect(worldOf(r.runtime)).toStrictEqual(before);
          expect(r.play(at, span)).toBe(first);
          // A snapshot restores more than once.
          restoreWorld(r.runtime, taken.snapshot);
          expect(r.play(at, span)).toBe(first);
        } finally {
          r.runtime.destroy();
        }
      },
      3 * probeTimeout(probe),
    );
  }

  it("snapshots most of them", () => {
    expect(snapshotted).toBeGreaterThan(PHYSICS_FREE.length / 2);
  });
});

describe("world snapshots refuse what a world save refuses", () => {
  const rapierProbe = PROBES.find((p) => probePhysics(p) === "rapier");

  it("a Rapier scene gets the world save's message", async () => {
    expect(rapierProbe).toBeDefined();
    const probe = rapierProbe!;
    const scene = variantScene(probe);
    const { registry, game } = resolveGame({ game: probe.game as GameDefinition });
    const project = probeProjectView(probe);
    const library = runLibrary({ prefabs: probe.prefabs, library: probe.prefabs });
    const prepared = prepareRun(scene, registry, false, probe.prefabs, project?.engine, {
      library,
      project,
    });
    if (!prepared.ok) throw new Error("blocked");
    const started = startRun({
      rapier: await loadRapier(),
      game,
      registry,
      scene: prepared.scene,
      play: {},
      prefabs: library,
      project,
    });
    if (!started.ok) throw new Error("load failed");
    try {
      const taken = snapshotWorld(started.runtime);
      const saved = captureSave(started.runtime, { depth: "world", slot: "s", now: 0 });
      expect(taken.ok).toBe(false);
      expect(saved.ok).toBe(false);
      if (taken.ok || saved.ok) return;
      expect(taken.issue.code).toBe("save-unsupported");
      expect(taken.issue.detail).toStrictEqual(saved.issue.detail);
      expect(taken.issue.message).toContain("the scene runs on Rapier");
    } finally {
      started.runtime.destroy();
    }
  });
});

/** A physics-free runtime whose game state is `state`, as `snapshot` returns it. */
function runtimeSaving(state: () => unknown) {
  const game = defineGame({
    id: "not-json",
    types: [],
    actions: [],
    world: { physics: "none" },
    time: { kind: "fixed", rate: 60 },
    createRuntime: () => ({ snapshot: () => state() as never }),
  });
  const registry = createRegistry(game);
  const doc: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: game.id,
    name: "not-json",
    bounds: [0, 0, 10, 10],
    settings: { physics: "none", gravity: [0, 0] },
    entities: [],
  };
  const prepared = prepareRun(doc, registry);
  if (!prepared.ok) throw new Error("blocked");
  const started = startRun({ rapier: null, game, registry, scene: prepared.scene, play: {} });
  if (!started.ok) throw new Error("load failed");
  return started.runtime;
}

describe("world snapshots refuse a game state a save can't hold", () => {
  for (const [what, state] of [
    ["a function", () => ({ hit: () => 1 })],
    ["a Map", () => ({ seen: new Map([["a", 1]]) })],
  ] as const) {
    it(`${what} in the game's state gets captureSave's issue, not a throw`, () => {
      const runtime = runtimeSaving(state);
      try {
        const taken = snapshotWorld(runtime);
        const saved = captureSave(runtime, { depth: "world", slot: "s", now: 0 });
        expect(taken.ok).toBe(false);
        expect(saved.ok).toBe(false);
        if (taken.ok || saved.ok) return;
        expect(taken.issue.code).toBe(saved.issue.code);
        expect(taken.issue.code).toBe("schema");
        expect(taken.issue.path).toBe(saved.issue.path);
      } finally {
        runtime.destroy();
      }
    });
  }
});

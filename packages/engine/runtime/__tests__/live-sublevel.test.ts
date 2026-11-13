// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { oneSceneVersion } from "../../__tests__/fixtures/live-version";
import { createRegistry, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { SceneLibrary } from "../../game/flow";
import type { GameDefinition, GameRuntime, Registry, SceneSystem } from "../../game/types";
import { prepareRun, runLoop, startRun } from "../../headless/play-loop";
import { replayRecording } from "../../headless/recording";
import { findSceneVersion } from "../../project/scene-version";
import { parseRecording, type RunRecording } from "../../scene/recording-schema";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type RuntimeEntity,
  type SceneDefinition,
} from "../../scene/types";
import type { StagedVersion } from "../../types";
import { preparedVersion } from "../live";
import { createRunRecorder, recordedSwap } from "../recorder";

const GAME = "sub-yard";
const POST = `${GAME}-post`;
const TICKS = 60;
const ATTACH = 5;
const ACTIVATE = 10;
const DETACH = 20;
const BACK = 25;
const REATTACH = 30;

type Post = RuntimeEntity<{ at: Pt }>;

/** Attaches the cellar, detaches it and attaches it again; its snapshot names every live entity. */
function subGame(): GameDefinition {
  return defineGame({
    id: GAME,
    world: { physics: "none" },
    actions: [],
    live: { timings: ["next-load", "boundary", "now"] },
    types: [
      {
        type: POST,
        description: "A point that stands still.",
        fields: { at: pointField("Where it stands.") },
        system: (ctx): SceneSystem<Post> => {
          const posts = new Set<string>();
          return {
            spawn(e) {
              posts.add(e.id);
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            despawn: (id) => void posts.delete(id),
            clear: () => posts.clear(),
            size: () => posts.size,
          };
        },
      },
    ],
    createRuntime(ctx) {
      const runtime: GameRuntime<{ ids: string[] }> = {
        afterStep() {
          if (ctx.tick === ATTACH || ctx.tick === REATTACH)
            expect(ctx.flow.attach("cellar", { label: "low" }).ok).toBe(true);
          if (ctx.tick === DETACH) ctx.flow.detach("low");
        },
        snapshot: () => ({ ids: [...ctx.query.select()].sort() }),
      };
      return runtime;
    },
  });
}

const scene = (name: string, posts: readonly string[]): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: GAME,
  bounds: [0, 0, 10, 10],
  settings: { physics: "none", gravity: [0, 0] },
  entities: posts.map((id, i): EntityDef => ({ id, type: POST, at: [1 + i, 1] })),
});

const yard = () => scene("yard", ["start"]);

const library = (): SceneLibrary => ({
  list: [{ scene: "yard" }, { scene: "cellar", sublevel: true }],
  scenes: new Map([
    ["yard", { def: yard(), prefabs: new Map() }],
    ["cellar", { def: scene("cellar", ["door"]), prefabs: new Map() }],
  ]),
});

type Seen = { tick: number; ids: string[] };

/** A move of the cellar after tick `at`: activating `version` (null: the release's own), or pinning it. */
type Move = { at: number; version: StagedVersion | null; pin?: boolean };

/** Plays the yard headless, making each move after its tick; what each tick holds, and the recording. */
function recordRun(
  game: GameDefinition,
  registry: Registry,
  moves: readonly Move[],
): { recording: RunRecording; seen: Seen[] } {
  const prepared = prepareRun(yard(), registry);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.blocked));
  const started = startRun({
    rapier: null,
    game,
    registry,
    scene: prepared.scene,
    play: {},
    flow: { scene: "yard", entry: null, library: library() },
  });
  if (!started.ok) throw new Error(JSON.stringify(started.load));
  const { runtime, live } = started;
  const recorder = createRunRecorder({
    rapier: null,
    game,
    registry,
    scene: "yard",
    sceneHash: prepared.hash,
    runHash: prepared.runHash,
    start: {},
    entry: null,
    sceneVersion: runtime.ctx.live.version,
    time: runtime.ctx.time,
    players: runtime.ctx.input.players(),
  });
  live.onApplied((swap) => recorder.swap(recordedSwap(swap)));
  const seen: Seen[] = [];
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
        seen.push({ tick: state.tick, ids: [...runtime.ctx.query.select()].sort() });
        for (const move of moves) {
          if (move.at !== state.tick) continue;
          if (move.version === null) {
            live.activate("cellar", null, "next-load");
            continue;
          }
          const read = preparedVersion(move.version, registry, game);
          if (!read.ok) throw new Error(JSON.stringify(read.issues));
          expect(live.stage(read.prepared).ok).toBe(true);
          if (move.pin) live.pin({ cellar: move.version.id });
          else
            expect(live.activate("cellar", move.version.id, "now")).toMatchObject({
              timing: "next-load",
              clamped: true,
            });
        }
      },
    });
    return { recording: recorder.finish(end, runtime.snapshot()), seen };
  } finally {
    runtime.destroy();
  }
}

describe("a sublevel's live version", () => {
  let game: GameDefinition;
  let registry: Registry;
  let version: StagedVersion;
  let recording: RunRecording;
  let seen: Seen[];
  const replay = (rec: RunRecording) =>
    replayRecording({
      game,
      registry,
      scene: yard(),
      flow: library(),
      recording: rec,
      versions: (id) => findSceneVersion(id, [version]),
    });

  beforeAll(async () => {
    game = subGame();
    registry = createRegistry(game);
    version = await oneSceneVersion(scene("cellar", ["door", "barrel"]), game, {
      scene: "cellar",
    });
    ({ recording, seen } = recordRun(game, registry, [{ at: ACTIVATE, version }]));
  });

  it("keeps the attached sublevel as it is, and its next attach in the same run uses the version", () => {
    const at = (tick: number) => seen.find((s) => s.tick === tick)!.ids;
    expect(at(ACTIVATE + 1)).toEqual(["low:door", "start"]);
    expect(at(DETACH + 1)).toEqual(["start"]);
    expect(at(REATTACH)).toEqual(["low:barrel", "low:door", "start"]);
  });

  it("records the activation as a next-load swap, and replays to the same end", () => {
    expect(recording.swaps).toEqual([
      expect.objectContaining({
        tick: ACTIVATE + 1,
        sublevel: "cellar",
        version: version.id,
        timing: "next-load",
        sceneHash: version.version.sceneHash,
      }),
    ]);
    expect(parseRecording(recording, registry).ok).toBe(true);
    const run = replay(recording);
    if (run.blocked) throw new Error(JSON.stringify(run));
    expect(run.divergence).toBeNull();
    expect(run.recording.swaps).toEqual(recording.swaps);

    const { swaps: _, ...without } = recording;
    const unswapped = replay(without);
    if (unswapped.blocked) throw new Error(JSON.stringify(unswapped));
    expect(unswapped.divergence).not.toBeNull();
  });

  it("records a move back to the release's own, so a reattach after it replays the same", () => {
    const back = recordRun(game, registry, [
      { at: ACTIVATE, version },
      { at: BACK, version: null },
    ]);
    const at = (tick: number) => back.seen.find((s) => s.tick === tick)!.ids;
    expect(at(REATTACH)).toEqual(["low:door", "start"]);
    expect(back.recording.swaps).toEqual([
      expect.objectContaining({ tick: ACTIVATE + 1, sublevel: "cellar", version: version.id }),
      expect.objectContaining({ tick: BACK + 1, sublevel: "cellar", version: null }),
    ]);
    expect(parseRecording(back.recording, registry).ok).toBe(true);
    const run = replay(back.recording);
    if (run.blocked) throw new Error(JSON.stringify(run));
    expect(run.divergence).toBeNull();
    expect(run.recording.swaps).toEqual(back.recording.swaps);
  });

  it("records a pin of the sublevel's version, and replays to the same end", () => {
    const pinned = recordRun(game, registry, [{ at: ACTIVATE, version, pin: true }]);
    expect(pinned.recording.swaps).toEqual([
      expect.objectContaining({ tick: ACTIVATE + 1, sublevel: "cellar", version: version.id }),
    ]);
    const run = replay(pinned.recording);
    if (run.blocked) throw new Error(JSON.stringify(run));
    expect(run.divergence).toBeNull();
    const at = (tick: number) => pinned.seen.find((s) => s.tick === tick)!.ids;
    expect(at(REATTACH)).toEqual(["low:barrel", "low:door", "start"]);
  });
});

import { createRegistry, isRuntimeId } from "@jams/engine/game";
import {
  ENTITY_SPAWNED,
  replayRecording,
  runPlaytest,
  type InputScriptV2,
} from "@jams/engine/headless";
import { prefabLibrary } from "@jams/engine/scene";

import { basin, fountainGame, twinSpout, type FountainSnapshot } from "./fountain-game";

const registry = createRegistry(fountainGame);
// Every prefab `ctx.instantiate` may place; the scene's own instances need none.
const library = prefabLibrary([twinSpout]);

/** Pours a twin spout, waits for the drops to pile up, then for every one to be gone. */
const script = (seed: number): InputScriptV2 => ({
  v: 2,
  scene: "basin",
  seed,
  steps: [
    { command: "pour", args: { prefab: "twin-spout" } },
    { hold: [], until: { exists: "twin-spout#1/left", count: { type: "drop", min: 6 } }, max: 60 },
    { hold: [], until: { count: { type: "drop", max: 0 } }, max: 600 },
  ],
});

function play(seed: number) {
  const run = runPlaytest<FountainSnapshot>({
    game: fountainGame,
    registry,
    scene: basin,
    library,
    script: script(seed),
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run;
}

export function pourTwice() {
  const first = play(1);
  const again = play(1);
  const other = play(2);
  const replay = replayRecording({
    game: fountainGame,
    scene: basin,
    library,
    recording: first.recording,
  });
  const spawned = first.events.filter((e) => e.type === ENTITY_SPAWNED).map((e) => e.entityId!);
  return {
    result: first.outcome.result,
    final: first.final,
    steps: first.steps.map((s) => s.end),
    // The instance's children first, then the drops in spawn order.
    spawned: spawned.slice(0, 4),
    allRuntime: spawned.every(isRuntimeId),
    sameSeedSameRun: again.recording.end === first.recording.end,
    otherSeedJitter: other.final?.jitter,
    // A run given a seed records it, so the replay draws the same numbers.
    recordedSeed: first.recording.seed,
    replayed: !replay.blocked && replay.matches,
  };
}

/** The same id spilled twice: the second spawn throws, and the run ends blocked at stage `run`. */
export function spillTwice() {
  const run = runPlaytest({
    game: fountainGame,
    registry,
    scene: basin,
    script: {
      v: 2,
      steps: [
        { command: "spill", args: { id: "drop#first" } },
        { command: "spill", args: { id: "drop#first" } },
      ],
    },
  });
  return run.blocked ? { stage: run.stage, codes: run.issues.map((i) => i.code) } : null;
}

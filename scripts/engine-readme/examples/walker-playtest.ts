import { createRegistry } from "@jams/engine/game";
import { replayRecording, runPlaytest, type RapierModule } from "@jams/engine/headless";
import { scenePhysics, type SceneDefinition } from "@jams/engine/scene";

import { walkerGame } from "./walker-game";

const registry = createRegistry(walkerGame);

/** Ten cells by five; a wall over the top four rows of column 4 sends the hero round the bottom. */
export const corridor: SceneDefinition = {
  v: 4,
  game: "walker",
  name: "corridor",
  bounds: [0, 0, 3.2, 1.6],
  entities: [
    { id: "wall", type: "solid", shape: ["box", 1.44, 0.64, 0.16, 0.64] },
    { id: "hero", type: "marker", at: [0.16, 0.16], tags: ["hero"] },
    { id: "goal", type: "marker", at: [3.04, 0.16], tags: ["goal"] },
  ],
};

/** Plays two `walk` commands, then replays the recording; Rapier is never loaded. */
export async function walkCorridor(loadRapier: () => Promise<RapierModule>) {
  const rapier = scenePhysics(corridor, registry) === "rapier" ? await loadRapier() : null;
  const run = runPlaytest({
    rapier,
    game: walkerGame,
    registry,
    scene: corridor,
    script: {
      v: 2,
      steps: [
        { command: "walk", args: { to: [0, 4] } },
        { wait: 100 },
        { command: "walk", args: { to: [9, 0] } },
        { wait: 300 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  const replay = replayRecording({
    rapier,
    game: walkerGame,
    scene: corridor,
    recording: run.recording,
  });
  return {
    result: run.outcome.result,
    // Ticks run only while the hero walks: the first wait's idle slots were skipped.
    ticks: run.ticks,
    slots: run.slots,
    commands: run.commands,
    replayed: !replay.blocked && replay.matches,
  };
}

import { runPlaytest } from "@jams/engine/headless";

import { lookoutGame, ridge } from "./lookout-game";

/** Walks the ridge for four seconds and lists the camera and effect requests with their ticks. */
export function watchRidge() {
  const run = runPlaytest({
    game: lookoutGame,
    scene: ridge,
    script: { v: 2, steps: [{ wait: 240 }] },
    recordPresentation: true,
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run)}`);
  return (run.present ?? []).map(({ tick, kind, op }) => `${tick} ${kind} ${op.op}`);
}

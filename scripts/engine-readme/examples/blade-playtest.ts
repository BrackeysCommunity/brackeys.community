import { runPlaytest } from "@jams/engine/headless";

import { bladeGame, bladeProject, practice } from "./blade-game";

const script = {
  v: 2 as const,
  steps: [
    { command: "cut" },
    { wait: 20 },
    { command: "back" },
    { wait: 10 },
    { command: "cut" },
    { wait: 20 },
  ],
};

/** Plays the swings twice, once keeping what they asked the shell to present: both runs end on one digest. */
export function swingTwice() {
  const play = (recordPresentation: boolean) => {
    const run = runPlaytest({
      game: bladeGame,
      scene: practice,
      project: bladeProject,
      script,
      recordPresentation,
    });
    if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run)}`);
    return run;
  };
  const presented = play(true);
  const plain = play(false);
  return {
    final: presented.final,
    present: presented.present ?? [],
    sameDigest: presented.recording.end === plain.recording.end,
  };
}

import {
  DIALOGUE_LINE,
  exploreDialogue,
  runPlaytest,
  type InputScriptV2,
} from "@jams/engine/headless";

import { gateProject, gateGame, gateScene, gateTalk } from "./gate-game";

/** Waits for the guard's question, pays, then reads the last line. */
const payTheToll: InputScriptV2 = {
  v: 2,
  steps: [
    { hold: [], until: { dialogue: { node: "gate", active: true } }, max: 10 },
    { command: "@dialogue-choose", args: { choice: 0 } },
    { hold: [], until: { dialogue: { node: "through" } }, max: 10 },
    { command: "@dialogue-advance" },
    { hold: [], until: { dialogue: { ended: "paid" } }, max: 10 },
  ],
};

/** Plays the toll headless, then lists every ending the guard's talk can reach with and without the gold. */
export function payAndWalk() {
  const run = runPlaytest({
    game: gateGame,
    scene: gateScene,
    project: gateProject,
    script: payTheToll,
    recordPresentation: true,
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run)}`);
  const ending = (gold: number) =>
    exploreDialogue(gateTalk, { vars: { gold } }).endings.map(
      (e) => `${e.ending} via [${e.path.join(",")}]`,
    );
  return {
    result: run.outcome.result,
    nodes: run.events
      .filter((e) => e.type === DIALOGUE_LINE)
      .map((e) => (e.data as { node: string }).node),
    // `toll-paid` is the step event the coin sound's trigger matches.
    paid: run.events.some((e) => e.type === "toll-paid"),
    audio: (run.present ?? [])
      .filter((r) => r.kind === "audio")
      .map(({ tick, op }) => `${tick} ${op.op} ${"sound" in op ? op.sound : ""}`),
    rich: ending(3),
    poor: ending(0),
  };
}

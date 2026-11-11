import { defineGame, type EngineContext } from "@jams/engine/game";
import { runPlaytest } from "@jams/engine/headless";
import type { SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

export type Card = { card: string; at: [x: number, y: number] };
export type TabletopSnapshot = { table: Card[]; hover: [x: number, y: number] | null };

/** How close to a card a click must land to pick it up, m. */
const PICK = 0.3;

/** Cards arrive from the host's DOM hand as `play-card` commands; a click on one takes it back. */
export const tabletopGame = defineGame<TabletopSnapshot>({
  id: "tabletop",
  types: [],
  actions: [
    {
      action: "take",
      bindings: [{ device: "pointer", button: "primary" }],
      description: "Take back the card under the pointer.",
    },
  ],
  commands: {
    "play-card": {
      description: "Put a card from the hand on the table.",
      args: z.strictObject({ card: z.string(), at: z.tuple([z.number(), z.number()]) }),
    },
  },
  world: { physics: "none" },
  createRuntime(ctx: EngineContext) {
    let table: Card[] = [];
    return {
      onLoad() {
        table = [];
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) if (c.name === "play-card") table.push(c.args as Card);
        const p = ctx.input.pointer();
        if (!p || !ctx.input.pressed("take")) return;
        const i = table.findIndex(({ at }) => Math.abs(at[0] - p.x) + Math.abs(at[1] - p.y) < PICK);
        if (i >= 0) table.splice(i, 1);
      },
      snapshot() {
        const p = ctx.input.pointer();
        return { table: table.map((c) => ({ ...c })), hover: p?.over ? [p.x, p.y] : null };
      },
    };
  },
});

export const felt: SceneDefinition = {
  v: 4,
  game: "tabletop",
  name: "felt",
  bounds: [0, 0, 6, 3],
  settings: { physics: "none" },
  entities: [{ id: "deck", type: "marker", at: [0.5, 0.5] }],
};

/** Two cards dropped from the hand, then a click on the first takes it back. */
export function dealAndTake() {
  const run = runPlaytest({
    game: tabletopGame,
    scene: felt,
    script: {
      v: 2,
      steps: [
        { command: "play-card", args: { card: "ace", at: [2, 1.5] } },
        { command: "play-card", args: { card: "king", at: [4, 1.5] } },
        { pointer: { at: [2.05, 1.5] } },
        // A `pointer` step with `press: "primary"` would raise `take` too, as a live click does.
        { press: "take" },
        { pointer: { at: [2.05, 1.5], drag: [3, 1] }, for: 10 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  // Pointer samples are stored as world metres × 10,000.
  const samples = run.recording.inputs[0]?.filter((e) => e[1] === "p") ?? [];
  return { final: run.final, samples: samples.length, firstSample: samples[0] };
}

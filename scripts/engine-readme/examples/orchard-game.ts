import { defineGame } from "@jams/engine/game";
import { runPlaytest } from "@jams/engine/headless";
import type { SceneDefinition } from "@jams/engine/scene";

export type OrchardSnapshot = { trees: number; ripe: number; picked: number };

const HOUR = 3_600_000;

/** An idle game: apples ripen while nobody plays, and only input or a command wakes it. */
export const orchardGame = defineGame<OrchardSnapshot>({
  id: "orchard",
  types: [],
  actions: [{ action: "pick", keys: ["space"], description: "Pick every ripe apple." }],
  time: { kind: "event", catchUp: { maxMs: 8 * HOUR } },
  world: { physics: "none" },
  commands: { plant: { description: "Plant one more tree." } },
  createRuntime() {
    let trees = 1;
    let ripe = 0;
    let picked = 0;
    return {
      onLoad() {
        trees = 1;
        ripe = 0;
        picked = 0;
      },
      beforeStep(_dtMs, actions, commands) {
        for (const c of commands) {
          if (c.name === "plant") trees++;
          // Time away, already capped at catchUp.maxMs: an apple per tree per minute.
          if (c.name === "@elapsed")
            ripe += trees * Math.floor((c.args as { ms: number }).ms / 60_000);
        }
        if (actions.some((a) => a.action === "pick" && a.pressed)) {
          picked += ripe;
          ripe = 0;
        }
      },
      snapshot: () => ({ trees, ripe, picked }),
    };
  },
});

/** The game keeps its trees in its runtime, so the scene is empty. */
export const meadow: SceneDefinition = {
  v: 3,
  game: "orchard",
  name: "meadow",
  bounds: [0, 0, 640, 360],
  entities: [],
};

/** Plants a tree, is away for a day (capped at eight hours), then picks. */
export function dayAway() {
  const run = runPlaytest({
    game: orchardGame,
    scene: meadow,
    script: { v: 1, steps: [{ command: "plant" }, { elapse: 24 * HOUR }, { press: ["pick"] }] },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  return { final: run.final, ticks: run.ticks };
}

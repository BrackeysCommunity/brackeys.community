import { readFileSync } from "node:fs";

import RAPIER from "@dimforge/rapier2d-compat";
import { createRegistry } from "@jams/engine/game";
import { fuzz, runPlaytest, type RapierModule } from "@jams/engine/headless";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

await RAPIER.init();
const rapier = RAPIER as unknown as RapierModule;

const registry = createRegistry(coinGame);
const scene = parseSceneOrThrow(readFileSync("scenes/first.json", "utf8"), registry);

const run = runPlaytest({
  rapier,
  game: coinGame,
  registry,
  scene,
  script: {
    v: 1,
    steps: [
      { hold: ["right"], until: { event: "sensor:enter" }, max: 300 },
      { wait: 30 },
      { hold: ["left"], forMs: 2000 },
    ],
  },
});
if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
console.log(
  run.outcome.result,
  `at tick ${run.outcome.tick}`,
  `${run.trail.pts.length} trail points`,
);

const coverage = fuzz({ rapier, game: coinGame, registry, scene, seed: "first", rollouts: 50 });
if (!coverage.blocked) {
  for (const t of coverage.touched) console.log(`${t.ref}: ${t.reached} of ${coverage.rollouts}`);
  console.log(`never touched: ${coverage.untouched.join(", ") || "none"}`);
}

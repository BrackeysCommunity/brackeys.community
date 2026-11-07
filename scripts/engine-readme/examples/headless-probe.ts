import { readFileSync } from "node:fs";

import RAPIER from "@dimforge/rapier2d-compat";
import { createRegistry } from "@jams/engine/game";
import { runProbe, type RapierModule } from "@jams/engine/headless";
import { expandScene, parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

await RAPIER.init();
const rapier = RAPIER as unknown as RapierModule;

const registry = createRegistry(coinGame);
const def = parseSceneOrThrow(readFileSync("scenes/first.json", "utf8"), registry);

const report = runProbe({
  rapier,
  game: coinGame,
  registry,
  scene: expandScene(def, registry),
  ticks: 600,
  hold: ["right"],
  inputs: [[300, "right", 0]],
});
console.log(report.final, report.outcome, `${report.events.length} events`);

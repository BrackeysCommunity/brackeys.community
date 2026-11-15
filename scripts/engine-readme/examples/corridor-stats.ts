import { createRegistry } from "@jams/engine/game";
import { runStats } from "@jams/engine/headless";

import { walkerGame } from "./walker-game";
import { corridor } from "./walker-playtest";

/** 120 measured ticks after 30 of warm-up; `counts` repeat run to run, `wall` doesn't. */
export async function corridorStats() {
  const report = await runStats({
    rapier: null,
    game: walkerGame,
    registry: createRegistry(walkerGame),
    scene: corridor,
    script: { v: 2, steps: [{ command: "walk", args: { to: [9, 0] } }, { wait: 300 }] },
    ticks: 120,
    warmup: 30,
  });
  const { ticksPerSecond, timings } = report.wall;
  const slowest = Object.entries(timings.phases).sort(([, a], [, b]) => b.mean - a.mean)[0];
  return { counts: report.counts, ticksPerSecond, slowest: slowest?.[0] ?? null };
}

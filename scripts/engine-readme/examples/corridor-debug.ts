import { createEventLog } from "@jams/engine/debug";
import { createRegistry, defineGame, type EngineContext } from "@jams/engine/game";
import { replayRecording, runPlaytest } from "@jams/engine/headless";

import { walkerGame, type WalkerSnapshot } from "./walker-game";
import { corridor } from "./walker-playtest";

/** The walker, drawing the tick over the hero's start; `ctx.debug` is a no-op without a sink. */
export const tracedWalker = defineGame<WalkerSnapshot>({
  ...walkerGame,
  createRuntime(ctx: EngineContext) {
    const inner = walkerGame.createRuntime(ctx);
    return {
      ...inner,
      afterStep() {
        if (!ctx.debug.active) return;
        ctx.debug.circle({ x: 0.16, y: 0.16 }, 0.12, { color: 0x44ccff, width: 2 });
        ctx.debug.text({ x: 0.16, y: 0.4 }, `tick ${ctx.tick}`, { size: 12 });
      },
    };
  },
});

/** Plays with the draws collected, then replays into an event log and seeks to tick 60. */
export function traceCorridor() {
  const registry = createRegistry(tracedWalker);
  const run = runPlaytest({
    rapier: null,
    game: tracedWalker,
    registry,
    scene: corridor,
    script: { v: 2, steps: [{ command: "walk", args: { to: [9, 0] } }, { wait: 300 }] },
    collectDebugDraw: true,
  });
  if (run.blocked) throw new Error(run.stage);

  const log = createEventLog();
  const replay = replayRecording({
    rapier: null,
    game: tracedWalker,
    scene: corridor,
    recording: run.recording,
    onEvents: (tick, events) => log.append(tick, events),
  });
  const sought = replayRecording({
    rapier: null,
    game: tracedWalker,
    scene: corridor,
    recording: run.recording,
    seek: 60,
  });
  return {
    draws: (run.debug ?? []).map((d) => d.kind),
    replayed: !replay.blocked && replay.matches,
    logged: log.list().length,
    at: sought.blocked ? null : (sought.at ?? null),
  };
}

import { createRegistry, PLAYER_JOINED } from "@jams/engine/game";
import {
  decodeStreams,
  parseRecording,
  replayRecording,
  runPlaytest,
  type InputScriptV2,
} from "@jams/engine/headless";

import { duelGame, field } from "./duel-game";

const registry = createRegistry(duelGame);

/** Seat 0 joins on the keyboard and runs straight; seat 1 joins on a pad later and cuts across. */
export const race: InputScriptV2 = {
  v: 2,
  scene: "field",
  players: 2,
  maxTicks: 600,
  tracks: [
    {
      player: 0,
      steps: [{ join: "keyboard" }, { set: { move: [1, 0] }, for: 150 }],
    },
    {
      player: 1,
      steps: [
        { wait: 10 },
        { join: "pad:0" },
        { set: { move: [0.8, -0.6] }, for: 60 },
        { set: { move: [1, 0] }, for: 120 },
      ],
    },
  ],
};

/** Plays the race, then replays its recording from JSON and reads its streams back. */
export function runRace() {
  const run = runPlaytest({ game: duelGame, registry, scene: field, script: race });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  const text = JSON.stringify(run.recording);
  const parsed = parseRecording(text, registry);
  const replay = replayRecording({ game: duelGame, scene: field, recording: text });
  const ticks = decodeStreams(run.recording);
  return {
    result: run.outcome.result,
    joins: run.events.filter((e) => e.type === PLAYER_JOINED).map((e) => e.player ?? 0),
    seats: run.recording.players,
    actions: run.recording.actions,
    // Seat 1's first input: its vector, as ints × 1000.
    seat1First: run.recording.inputs[1]?.[0],
    migrated: parsed.ok ? (parsed.migratedFrom ?? null) : "unparsed",
    replayed: !replay.blocked && replay.matches,
    ticksWithInput: ticks.size,
  };
}

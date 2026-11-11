/**
 * The browser smoke's second-game run, shared by the page and the runner:
 * the tactics game's golden recording of level 1 replayed through the
 * public entries, on the same scene, prefabs and project view as the
 * game's golden test. The game has no physics, so Rapier comes only through
 * a counting loader, asked only if the scene resolved to it; every runtime
 * must reproduce the game's one pinned digest.
 */
import type { GameDefinition } from "@jams/engine/game";
import { loadHeadless, replayRecording, type RapierModule } from "@jams/engine/headless";
import { scenePhysics } from "@jams/engine/scene";

import { tacticsGame } from "../../../src/games/tactics";
import recording from "../../../src/games/tactics/__tests__/fixtures/level-1.recording.json";
import { tacticsGoldenInput } from "../../../src/games/tactics/__tests__/pins";

/** What the tactics replay gives, beside where it ran. */
export type TacticsRun = {
  /** The scene's physics as it resolved before anything loaded. */
  physics: "rapier" | "none";
  /** How the replay ended, and on which tick. */
  result: string;
  tick: number;
  /** The replay ended as the recording did: result, tick and end digest. */
  replayMatches: boolean;
  /** The replay's end digest (`RunRecording.end`): what the golden pin holds. */
  digest: string;
};

/** The tactics replay as one runtime saw it: how often its Rapier loader was called. */
export type TacticsProbe = TacticsRun & { rapierLoads: number };

/** Replays level 1's golden recording; Rapier is asked of `load` only for a Rapier scene. */
export async function runTactics(load: () => Promise<RapierModule>): Promise<TacticsRun> {
  const loaded = await loadHeadless(tacticsGoldenInput());
  const physics = scenePhysics(loaded.scene, loaded.registry, loaded.project?.engine);
  const rapier = physics === "rapier" ? await load() : null;
  const replay = replayRecording({
    rapier,
    game: tacticsGame as GameDefinition,
    registry: loaded.registry,
    scene: loaded.scene,
    prefabs: loaded.prefabs,
    library: loaded.library,
    project: loaded.project,
    recording,
  });
  if (replay.blocked) {
    throw new Error(
      `the tactics replay blocked at ${replay.stage}: ${JSON.stringify({ issues: replay.issues, scriptIssues: replay.scriptIssues })}`,
    );
  }
  const { outcome, end } = replay.recording;
  return {
    physics,
    result: outcome.result,
    tick: outcome.tick,
    replayMatches: replay.matches,
    digest: end,
  };
}

import { fuzz as runFuzz, type FuzzOptions, type FuzzReport } from "@jams/engine/headless";
import { MAX_SCRIPT_TICKS } from "@jams/engine/scene";

import { gameFlag, isToolResult, openScene, usage, type Tool } from "../context";
import { projectRuntime } from "../projects";
import { blockedText, readSaveFixture, type SaveFixture } from "./playtest";
import { rapierFor } from "./step";

export type FuzzInput = {
  scene?: string;
  seed?: string;
  rollouts?: string;
  ticks?: string;
  game?: string;
  /** A save fixture (`.save.json`) every rollout starts from instead of the scene's fresh load. */
  fromSave?: string;
};

const USAGE =
  "fuzz <scene|file|-> [--seed s] [--rollouts n] [--ticks n] [--game id] [--from-save file]";
const DEFAULT_ROLLOUTS = 100;
const MAX_ROLLOUTS = 10_000;
const DEFAULT_TICKS = 600;

/** A whole number in `[1, max]`, the default when absent, or null. */
function count(text: string | undefined, fallback: number, max: number): number | null {
  if (text === undefined) return fallback;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

/** An integer seed stays a number, so `--seed 1` and the API's `seed: 1` agree; anything else is a string seed. */
const seedOf = (text: string | undefined): number | string =>
  text === undefined ? 1 : /^\d+$/.test(text) ? Number(text) : text;

function reportText(r: FuzzReport, runs: string, save: SaveFixture | undefined): string {
  const results = Object.entries(r.results)
    .filter(([, n]) => n > 0)
    .map(([result, n]) => `${result} ${n}`)
    .join(", ");
  return [
    `${r.scene} ${r.sceneHash} ${runs} config ${r.configHash}: ${r.rollouts} rollouts of up to ${r.ticksPerRollout} ticks, seed ${JSON.stringify(r.seed)}`,
    ...(save ? [`  from save ${save.path} (slot ${save.file.slot}, ${save.file.depth})`] : []),
    `  ${r.ticks} ticks in ${Math.round(r.timing.elapsedMs)}ms (${r.timing.ticksPerSecond} ticks/s)`,
    `  results: ${results}`,
    ...(r.legal
      ? [
          `  legal: ${r.legal.sent} commands sent, ${r.legal.empty} macro${r.legal.empty === 1 ? "" : "s"} with none legal`,
        ]
      : []),
    ...r.touched.map(
      (t) =>
        `  ${t.ref} (${t.type}) reached in ${t.reached} of ${r.rollouts} runs, first at t${t.firstTick} (rollout ${t.firstRollout})`,
    ),
    ...(r.untouched.length > 0 ? [`  never touched: ${r.untouched.join(", ")}`] : []),
  ].join("\n");
}

/**
 * Seeded random rollouts of a scene: which entities they touched, and how
 * they ended. With `fromSave` every rollout starts from that save fixture.
 */
export const fuzz: Tool<FuzzInput> = async (input, ctx) => {
  const rollouts = count(input.rollouts, DEFAULT_ROLLOUTS, MAX_ROLLOUTS);
  if (rollouts === null) return usage(`--rollouts must be an integer from 1 to ${MAX_ROLLOUTS}`);
  const ticks = count(input.ticks, DEFAULT_TICKS, MAX_SCRIPT_TICKS);
  if (ticks === null) return usage(`--ticks must be an integer from 1 to ${MAX_SCRIPT_TICKS}`);
  if (input.seed === "") return usage("--seed needs a value");

  const under = input.game === undefined ? undefined : gameFlag(ctx, input.game);
  if (isToolResult(under)) return under;
  const loaded = await openScene(ctx, input.scene, USAGE, under);
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;
  const game = registry.game?.id ?? null;
  let save: SaveFixture | undefined;
  if (input.fromSave !== undefined) {
    const fixture = await readSaveFixture(input.fromSave, registry);
    if (isToolResult(fixture)) return fixture;
    save = fixture;
  }

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const options: FuzzOptions = {
    rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
    game: registry.game,
    registry,
    scene: loaded.def,
    prefabs: loaded.prefabs,
    project,
    seed: seedOf(input.seed),
    rollouts,
    ticks,
    ...(save ? { fromSave: { file: save.file, sha256: save.sha256 } } : {}),
  };
  const run = runFuzz(options);
  if (run.blocked)
    return { exitCode: 1, data: { ok: false, game, ...run }, text: blockedText(run) };
  return {
    exitCode: 0,
    data: {
      game,
      ...run,
      ...(save ? { fromSave: { path: save.path, slot: save.file.slot, sha256: save.sha256 } } : {}),
    },
    text: reportText(run, game ? `game ${game}` : "no game", save),
  };
};

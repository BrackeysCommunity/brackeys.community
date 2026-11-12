/**
 * The browser smoke's workload, shared by the page (`main.ts`) and the runner
 * (`../browser.ts`), which runs it under Bun to get the digest every browser
 * must reproduce: `engine-yard` under `-compat` Rapier for the parity
 * script's first 120 ticks, reduced to one hash of its final state, events
 * and stats.
 */
import RAPIER from "@dimforge/rapier2d-compat";
import { ENGINE_VERSION } from "@jams/engine";
import { createRegistry } from "@jams/engine/game";
import { runProbe, type ProbeInput, type RapierModule } from "@jams/engine/headless";
import { expandScene, hashText, parseSceneOrThrow } from "@jams/engine/scene";

import parityInputs from "../../../packages/engine/__tests__/fixtures/parity-inputs.json";
import engineYard from "../../../packages/engine/scenes/engine-yard.json";
import { smokeGame } from "../game";

export const SMOKE_TICKS = 120;
export const SMOKE_FLAVOUR = "rapier2d-compat";

export type SmokeRun = { engine: string; ticks: typeof SMOKE_TICKS; digest: string };

let rapier: Promise<RapierModule> | null = null;

/** `-compat` carries its wasm inline, so the same import initialises in Bun and in every browser. */
export function loadRapier(): Promise<RapierModule> {
  rapier ??= (async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      await RAPIER.init();
    } finally {
      console.warn = warn;
    }
    return RAPIER as unknown as RapierModule;
  })();
  return rapier;
}

export async function runSmokeDigest(): Promise<SmokeRun> {
  const registry = createRegistry(smokeGame);
  const scene = expandScene(parseSceneOrThrow(engineYard, registry), registry);
  const inputs = (parityInputs as NonNullable<ProbeInput["inputs"]>).filter(
    ([tick]) => tick < SMOKE_TICKS,
  );
  const report = runProbe({
    rapier: await loadRapier(),
    game: smokeGame,
    registry,
    scene,
    ticks: SMOKE_TICKS,
    inputs,
  });
  if (!report.load.ok) throw new Error(`engine-yard didn't load: ${JSON.stringify(report.load)}`);
  if (report.ticks !== SMOKE_TICKS)
    throw new Error(`ran ${report.ticks} ticks, not ${SMOKE_TICKS}`);
  return {
    engine: ENGINE_VERSION,
    ticks: SMOKE_TICKS,
    digest: hashText(JSON.stringify([report.final, report.events, report.stats])),
  };
}

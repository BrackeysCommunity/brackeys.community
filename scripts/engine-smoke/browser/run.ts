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

/** How long the page's runs may take before it reports the one it is stuck in; inside the runner's own wait. */
export const PAGE_BUDGET_MS = 50_000;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Times the page's runs in turn, so a page over its budget can say which run it is stuck in. */
export function pageSteps(now: () => number = () => performance.now()) {
  const started = now();
  const finished: string[] = [];
  let current: { step: string; at: number } | null = null;
  return {
    async run<T>(step: string, work: () => T | Promise<T>): Promise<T> {
      const at = now();
      current = { step, at };
      const value = await work();
      finished.push(`${step} ${seconds(now() - at)}`);
      current = null;
      return value;
    },
    stuck(): string {
      const where = current
        ? `${current.step}, begun at ${seconds(current.at - started)}`
        : "between runs";
      const done = finished.length > 0 ? `; done: ${finished.join(", ")}` : "";
      return `after ${seconds(now() - started)} the page was still in ${where}${done}`;
    },
  };
}

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

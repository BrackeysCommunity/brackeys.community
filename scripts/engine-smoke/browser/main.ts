import type { PhysicsFreeProbe, RenderProbe, SplitProbe } from "../browser-compare";
import { runAudioSmoke } from "./audio";
import { readContact, type ContactRead } from "./contact";
import type { AudioProbe, SignProbe } from "./media-compare";
import { rapierSpy, runPhysicsFree, startPhysicsFree } from "./physics-free";
import { runRenderSmoke } from "./render";
import {
  loadRapier,
  PAGE_BUDGET_MS,
  pageSteps,
  runSmokeDigest,
  SMOKE_FLAVOUR,
  SMOKE_TICKS,
} from "./run";
import { runSaves, type SavesProbe } from "./saves";
import { runSignSmoke } from "./sign-run";
import { runTactics, type TacticsProbe } from "./tactics";
import { runTilemapSmoke } from "./tilemap-run";
import type { TilemapProbe } from "./tilemaps";

export type EngineSmokeResult =
  | {
      ok: true;
      flavour: typeof SMOKE_FLAVOUR;
      ticks: typeof SMOKE_TICKS;
      digest: string;
      /** The kitchen sink drawn with its textures, and the pixels read back. */
      render: RenderProbe;
      /** The sink on two viewports: each half's sprite, the animated one read a clip frame apart. */
      split: SplitProbe;
      /** The grid scene played headless with no physics, then started in a shell. */
      physicsFree: PhysicsFreeProbe;
      /** A prop dropped onto a floor under `ctx.contacts`: its first contact:start. */
      contact: ContactRead;
      /** The tactics game's golden recording replayed with no physics. */
      tactics: TacticsProbe;
      /** The sink's tile strip on a square grid and a hex one, each read at a painted and an empty cell. */
      tilemaps: TilemapProbe;
      /** A save round trip through IndexedDB and the browser store; the page fails when it does. */
      saves?: SavesProbe;
      /** A world `text` sign in a bitmap font and one in a web font, each read for its colour. */
      signs: SignProbe;
      /** A synth patch through `webAudioBackend` after the runner's click, and offline at `pan: -1`. */
      audio: AudioProbe;
      userAgent: string;
    }
  | { ok: false; error: string };

declare global {
  interface Window {
    __engineSmoke?: EngineSmokeResult;
  }
}

/** The first result stands: a run that finishes after the budget reported it stuck changes nothing. */
function settle(result: EngineSmokeResult): void {
  if (window.__engineSmoke) return;
  window.__engineSmoke = result;
  document.body.textContent = JSON.stringify(result, null, 2);
}

const steps = pageSteps();
const overBudget = setTimeout(() => settle({ ok: false, error: steps.stuck() }), PAGE_BUDGET_MS);

try {
  const { digest } = await steps.run("the engine-yard digest", runSmokeDigest);
  const { render, split } = await steps.run("the render run", runRenderSmoke);
  const spy = rapierSpy(loadRapier);
  const run = await steps.run("the physics-free run", () => runPhysicsFree(spy.load));
  const shellTicks = await steps.run("the physics-free shell", () => startPhysicsFree(spy.load));
  const contact = await steps.run("the contact run", async () => readContact(await loadRapier()));
  const tacticsSpy = rapierSpy(loadRapier);
  const tactics = await steps.run("the tactics run", () => runTactics(tacticsSpy.load));
  const tilemaps = await steps.run("the tilemap run", runTilemapSmoke);
  const saves = await steps.run("the save run", runSaves);
  const signs = await steps.run("the sign run", runSignSmoke);
  const audio = await steps.run("the audio run", runAudioSmoke);
  settle({
    ok: true,
    flavour: SMOKE_FLAVOUR,
    ticks: SMOKE_TICKS,
    digest,
    render,
    split,
    physicsFree: { ...run, shellTicks, rapierLoads: spy.calls() },
    contact,
    tactics: { ...tactics, rapierLoads: tacticsSpy.calls() },
    tilemaps,
    saves,
    signs,
    audio,
    userAgent: navigator.userAgent,
  });
} catch (err) {
  settle({
    ok: false,
    error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
  });
} finally {
  clearTimeout(overBudget);
}

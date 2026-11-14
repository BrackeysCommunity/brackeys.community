import type { PhysicsFreeProbe, RenderProbe, SplitProbe } from "../browser-compare";
import { readContact, type ContactRead } from "./contact";
import { rapierSpy, runPhysicsFree, startPhysicsFree } from "./physics-free";
import { runRenderSmoke } from "./render";
import { loadRapier, runSmokeDigest, SMOKE_FLAVOUR, SMOKE_TICKS } from "./run";
import { runSaves, type SavesProbe } from "./saves";
import { runTactics, type TacticsProbe } from "./tactics";

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
      /** A save round trip through IndexedDB and the browser store; the page fails when it does. */
      saves?: SavesProbe;
      userAgent: string;
    }
  | { ok: false; error: string };

declare global {
  interface Window {
    __engineSmoke?: EngineSmokeResult;
  }
}

try {
  const { digest } = await runSmokeDigest();
  const { render, split } = await runRenderSmoke();
  const spy = rapierSpy(loadRapier);
  const run = await runPhysicsFree(spy.load);
  const shellTicks = await startPhysicsFree(spy.load);
  const contact = readContact(await loadRapier());
  const tacticsSpy = rapierSpy(loadRapier);
  const tactics = await runTactics(tacticsSpy.load);
  const saves = await runSaves();
  window.__engineSmoke = {
    ok: true,
    flavour: SMOKE_FLAVOUR,
    ticks: SMOKE_TICKS,
    digest,
    render,
    split,
    physicsFree: { ...run, shellTicks, rapierLoads: spy.calls() },
    contact,
    tactics: { ...tactics, rapierLoads: tacticsSpy.calls() },
    saves,
    userAgent: navigator.userAgent,
  };
} catch (err) {
  window.__engineSmoke = {
    ok: false,
    error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
  };
}
document.body.textContent = JSON.stringify(window.__engineSmoke, null, 2);

import type { PhysicsFreeProbe, RenderProbe } from "../browser-compare";
import { readContact, type ContactRead } from "./contact";
import { rapierSpy, runPhysicsFree, startPhysicsFree } from "./physics-free";
import { runRenderSmoke } from "./render";
import { loadRapier, runSmokeDigest, SMOKE_FLAVOUR, SMOKE_TICKS } from "./run";

export type EngineSmokeResult =
  | {
      ok: true;
      flavour: typeof SMOKE_FLAVOUR;
      ticks: typeof SMOKE_TICKS;
      digest: string;
      /** The kitchen sink drawn with its textures, and the pixels read back. */
      render: RenderProbe;
      /** The grid scene played headless with no physics, then started in a shell. */
      physicsFree: PhysicsFreeProbe;
      /** A prop dropped onto a floor under `ctx.contacts`: its first contact:start. */
      contact: ContactRead;
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
  const render = await runRenderSmoke();
  const spy = rapierSpy(loadRapier);
  const run = await runPhysicsFree(spy.load);
  const shellTicks = await startPhysicsFree(spy.load);
  const contact = readContact(await loadRapier());
  window.__engineSmoke = {
    ok: true,
    flavour: SMOKE_FLAVOUR,
    ticks: SMOKE_TICKS,
    digest,
    render,
    physicsFree: { ...run, shellTicks, rapierLoads: spy.calls() },
    contact,
    userAgent: navigator.userAgent,
  };
} catch (err) {
  window.__engineSmoke = {
    ok: false,
    error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
  };
}
document.body.textContent = JSON.stringify(window.__engineSmoke, null, 2);

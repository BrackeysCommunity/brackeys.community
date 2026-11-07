import { runSmokeDigest, SMOKE_FLAVOUR, SMOKE_TICKS } from "./run";

export type EngineSmokeResult =
  | {
      ok: true;
      flavour: typeof SMOKE_FLAVOUR;
      ticks: typeof SMOKE_TICKS;
      digest: string;
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
  window.__engineSmoke = {
    ok: true,
    flavour: SMOKE_FLAVOUR,
    ticks: SMOKE_TICKS,
    digest,
    userAgent: navigator.userAgent,
  };
} catch (err) {
  window.__engineSmoke = {
    ok: false,
    error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
  };
}
document.body.textContent = JSON.stringify(window.__engineSmoke, null, 2);

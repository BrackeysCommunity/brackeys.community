import type { RapierModule } from "../../types";

/**
 * The `-compat` build, initialised with its deprecation warning muted. Tests
 * that call `debugRender` need it: the standard build's can't read wasm
 * memory under vitest.
 */
export async function loadCompatRapier(): Promise<RapierModule> {
  const mod = await import("@dimforge/rapier2d-compat");
  const warn = console.warn;
  console.warn = () => {};
  try {
    await mod.default.init();
  } finally {
    console.warn = warn;
  }
  return mod.default as unknown as RapierModule;
}

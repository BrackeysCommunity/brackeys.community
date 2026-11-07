import RAPIER from "@dimforge/rapier2d-compat";
import type { RapierModule } from "@jams/engine/headless";

let ready: Promise<RapierModule> | null = null;

/**
 * The standard `@dimforge/rapier2d` can't construct a World under Bun or
 * Node, so tools inject the `-compat` build, whose wasm is inlined. Its
 * classes are separate declarations, so it needs a cast to the engine's type.
 */
export function loadCompatRapier(): Promise<RapierModule> {
  ready ??= (async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      await RAPIER.init();
    } finally {
      console.warn = warn;
    }
    return RAPIER as unknown as RapierModule;
  })();
  return ready;
}

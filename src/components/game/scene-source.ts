import { parseScene, parseSceneOrThrow, type SceneDefinition } from "@jams/engine/scene";

import testYard from "@/game/scenes/test-yard.json";

export const SCENE_NAME = "test-yard";

let current: SceneDefinition = parseSceneOrThrow(testYard);
const listeners = new Set<(doc: SceneDefinition) => void>();

/** The scene as last read from `src/game/scenes`. */
export function getSceneDoc(): SceneDefinition {
  return current;
}

/** Called when the scene file changes on disk in dev (a save, `scene apply`, a hand edit). */
export function onSceneFileChange(listener: (doc: SceneDefinition) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Accepting the JSON here stops the update before it reaches GameCanvas, so
// a write to the file never re-runs the game or editor effects.
if (import.meta.hot) {
  import.meta.hot.accept("@/game/scenes/test-yard.json", (mod) => {
    if (!mod) return;
    const parsed = parseScene((mod as unknown as { default: unknown }).default);
    if (!parsed.ok) {
      console.warn(`[scene] ${SCENE_NAME}.json changed but doesn't parse`, parsed.issues);
      return;
    }
    current = parsed.def;
    for (const l of listeners) l(current);
  });
}

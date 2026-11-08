import {
  createRegistry,
  parsePrefab,
  parseSceneOrThrow,
  prefabLibrary,
  type Prefab,
} from "@jams/engine/scene";

import { platformerGame } from "@/games/platformer";
import testYard from "@/games/platformer/scenes/test-yard.json";

/**
 * The scene the game room plays when nobody edits it, and the one `?edit=1`
 * opens first when the project still holds it; the editor reads every
 * scene from the project session instead.
 */
export const BUNDLED_SCENE_ID = "test-yard";

/** The registry the site reads scenes with and hands to the game. */
export const SCENE_REGISTRY = createRegistry(platformerGame);

/** The scene as bundled; the editor reads the live one from the project instead. */
export const BUNDLED_SCENE = parseSceneOrThrow(testYard, SCENE_REGISTRY);

const prefabFiles = import.meta.glob<unknown>("@/games/platformer/scenes/prefabs/*.json", {
  eager: true,
  import: "default",
});

/** The prefabs the bundled scene's instances name, from `scenes/prefabs/`; a file that doesn't parse is left out. */
export const BUNDLED_PREFABS = prefabLibrary(
  Object.values(prefabFiles).flatMap((raw): Prefab[] => {
    const parsed = parsePrefab(raw, SCENE_REGISTRY);
    return parsed.ok ? [parsed.prefab] : [];
  }),
);

// The dev server writes scene and prefab files as people edit; accepting
// them here stops those updates before they reach GameCanvas and remount the game.
if (import.meta.hot) import.meta.hot.accept(() => {});

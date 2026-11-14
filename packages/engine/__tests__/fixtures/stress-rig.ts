import { readdirSync, readFileSync } from "node:fs";

import { createRegistry } from "../../game/define";
import type { GameDefinition, Registry } from "../../game/types";
import { expandScene } from "../../scene/expand";
import { parsePrefab, prefabLibrary } from "../../scene/prefab";
import type { ExpandedScene, PrefabLibrary, SceneDefinition } from "../../scene/types";

const repoFile = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(repoFile(path), "utf8")) as unknown;

const SCENES = "src/games/stress/scenes";
const PREFABS = `${SCENES}/prefabs`;

/** One of the stress game's scenes as its file holds it. */
export const stressScene = (name: string): SceneDefinition =>
  readJson(`${SCENES}/${name}.json`) as SceneDefinition;

export interface StressRig {
  game: GameDefinition;
  registry: Registry;
  prefabs: PrefabLibrary;
  /** A stress scene, by name or as a definition, expanded with the game's prefabs. */
  expand(scene: string | SceneDefinition): ExpandedScene;
}

/**
 * The stress game, its registry and its prefab library. It is loaded by
 * path so the engine's typecheck stays off the game.
 */
export async function stressRig(): Promise<StressRig> {
  const { stressGame: game } = (await import(
    /* @vite-ignore */ repoFile("src/games/stress/index.ts").href
  )) as { stressGame: GameDefinition };
  const registry = createRegistry(game);
  const prefabs = prefabLibrary(
    readdirSync(repoFile(PREFABS))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".asset.json"))
      .map((f) => {
        const parsed = parsePrefab(readJson(`${PREFABS}/${f}`), registry);
        if (!parsed.ok) throw new Error(`${f}: ${JSON.stringify(parsed.issues)}`);
        return parsed.prefab;
      }),
  );
  return {
    game,
    registry,
    prefabs,
    expand: (scene) =>
      expandScene(typeof scene === "string" ? stressScene(scene) : scene, registry, { prefabs }),
  };
}

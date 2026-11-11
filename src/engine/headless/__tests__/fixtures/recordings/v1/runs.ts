/**
 * What a replay of each frozen v1 recording needs: its game, registry,
 * scene, prefabs and Rapier, set up the way the recording was made.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { testGame } from "../../../../../__tests__/fixtures/test-game";
import { probe as roguelike } from "../../../../../__tests__/genres/roguelike.probe";
import { probe as turnTactics } from "../../../../../__tests__/genres/turn-tactics.probe";
import { createRegistry } from "../../../../../game/define";
import type { GameDefinition, Registry } from "../../../../../game/types";
import { parseProjectFile } from "../../../../../project/project-file";
import type { ProjectRuntimeView } from "../../../../../project/runtime-view";
import { scenePhysics } from "../../../../../scene/expand";
import type { PrefabLibrary, SceneDefinition } from "../../../../../scene/types";
import type { RapierModule } from "../../../../../types";
import { loadHeadless } from "../../../../load";
import type { InputScript, InputScriptV2 } from "../../../../playtest-types";
import type { V1Fixture } from "./index";

export const V1_DIR = new URL("./", import.meta.url);

const PLATFORMER_DIR = new URL("../../../../../../games/platformer/", import.meta.url);

/** The options `runPlaytest` made a fixture with, and `replayRecording` replays it with. */
export type V1Run = {
  rapier: RapierModule | null;
  game: GameDefinition | null;
  registry: Registry;
  scene: SceneDefinition;
  prefabs?: PrefabLibrary;
  library?: PrefabLibrary;
  project?: ProjectRuntimeView | null;
  script: InputScript | InputScriptV2;
};

const unjudged = {
  ...testGame,
  play: { ...testGame.play, outcome: undefined, movementActions: undefined },
} as GameDefinition;

/** A project's game, imported from the module its project file names, as a host loads it. */
async function projectGame(dir: URL): Promise<GameDefinition> {
  const parsed = parseProjectFile(readFileSync(new URL("jams.project.json", dir), "utf8"));
  if (!parsed.ok || !parsed.file.game) throw new Error(`no game in ${fileURLToPath(dir)}`);
  const { module, export: name } = parsed.file.game;
  const loaded = (await import(/* @vite-ignore */ new URL(module, dir).href)) as Record<
    string,
    GameDefinition
  >;
  const game = loaded[name];
  if (!game) throw new Error(`${module} has no export ${name}`);
  return game;
}

/** How `fixture` was played, on the frozen v3 scene it was made on. */
export async function v1Run(fixture: V1Fixture, rapier: RapierModule): Promise<V1Run> {
  const { source } = fixture;
  if (source.kind === "probe") {
    const probe = (source.probe === "roguelike" ? roguelike : turnTactics) as typeof roguelike;
    const game = probe.game as GameDefinition;
    const registry = createRegistry(game);
    return {
      rapier: scenePhysics(probe.scene, registry) === "rapier" ? rapier : null,
      game,
      registry,
      scene: probe.scene,
      prefabs: probe.prefabs,
      library: probe.prefabs,
      script: source.seed === undefined ? probe.script : { ...probe.script, seed: source.seed },
    };
  }
  const game =
    source.game === "test-game"
      ? (testGame as GameDefinition)
      : source.game === "test-game-unjudged"
        ? unjudged
        : source.game === "platformer"
          ? await projectGame(PLATFORMER_DIR)
          : null;
  const loaded = await loadHeadless({
    registry: createRegistry(game),
    files: { scene: readFileSync(new URL(source.scene, V1_DIR), "utf8") },
  });
  if (!fixture.script) throw new Error(`${fixture.file} names no script`);
  return {
    rapier: scenePhysics(loaded.scene, loaded.registry) === "rapier" ? rapier : null,
    game,
    registry: loaded.registry,
    scene: loaded.scene,
    prefabs: loaded.prefabs,
    library: loaded.library,
    project: loaded.project,
    script: fixture.script,
  };
}

/** The fixture's recording as its file holds it, unparsed. */
export function readV1Recording(fixture: V1Fixture): unknown {
  return JSON.parse(readFileSync(new URL(fixture.file, V1_DIR), "utf8"));
}

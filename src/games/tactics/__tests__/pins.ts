import type { ProjectRuntimeView } from "@jams/engine/game";
import type { FilesLoadInput } from "@jams/engine/headless";
import { gameSettingsValues, usableInputMap } from "@jams/engine/project";
import { createRegistry } from "@jams/engine/scene";
import { z } from "zod";

import { tacticsGame, UNIT_CLASS_ROW, UNIT_CLASS_TABLE } from "..";
import unitClasses from "../data/unit-classes.json";
import gameSettings from "../game-settings.json";
import inputMap from "../input-map.json";
import level1 from "../scenes/level-1.json";
import archer from "../scenes/prefabs/archer.json";
import knight from "../scenes/prefabs/knight.json";

/**
 * The end digest (`RunRecording.end`) that replaying
 * `fixtures/level-1.recording.json` reaches. One value for every platform:
 * the game is physics-free with integer grid rules, so arm64, x86_64, Bun
 * and every browser must agree. A mismatch anywhere is a determinism bug,
 * never a reason for a per-platform pin. Move it only for a change meant to
 * alter the run, after `UPDATE_GOLDENS=1` rewrites the recording.
 */
export const TACTICS_GOLDEN_DIGEST = "e2a58c6a80e955b3";

const classRow = z.object(UNIT_CLASS_ROW);

/**
 * What the pinned run reads as `EngineContext.project`: the project's own
 * game settings, unit classes and input map, read the way the scene CLI
 * reads them. JSON imports only, so the browser smoke builds the same view.
 */
export function tacticsProjectView(): ProjectRuntimeView {
  const registry = createRegistry(tacticsGame);
  const rows = Object.freeze(
    unitClasses.rows.flatMap((row) => {
      const parsed = classRow.safeParse(row);
      return parsed.success ? [Object.freeze({ id: row.id, ...parsed.data })] : [];
    }),
  );
  return {
    settings: Object.freeze(gameSettingsValues(registry, gameSettings.game)),
    engine: Object.freeze({ ...gameSettings.engine }),
    table: (name) => (name === UNIT_CLASS_TABLE ? rows : []),
    asset: () => undefined,
    inputMap: usableInputMap(inputMap, registry),
  };
}

/** Level 1, its prefabs and its project, for `loadHeadless`. */
export function tacticsGoldenInput(): FilesLoadInput {
  return {
    files: { scene: level1, prefabs: [knight, archer] },
    registry: createRegistry(tacticsGame),
    project: tacticsProjectView(),
  };
}

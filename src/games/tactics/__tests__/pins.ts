import type { ProjectRuntimeView } from "@jams/engine/game";
import type { FilesLoadInput } from "@jams/engine/headless";
import {
  heldProject,
  parseSidecar,
  type AssetSidecar,
  type HeldProject,
} from "@jams/engine/project";
import { createRegistry } from "@jams/engine/scene";

import { tacticsGame } from "..";
import icon192Sidecar from "../art/icon-192.png.asset.json";
import icon512Sidecar from "../art/icon-512.png.asset.json";
import marshSidecar from "../art/tile-marsh.png.asset.json";
import riverSidecar from "../art/tile-river.png.asset.json";
import rubbleSidecar from "../art/tile-rubble.png.asset.json";
import thicketSidecar from "../art/tile-thicket.png.asset.json";
import wallSidecar from "../art/tile-wall.png.asset.json";
import tilesSidecar from "../art/tiles.png.asset.json";
import unitsSidecar from "../art/units.json.asset.json";
import unitsTextureSidecar from "../art/units.png.asset.json";
import unitClasses from "../data/unit-classes.json";
import unitClassesSidecar from "../data/unit-classes.json.asset.json";
import gameSettings from "../game-settings.json";
import gameSettingsSidecar from "../game-settings.json.asset.json";
import inputMap from "../input-map.json";
import inputMapSidecar from "../input-map.json.asset.json";
import project from "../jams.project.json";
import { TACTICS_HELD_FILES, type TacticsHeldPath } from "../project-files";
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
export const TACTICS_GOLDEN_DIGEST = "0d59d480ac4a58bd";

function sidecar(raw: unknown): AssetSidecar {
  const parsed = parseSidecar(raw);
  if (!parsed.ok) throw new Error(`a tactics sidecar doesn't parse: ${parsed.issues[0]?.message}`);
  return parsed.sidecar;
}

/** Each held file's JSON import: its sidecar, and a doc's own JSON. */
const IMPORTS: Record<TacticsHeldPath, { sidecar: unknown; json?: unknown }> = {
  "game-settings.json": { sidecar: gameSettingsSidecar, json: gameSettings },
  "input-map.json": { sidecar: inputMapSidecar, json: inputMap },
  "data/unit-classes.json": { sidecar: unitClassesSidecar, json: unitClasses },
  "art/icon-192.png": { sidecar: icon192Sidecar },
  "art/icon-512.png": { sidecar: icon512Sidecar },
  "art/tile-marsh.png": { sidecar: marshSidecar },
  "art/tile-river.png": { sidecar: riverSidecar },
  "art/tile-rubble.png": { sidecar: rubbleSidecar },
  "art/tile-thicket.png": { sidecar: thicketSidecar },
  "art/tile-wall.png": { sidecar: wallSidecar },
  "art/tiles.png": { sidecar: tilesSidecar },
  "art/units.png": { sidecar: unitsTextureSidecar },
  "art/units.json": { sidecar: unitsSidecar },
};

/**
 * The project's `TACTICS_HELD_FILES` through `heldProject`, as the site's
 * game room reads them. JSON imports only, so the browser smoke builds the
 * same view.
 */
export function tacticsHeldProject(): HeldProject {
  return heldProject(
    TACTICS_HELD_FILES.map(({ path, doc }) => {
      const { sidecar: raw, json } = IMPORTS[path];
      return doc ? { path, json, sidecar: sidecar(raw) } : { path, sidecar: sidecar(raw) };
    }),
    createRegistry(tacticsGame),
    { projectId: project.id, name: project.name },
  );
}

/** What the pinned run reads as `EngineContext.project`. */
export function tacticsProjectView(): ProjectRuntimeView {
  return tacticsHeldProject().runtime;
}

/** Level 1, its prefabs and its project, for `loadHeadless`. */
export function tacticsGoldenInput(): FilesLoadInput {
  return {
    files: { scene: level1, prefabs: [knight, archer] },
    registry: createRegistry(tacticsGame),
    project: tacticsProjectView(),
  };
}

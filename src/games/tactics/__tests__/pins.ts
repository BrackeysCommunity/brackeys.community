import type { ProjectRuntimeView } from "@jams/engine/game";
import type { FilesLoadInput } from "@jams/engine/headless";
import { heldProject, parseSidecar, type AssetSidecar } from "@jams/engine/project";
import { createRegistry } from "@jams/engine/scene";

import { tacticsGame } from "..";
import marshSidecar from "../art/tile-marsh.png.asset.json";
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

function sidecar(raw: unknown): AssetSidecar {
  const parsed = parseSidecar(raw);
  if (!parsed.ok) throw new Error(`a tactics sidecar doesn't parse: ${parsed.issues[0]?.message}`);
  return parsed.sidecar;
}

/**
 * What the pinned run reads as `EngineContext.project`: the project's game
 * settings, unit classes, input map and art sidecars, through `heldProject`
 * as the site's game room reads them. JSON imports only, so the browser
 * smoke builds the same view.
 */
export function tacticsProjectView(): ProjectRuntimeView {
  return heldProject(
    [
      { path: "game-settings.json", json: gameSettings, sidecar: sidecar(gameSettingsSidecar) },
      { path: "input-map.json", json: inputMap, sidecar: sidecar(inputMapSidecar) },
      { path: "data/unit-classes.json", json: unitClasses, sidecar: sidecar(unitClassesSidecar) },
      { path: "art/tile-marsh.png", sidecar: sidecar(marshSidecar) },
      { path: "art/tile-thicket.png", sidecar: sidecar(thicketSidecar) },
      { path: "art/tile-wall.png", sidecar: sidecar(wallSidecar) },
      { path: "art/tiles.png", sidecar: sidecar(tilesSidecar) },
      { path: "art/units.png", sidecar: sidecar(unitsTextureSidecar) },
      { path: "art/units.json", sidecar: sidecar(unitsSidecar) },
    ],
    createRegistry(tacticsGame),
    { projectId: project.id, name: project.name },
  ).runtime;
}

/** Level 1, its prefabs and its project, for `loadHeadless`. */
export function tacticsGoldenInput(): FilesLoadInput {
  return {
    files: { scene: level1, prefabs: [knight, archer] },
    registry: createRegistry(tacticsGame),
    project: tacticsProjectView(),
  };
}

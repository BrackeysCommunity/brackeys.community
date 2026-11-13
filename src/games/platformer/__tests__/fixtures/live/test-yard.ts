import { fileURLToPath } from "node:url";

import type { StagedVersion } from "@jams/engine";
import { editedSceneVersion, projectInput } from "@jams/engine-testing";
import type { ProjectRuntimeView } from "@jams/engine/project";
import {
  applyOps,
  parseSceneOrThrow,
  sceneHash,
  type SceneDefinition,
  type SceneOp,
} from "@jams/engine/scene";

import { platformerGame } from "../../..";

const GAME_DIR = fileURLToPath(new URL("../../../", import.meta.url));

export const SCENE = "test-yard";

/** The spawn's feet in the test yard, where the player stands still. */
export const SPAWN_FEET = { x: 9.6, y: 10.2 } as const;

/** A step 0.2 m tall laid over the spawn: the player standing there is inside it. */
export const STEP_TOP = 10;
export const STEP_OVER_SPAWN: SceneOp[] = [
  { op: "addBulk", key: "solid", shapes: [["box", SPAWN_FEET.x, 10.1, 0.5, 0.1]] },
];

export type LiveFixture = {
  /** The release's own test yard. */
  release: SceneDefinition;
  /** The yard with `ops` applied, built into a version as `game live build` builds one. */
  version: StagedVersion;
  edited: SceneDefinition;
  project: ProjectRuntimeView;
};

/** The game's project as read from its files, shared by every version built from it. */
let read: ReturnType<typeof projectInput> | undefined;

/** A version of the test yard with `ops` applied, built from the game's project files. */
export async function testYardVersion(ops: SceneOp[] = STEP_OVER_SPAWN): Promise<LiveFixture> {
  read ??= projectInput(GAME_DIR, platformerGame);
  const { input, runtime: project } = await read;
  const release = parseSceneOrThrow(input.texts.get(SCENE)!, input.registry);
  const edit = applyOps(release, { base: sceneHash(release), ops }, input.registry, {
    validate: "none",
  });
  if (!edit.ok) throw new Error(edit.issue.message);
  const version = await editedSceneVersion(input, SCENE, edit.def);
  return { release, version, edited: edit.def, project };
}

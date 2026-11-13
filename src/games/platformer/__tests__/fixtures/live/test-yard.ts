import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { StagedVersion } from "@jams/engine";
import { createRegistry, withProject } from "@jams/engine/game";
import {
  buildSceneVersion,
  heldProject,
  snapshotProject,
  type HeldFile,
  type ProjectRuntimeView,
} from "@jams/engine/project";
import {
  applyOps,
  formatScene,
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

/** The game's own project files as the scene CLI reads them (its scenes and scene list), docs by path. */
function readProject(): { files: HeldFile[]; texts: Map<string, string> } {
  const files: HeldFile[] = [];
  const texts = new Map<string, string>();
  const add = (path: string) => {
    const text = readFileSync(join(GAME_DIR, path), "utf8");
    texts.set(path, text);
    files.push({ path, json: JSON.parse(text), sidecar: null });
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".json")) add(relative(GAME_DIR, full).split("\\").join("/"));
    }
  };
  walk(join(GAME_DIR, "scenes"));
  add("scene-list.json");
  return { files, texts };
}

export type LiveFixture = {
  /** The release's own test yard. */
  release: SceneDefinition;
  /** The yard with `ops` applied, built into a version as `game live build` builds one. */
  version: StagedVersion;
  edited: SceneDefinition;
  project: ProjectRuntimeView;
};

/** A version of the test yard with `ops` applied, built from the game's project files with `buildSceneVersion`. */
export async function testYardVersion(ops: SceneOp[] = STEP_OVER_SPAWN): Promise<LiveFixture> {
  const { files, texts: byPath } = readProject();
  const registry = createRegistry(platformerGame);
  const release = parseSceneOrThrow(byPath.get(`scenes/${SCENE}.json`)!, registry);
  const edit = applyOps(release, { base: sceneHash(release), ops }, registry, { validate: "none" });
  if (!edit.ok) throw new Error(edit.issue.message);
  byPath.set(`scenes/${SCENE}.json`, formatScene(edit.def).text);

  const held = heldProject(
    files.map((f) => ({ ...f, json: JSON.parse(byPath.get(f.path)!) })),
    registry,
    { projectId: "platformer", name: "Platformer" },
  );
  const texts = new Map<string, string>();
  const values = new Map<string, unknown>();
  for (const entry of held.view.byId.values()) {
    const text = byPath.get(entry.path);
    if (text === undefined) continue;
    texts.set(entry.id, text);
    values.set(entry.id, JSON.parse(text));
  }
  const snapshot = await snapshotProject(held.view, texts, held.view.state.build);
  const built = await buildSceneVersion({
    view: held.view,
    texts,
    build: snapshot.build,
    game: platformerGame,
    registry: withProject(registry, held.view, values),
    scene: SCENE,
  });
  if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 2));
  return {
    release,
    version: { id: built.id, version: built.version, texts: built.texts },
    edited: edit.def,
    project: held.runtime,
  };
}

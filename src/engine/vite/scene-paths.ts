import { isAbsolute, join, relative, resolve } from "node:path";

import { PROJECT_FILE } from "../project/types";

/** Scene names are file stems: lowercase letters, digits and dashes, starting with a letter or digit. */
export const SCENE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export class ScenePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenePathError";
  }
}

export function assertSceneName(name: string): void {
  if (!SCENE_NAME_PATTERN.test(name)) {
    throw new ScenePathError(
      `Invalid scene name ${JSON.stringify(name)}: use 1-48 lowercase letters, digits and dashes, starting with a letter or digit.`,
    );
  }
}

/** The file for scene `name` inside `dir`. Throws `ScenePathError` for a bad name or a path that leaves `dir`. */
export function resolveScenePath(dir: string, name: string): string {
  assertSceneName(name);
  const root = resolve(dir);
  const file = resolve(join(root, `${name}.json`));
  const rel = relative(root, file);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ScenePathError(`Scene ${JSON.stringify(name)} resolves outside ${root}.`);
  }
  return file;
}

/**
 * The scene name for a file name in the scenes directory, or null when it
 * isn't one. The project file, schemas, sidecars and `.checks.json` files
 * have a dot in their stem, so they never are.
 */
export function sceneNameOf(fileName: string): string | null {
  if (!fileName.endsWith(".json") || fileName === PROJECT_FILE) return null;
  const name = fileName.slice(0, -".json".length);
  return SCENE_NAME_PATTERN.test(name) ? name : null;
}

/**
 * Hosted scene ids: `<project>.<key>`, each part an engine id (lowercase,
 * digits and dashes), so the id is also the doc's name after `scene:`.
 * Scenes hosted before projects existed are `<game>.<name>`, which is the
 * same grammar with the game as the project. Shared with services, so no
 * `@/` imports.
 */
// The scene entry by relative path: the service image has no tsconfig paths.
import { ENGINE_REGISTRY_ID } from "../../engine/scene/index.ts";
import { parseProjectKey } from "../canvas/sync-channels.ts";

export interface SceneId {
  /** The project the scene belongs to; `engine` for the engine's primitives. */
  project: string;
  /** The scene's asset key, which never changes. */
  key: string;
}

export function parseSceneId(id: unknown): SceneId | null {
  if (typeof id !== "string") return null;
  return parseProjectKey(id);
}

export const isSceneId = (id: unknown): id is string => parseSceneId(id) !== null;

/**
 * The `game` a new scene's header names: its project, which for a scene
 * hosted before projects is its game; undefined for the engine's primitives.
 */
export const sceneGame = (id: Pick<SceneId, "project">): string | undefined =>
  id.project === ENGINE_REGISTRY_ID ? undefined : id.project;

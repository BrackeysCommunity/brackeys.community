/**
 * Hosted scene ids: `<game>.<name>`, each part an engine id (lowercase, digits
 * and dashes), so the id is also the doc's name after `scene:`. Shared with
 * services, so no `@/` imports.
 */
// The scene entry by relative path: the service image has no tsconfig paths.
import { ENGINE_REGISTRY_ID, ID_PATTERN } from "../../engine/scene/index.ts";

export interface SceneId {
  /** The registry the scene belongs to; `engine` for primitives only. */
  game: string;
  name: string;
}

export function parseSceneId(id: unknown): SceneId | null {
  if (typeof id !== "string") return null;
  const dot = id.indexOf(".");
  if (dot < 0) return null;
  const game = id.slice(0, dot);
  const name = id.slice(dot + 1);
  return ID_PATTERN.test(game) && ID_PATTERN.test(name) ? { game, name } : null;
}

export const isSceneId = (id: unknown): id is string => parseSceneId(id) !== null;

/** The `game` a scene's header names, or undefined for the engine's primitives. */
export const sceneGame = (id: SceneId): string | undefined =>
  id.game === ENGINE_REGISTRY_ID ? undefined : id.game;

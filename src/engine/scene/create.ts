import { ENGINE_REGISTRY_ID, type Registry, type SceneTemplate } from "../game/types";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "./types";

/** A new scene's content when its game gives no template: an empty 1920×1080 world. */
export const EMPTY_SCENE_TEMPLATE: SceneTemplate = { bounds: [0, 0, 1920, 1080] };

/**
 * A new scene named `name` for `registry`'s game (none for the engine's):
 * the header, then `template`, else the game's own `template`, else
 * `EMPTY_SCENE_TEMPLATE`. `$schema` is written first when given.
 */
export function createScene(
  name: string,
  registry: Registry,
  opts: { template?: SceneTemplate; $schema?: string } = {},
): SceneDefinition {
  const content = structuredClone(opts.template ?? registry.game?.template ?? EMPTY_SCENE_TEMPLATE);
  return {
    ...(opts.$schema === undefined ? {} : { $schema: opts.$schema }),
    v: SCENE_FORMAT_VERSION,
    ...(registry.id === ENGINE_REGISTRY_ID ? {} : { game: registry.id }),
    name,
    ...content,
  };
}

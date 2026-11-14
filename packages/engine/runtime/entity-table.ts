import type { RuntimeEntity } from "../scene/types";

/**
 * The runtime's live entities by id, in spawn order. What sits under an
 * entity is the scene tree's to say (`EngineContext.tree`), not its id's.
 */
export class EntityTable extends Map<string, RuntimeEntity> {}

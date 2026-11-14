import type { RuntimeEntity } from "../scene/types";

/**
 * The runtime's live entities by id, in spawn order. What sits under an
 * entity is the scene tree's to say (`EngineContext.tree`), not its id's.
 * `version` changes with every write, so a record read from the table
 * may be kept and reused for as long as it holds.
 */
export class EntityTable extends Map<string, RuntimeEntity> {
  version = 0;

  override set(id: string, e: RuntimeEntity): this {
    this.version++;
    return super.set(id, e);
  }

  override delete(id: string): boolean {
    this.version++;
    return super.delete(id);
  }

  override clear(): void {
    this.version++;
    super.clear();
  }
}

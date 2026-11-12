import type { RuntimeEntity } from "../scene/types";

/**
 * The runtime's live entities by id, in spawn order. It also counts the ids
 * under each instance id (`gate-1/bar` is under `gate-1`, and
 * `room-1/door-1/panel` under both `room-1` and `room-1/door-1`), so asking
 * whether an instance has anything live doesn't walk every entity.
 */
export class EntityTable extends Map<string, RuntimeEntity> {
  readonly #under = new Map<string, number>();

  /** Whether any live id sits under instance id `id`, at any depth. */
  hasUnder(id: string): boolean {
    return this.#under.has(id);
  }

  override set(id: string, entity: RuntimeEntity): this {
    if (!this.has(id)) this.#count(id, 1);
    return super.set(id, entity);
  }

  override delete(id: string): boolean {
    const had = super.delete(id);
    if (had) this.#count(id, -1);
    return had;
  }

  override clear(): void {
    super.clear();
    this.#under.clear();
  }

  #count(id: string, by: number): void {
    for (let at = id.indexOf("/"); at !== -1; at = id.indexOf("/", at + 1)) {
      const instance = id.slice(0, at);
      const n = (this.#under.get(instance) ?? 0) + by;
      if (n > 0) this.#under.set(instance, n);
      else this.#under.delete(instance);
    }
  }
}

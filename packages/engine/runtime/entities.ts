import type { BehaviorName } from "../game/behaviors";
import type { BehaviorKey, Entity, HandleOf } from "../game/entity";
import { behaviorNameOf } from "../game/script";
import { EngineError, type EngineContext, type SceneTree } from "../game/types";
import { ownChildId } from "../scene/resolve";
import { tagFieldsOf } from "../scene/schema";
import type { RuntimeEntity } from "../scene/types";
import type { BehaviorHost } from "./behaviors";
import type { EntityTable } from "./entity-table";
import type { Pose } from "./poses";
import type { StepEvent } from "./types";

export type EntityHandleDeps = {
  ctx: EngineContext;
  behaviors: BehaviorHost;
  /** The runtime's live entities: a handle lives as long as its record is here. */
  entities: EntityTable;
  /**
   * `id`'s own switch, which the lifecycle keeps beside the effective
   * state. Without it every live entity answers its effective state.
   */
  enabledSelf?: (id: string) => boolean;
};

/** The runtime's entity handles: `EngineContext.entity`, one per live entity. */
export type EntityHandles = {
  entity(id: string): Entity | undefined;
  /** Forgets every handle; at unload. */
  clear(): void;
};

/** What every handle of one runtime reads through. */
type HandleHost = EntityHandleDeps & {
  made: ReadonlyMap<string, Entity>;
  /** `EntityHandles.entity`: the handle of a live entity. */
  entity(id: string): Entity | undefined;
  /** The live record: the one being attached, else the table's. */
  record(id: string): RuntimeEntity | undefined;
};

/**
 * One entity's handle. Its members are accessors on the prototype, so
 * printing or comparing a handle reads nothing and a gone one doesn't throw.
 */
class EntityHandle implements Entity {
  readonly id: string;
  readonly #host: HandleHost;

  constructor(id: string, host: HandleHost) {
    this.id = id;
    this.#host = host;
  }

  get alive(): boolean {
    return this.#host.made.get(this.id) === this && this.#host.record(this.id) !== undefined;
  }

  /** The live record, or `entity-gone`. */
  #live(): RuntimeEntity {
    const e = this.#host.made.get(this.id) === this ? this.#host.record(this.id) : undefined;
    if (!e) {
      throw new EngineError(
        "entity-gone",
        `entity "${this.id}" was destroyed: its handle no longer reaches it`,
        this.id,
      );
    }
    return e;
  }

  #handle(id: string | null): Entity | undefined {
    return id === null ? undefined : this.#host.entity(id);
  }

  /** `def`'s handles on `ids` in order, only the first with `first`; disabled entities skipped, as `ctx.findBehavior` does. */
  #behaviorsOn(ids: Iterable<string>, def: BehaviorKey | BehaviorName, first: boolean): object[] {
    const name = behaviorNameOf(def);
    const { ctx, behaviors } = this.#host;
    const out: object[] = [];
    for (const id of ids) {
      const e = ctx.enabled(id) ? this.#host.record(id) : undefined;
      const found = e && behaviors.handle(e, name);
      if (!found) continue;
      out.push(found);
      if (first) break;
    }
    return out;
  }

  get type(): RuntimeEntity["type"] {
    return this.#live().type;
  }

  get record(): RuntimeEntity {
    return this.#live();
  }

  get pose(): Readonly<Pose> {
    this.#live();
    return this.#host.ctx.poses.get(this.id)!;
  }

  setPose(x: number, y: number, rot?: number, opts?: { snap?: boolean }): void {
    this.#live();
    this.#host.ctx.setPose(this.id, x, y, rot, opts);
  }

  hasTag(tag: string): boolean {
    const e = this.#live();
    for (const field of tagFieldsOf(this.#host.ctx.registry.types.get(e.type))) {
      const value = e[field];
      if (Array.isArray(value) && value.includes(tag)) return true;
    }
    return false;
  }

  get enabled(): boolean {
    this.#live();
    return this.#host.ctx.enabled(this.id);
  }

  get enabledSelf(): boolean {
    this.#live();
    const { enabledSelf, ctx } = this.#host;
    return enabledSelf ? enabledSelf(this.id) : ctx.enabled(this.id);
  }

  setEnabled(on: boolean): void {
    this.#live();
    this.#host.ctx.setEnabled(this.id, on);
  }

  destroy(): void {
    this.#live();
    this.#host.ctx.destroy(this.id);
  }

  getBehavior<D extends BehaviorKey = never>(def: D | BehaviorName): HandleOf<D> | undefined {
    return this.#host.behaviors.handle(this.#live(), behaviorNameOf(def)) as
      | HandleOf<D>
      | undefined;
  }

  behaviors(): readonly BehaviorName[] {
    const blocks = this.#live().behaviors ?? {};
    return Object.keys(blocks).filter((name) => blocks[name]);
  }

  on(type: string, handler: (e: StepEvent) => void): () => void {
    this.#live();
    return this.#host.ctx.events.on(type, handler, { entity: this.id, owner: this.id });
  }

  get parent(): Entity | null {
    this.#live();
    return this.#handle(this.#host.ctx.tree.parent(this.id)) ?? null;
  }

  get children(): readonly Entity[] {
    this.#live();
    const out: Entity[] = [];
    for (const id of this.#host.ctx.tree.children(this.id)) {
      const child = this.#handle(id);
      if (child) out.push(child);
    }
    return out;
  }

  get root(): Entity {
    this.#live();
    return this.#handle(this.#host.ctx.tree.root(this.id)) ?? this;
  }

  get localPose(): Readonly<Pose> {
    this.#live();
    return this.#host.ctx.tree.local(this.id)!;
  }

  setLocalPose(x: number, y: number, rot?: number): void {
    this.#live();
    this.#host.ctx.tree.setLocal(this.id, x, y, rot);
  }

  setParent(parent: Entity | string | null, opts?: { keepWorld?: boolean }): void {
    this.#live();
    const to = parent === null || typeof parent === "string" ? parent : parent.id;
    this.#host.ctx.tree.setParent(this.id, to, opts);
  }

  /** Each segment names a child by its own id: the last `/` segment of the child's id. */
  find(path: string): Entity | undefined {
    this.#live();
    const { tree } = this.#host.ctx;
    let at = this.id;
    for (const segment of path.split("/")) {
      const next = segment
        ? tree.children(at).find((child) => ownChildId(child) === segment)
        : undefined;
      if (next === undefined) return undefined;
      at = next;
    }
    return this.#handle(at);
  }

  /** This entity, then its descendants depth first in child order; enabled ones only. */
  getBehaviorInChildren<D extends BehaviorKey = never>(
    def: D | BehaviorName,
  ): HandleOf<D> | undefined {
    this.#live();
    return this.#behaviorsOn(this.#host.ctx.tree.subtree(this.id), def, true)[0] as
      | HandleOf<D>
      | undefined;
  }

  getBehaviorsInChildren<D extends BehaviorKey = never>(
    def: D | BehaviorName,
  ): readonly HandleOf<D>[] {
    this.#live();
    return this.#behaviorsOn(this.#host.ctx.tree.subtree(this.id), def, false) as HandleOf<D>[];
  }

  /** This entity, then each ancestor up to the root; enabled ones only. */
  getBehaviorInParent<D extends BehaviorKey = never>(
    def: D | BehaviorName,
  ): HandleOf<D> | undefined {
    this.#live();
    return this.#behaviorsOn(ancestry(this.#host.ctx.tree, this.id), def, true)[0] as
      | HandleOf<D>
      | undefined;
  }
}

function* ancestry(tree: SceneTree, id: string): Generator<string> {
  for (let at: string | null = id; at !== null; at = tree.parent(at)) yield at;
}

/**
 * The handle cache. A handle is dropped when its entity's record leaves the
 * entity table, so an entity spawned later under the same id gets a new
 * one; a disabled entity stays in the table and keeps its handle. The
 * runtime reorders the table by clearing and refilling it, so only a
 * `delete` drops one.
 */
export function createEntityHandles(deps: EntityHandleDeps): EntityHandles {
  const { entities, behaviors } = deps;
  const made = new Map<string, Entity>();
  const record = (id: string) => behaviors.attaching(id) ?? entities.get(id);
  const host: HandleHost = { ...deps, made, record, entity };

  const remove = entities.delete.bind(entities);
  entities.delete = (id) => {
    made.delete(id);
    return remove(id);
  };

  function entity(id: string): Entity | undefined {
    if (!record(id)) {
      // A handle made while a spawn attached, which then failed, never reached the table.
      made.delete(id);
      return undefined;
    }
    let handle = made.get(id);
    if (!handle) made.set(id, (handle = new EntityHandle(id, host)));
    return handle;
  }

  return {
    entity,
    clear() {
      made.clear();
    },
  };
}

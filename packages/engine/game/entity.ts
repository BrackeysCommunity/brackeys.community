/**
 * The entity handle: a view of one live entity by id that holds nothing of
 * its own. Types only, so the canvas-sync image can carry it.
 */
import type { z } from "zod";

import type { Pose } from "../runtime/poses";
import type { StepEvent } from "../runtime/types";
import type { EntityTypeName, RuntimeEntity } from "../scene/types";
import type { BehaviorBlock, BehaviorDef, BehaviorName } from "./behaviors";
import type { ScriptClass } from "./script";

/** What names a behavior to `getBehavior` and `ctx.findBehavior`: its definition or a script class. */
export type BehaviorKey = BehaviorDef | ScriptClass;

/**
 * What `getBehavior(def)` returns: a script class's instance; a
 * definition's typed block as `fields`, with its handle type's members;
 * `{ fields }` for a name.
 */
export type HandleOf<D> = [D] extends [never]
  ? Readonly<{ fields: BehaviorBlock }>
  : D extends abstract new () => infer I
    ? I
    : D extends BehaviorDef<infer F, infer H>
      ? Readonly<{ fields: Readonly<z.infer<z.ZodObject<F>>> }> & H
      : Readonly<{ fields: BehaviorBlock }>;

/**
 * One live entity, by id: `ctx.entity(id)` gives the same object every
 * time. Every member reads the runtime's tables. Once the entity is
 * destroyed `alive` is false, `id` still answers, and every other member
 * throws `EngineError("entity-gone")`.
 */
export interface Entity<F extends object = Record<string, unknown>> {
  readonly id: string;
  readonly type: EntityTypeName;
  readonly alive: boolean;
  /** The entity's fields, as `ctx.get(id)` gives them. */
  readonly record: RuntimeEntity<F>;
  /** World pose; `setPose` moves it through whoever owns it. */
  readonly pose: Readonly<Pose>;
  setPose(x: number, y: number, rot?: number, opts?: { snap?: boolean }): void;
  hasTag(tag: string): boolean;
  /** On, and every ancestor on. `enabledSelf` is this entity's own switch. */
  readonly enabled: boolean;
  readonly enabledSelf: boolean;
  setEnabled(on: boolean): void;
  destroy(): void;
  /**
   * The behavior's handle: undefined when the entity doesn't carry it, or
   * carries it but its system isn't built (a visual-only behavior headless).
   */
  getBehavior<D extends BehaviorKey = never>(def: D | BehaviorName): HandleOf<D> | undefined;
  behaviors(): readonly BehaviorName[];
  /** Step events about this entity; the subscription ends with it. */
  on(type: string, handler: (e: StepEvent) => void): () => void;

  readonly parent: Entity | null;
  readonly children: readonly Entity[];
  readonly root: Entity;
  /** The pose in the parent's frame; the world pose for a root. */
  readonly localPose: Readonly<Pose>;
  setLocalPose(x: number, y: number, rot?: number): void;
  setParent(parent: Entity | string | null, opts?: { keepWorld?: boolean }): void;
  /** A descendant by a path of child ids: `find("door/panel")`. */
  find(path: string): Entity | undefined;
  getBehaviorInChildren<D extends BehaviorKey = never>(
    def: D | BehaviorName,
  ): HandleOf<D> | undefined;
  getBehaviorsInChildren<D extends BehaviorKey = never>(
    def: D | BehaviorName,
  ): readonly HandleOf<D>[];
  getBehaviorInParent<D extends BehaviorKey = never>(
    def: D | BehaviorName,
  ): HandleOf<D> | undefined;
}

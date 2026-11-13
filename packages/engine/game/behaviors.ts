/**
 * Behaviors: typed blocks of fields any entity type may carry, with an
 * optional runtime half. Zod only, so it loads on a server; the engine's own
 * systems are mapped elsewhere, so `./game` and `./scene` never reach a
 * renderer.
 */
import type { z } from "zod";

import type { RuntimeEntity } from "../scene/types";
import type { EngineContext, FieldEnv, JsonValue } from "./types";

/** `sprite`, or a game's `<gameId>/<name>`. */
export type BehaviorName = string;
export const BEHAVIOR_NAME_PATTERN = /^(?:[a-z0-9][a-z0-9-]{0,47}\/)?[a-z0-9][a-z0-9-]{0,47}$/;
/** The reserved entity key that holds behavior blocks. */
export const BEHAVIORS_FIELD = "behaviors";

/** One behavior's fields on one entity, defaults applied. */
export type BehaviorBlock = Readonly<Record<string, unknown>>;

export type BehaviorDef<F extends z.ZodRawShape = z.ZodRawShape> = {
  name: BehaviorName;
  /** One sentence for the JSON Schema, `codes`, `show` and the inspector. */
  description: string;
  /** The block's fields; a function when one depends on the registry or the project (an asset enum). */
  fields: F | ((env: FieldEnv) => F);
  /** The runtime half; omitted for a data-only block game code reads. */
  system?: BehaviorSystemFactory;
  /** Behaviors the same entity must also carry (`anim` requires `sprite`); `behavior-missing` otherwise. */
  requires?: readonly BehaviorName[];
  /** Behaviors the same entity must not also carry; `behavior-conflict` otherwise. */
  conflicts?: readonly BehaviorName[];
  /** Never changes simulation state: built only with a view, never headless. */
  visualOnly?: boolean;
  /**
   * `category` is the editor's Add behavior heading; a behavior without one
   * lists under Game.
   */
  inspector?: {
    label?: string;
    order?: readonly string[];
    category?: "physics" | "movement" | "world" | "visual";
  };
  /**
   * A check across the block's fields that a field shape can't say
   * ("exactly one of `ticks` or `ms`"): the message of a `schema` issue, or
   * undefined when the block is fine. Runs after the fields parse.
   */
  refine?(block: BehaviorBlock): string | undefined;
  /**
   * The block the editor's Add behavior writes, before required fields are
   * seeded; default `{}`. Give one when `{}` fails `refine`.
   */
  template?: BehaviorBlock;
};

export type BehaviorCategory = NonNullable<NonNullable<BehaviorDef["inspector"]>["category"]>;

/** The Add behavior menu's headings, in the order it lists them. */
export const BEHAVIOR_CATEGORIES: readonly BehaviorCategory[] = Object.freeze([
  "physics",
  "movement",
  "world",
  "visual",
]);

/** Identity at runtime; types the definition. Names and rules are checked when a registry is built. */
export function defineBehavior<F extends z.ZodRawShape>(def: BehaviorDef<F>): BehaviorDef<F> {
  return def;
}

export type RegisteredBehavior = BehaviorDef & {
  /** `engine`, or the game's id. */
  origin: string;
  /** Fields resolved against this registry. */
  shape: z.ZodRawShape;
  /** Position in registration order: what attach, step and detach follow. */
  index: number;
};

/** A behavior's runtime half. */
export interface BehaviorSystem<B extends BehaviorBlock = BehaviorBlock> {
  /** After the entity's type system spawned it, in registration order. */
  attach(entityId: string, block: B, entity: RuntimeEntity): void;
  /** Before the type system despawns it, in reverse order. Idempotent. */
  detach(entityId: string): void;
  /** The block changed; without it the host detaches and attaches. */
  update?(entityId: string, block: B, prev: B, entity: RuntimeEntity): void;
  /** Each tick, after the game's `beforeStep`, before the type systems' `beforePhysics`. */
  beforeStep?(dtMs: number): void;
  /**
   * Each tick, after the type systems' `beforePhysics`, before the physics
   * step; without physics, right after the behaviors' `beforeStep`.
   */
  beforePhysics?(): void;
  /** Each tick, after the type systems' `afterStep`, before the game's. */
  step?(dtMs: number): void;
  /** Each rendered frame, after `view.frame`; only for visual behaviors, never headless. */
  render?(alpha: number): void;
  /** Back to t = 0; `seek` moves time-driven state on, as `SceneSystem.seek` does. */
  reset?(): void;
  seek?(ms: number): void;
  clear(): void;
  size(): number;
  /** After a load's or a spawn's entities attached, with the ids carrying this behavior in spawn order. */
  ready?(ids: readonly string[]): void;
  /** The entity is disabled; without it the host detaches the block, and attaches it again on enable. */
  disable?(entityId: string): void;
  enable?(entityId: string): void;
  /** The block's state on `entityId` that a world save needs (a timer's progress); undefined for none. */
  save?(entityId: string): JsonValue | undefined;
  /** Puts back what `save` returned, after the block was attached again. */
  restore?(entityId: string, state: JsonValue): void;
}

export type BehaviorSystemFactory = (ctx: EngineContext, def: RegisteredBehavior) => BehaviorSystem;

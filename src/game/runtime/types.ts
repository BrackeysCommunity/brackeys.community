import type { MovementState } from "../entities/player";
import type { ExpandedScene, RuntimeBehavior, RuntimeEntity } from "../scene/types";
import type { InputAction, Vec2 } from "../types";

export type LoadReport =
  | { ok: true; counts: Partial<Record<RuntimeBehavior, number>>; ms: number }
  | { ok: false; error: string; entityId?: string };

/**
 * Something that happened during one tick, naming entities by id:
 * `cheese`, `hole` and `lava` from sensors, `landed` (on the ground's entity)
 * and `left-ground`.
 */
export type StepEvent = { tick: number; type: string; entityId?: string; at: Vec2 };

export type PlayerSnapshot = {
  position: Vec2;
  velocity: Vec2;
  state: MovementState;
  grounded: boolean;
  groundId?: string;
};

export type StepResult = {
  /** The tick just simulated, counting from 0 after each load. */
  tick: number;
  events: StepEvent[];
  player: PlayerSnapshot;
};

export type RuntimeStats = {
  bodies: number;
  colliders: number;
  tags: number;
  fields: number;
  entities: number;
  perBehavior: Partial<Record<RuntimeBehavior, number>>;
};

export type SceneRuntime = {
  /** Replaces the current scene; a scene with duplicate ids is rejected before anything changes. */
  load: (scene: ExpandedScene) => LoadReport;
  unload: () => void;
  get: (id: string) => RuntimeEntity | undefined;
  step: (dtMs: number, actions: InputAction[]) => StepResult;
  stats: () => RuntimeStats;
  destroy: () => void;
};

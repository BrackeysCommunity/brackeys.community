import type { BehaviorSystemFactory } from "../../game/behaviors";
import { createSpriteSystem } from "./sprite";

/** The engine's behavior systems by behavior name, as `runtime/primitives.ts` maps primitives. */
export const ENGINE_BEHAVIOR_SYSTEMS: Readonly<Record<string, BehaviorSystemFactory>> =
  Object.freeze({ sprite: createSpriteSystem });

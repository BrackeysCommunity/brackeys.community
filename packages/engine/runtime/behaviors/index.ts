import type { BehaviorSystemFactory } from "../../game/behaviors";
import { createBodySystem } from "./body";
import { createCameraTargetSystem } from "./camera-target";
import { createCharacterSideViewSystem } from "./character-side-view";
import { createCharacterTopDownSystem } from "./character-top-down";
import { createColliderSystem } from "./collider";
import { createForceAreaSystem } from "./force-area";
import { createJointSystem } from "./joint";
import { createLifetimeSystem } from "./lifetime";
import { createNavAgentSystem } from "./nav-agent";
import { createOccupantSystem } from "./occupant";
import { createPathFollowSystem } from "./path-follow";
import { createPlayerInputSystem } from "./player-input";
import { createSpawnerSystem } from "./spawner";
import { createSpriteSystem } from "./sprite";

/**
 * The engine's behavior systems by behavior name, as `runtime/primitives.ts`
 * maps primitives.
 */
export const ENGINE_BEHAVIOR_SYSTEMS: Readonly<Record<string, BehaviorSystemFactory>> =
  Object.freeze({
    sprite: createSpriteSystem,
    occupant: createOccupantSystem,
    lifetime: createLifetimeSystem,
    collider: createColliderSystem,
    body: createBodySystem,
    "player-input": createPlayerInputSystem,
    "path-follow": createPathFollowSystem,
    "force-area": createForceAreaSystem,
    "character-top-down": createCharacterTopDownSystem,
    "character-side-view": createCharacterSideViewSystem,
    "nav-agent": createNavAgentSystem,
    joint: createJointSystem,
    spawner: createSpawnerSystem,
    "camera-target": createCameraTargetSystem,
  });

import type { PhysicsWorld } from "../physics";
import type { RapierModule } from "../types";
import type { EngineContext } from "./types";

/** Something that needs Rapier ran in a scene loaded without physics. */
export class PhysicsRequiredError extends Error {
  readonly code = "physics-required";
  /** A type, a system or a call. */
  readonly what: string;
  readonly entityId: string | undefined;
  constructor(what: string, entityId?: string) {
    super(
      entityId === undefined
        ? `${what} needs physics, and this scene has none`
        : `${what} "${entityId}" needs physics, and this scene has none`,
    );
    this.name = "PhysicsRequiredError";
    this.what = what;
    this.entityId = entityId;
  }
}

/** Rapier and the world, or a PhysicsRequiredError naming `what` (a type, a system, a call). */
export function physicsOf(
  ctx: Pick<EngineContext, "rapier" | "physics">,
  what: string,
  entityId?: string,
): { rapier: RapierModule; physics: PhysicsWorld } {
  const { rapier, physics } = ctx;
  if (!rapier || !physics) throw new PhysicsRequiredError(what, entityId);
  return { rapier, physics };
}

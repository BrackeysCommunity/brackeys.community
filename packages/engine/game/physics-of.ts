import type { PhysicsWorld } from "../physics";
import type { RapierModule } from "../types";
import { EngineError, type EngineContext } from "./types";

/** Something that needs Rapier ran in a scene loaded without physics: an `EngineError` with code `physics-required`. */
export class PhysicsRequiredError extends EngineError {
  /** A type, a system or a call. */
  readonly what: string;
  constructor(what: string, entityId?: string) {
    super(
      "physics-required",
      entityId === undefined
        ? `${what} needs physics, and this scene has none`
        : `${what} "${entityId}" needs physics, and this scene has none`,
      entityId,
    );
    this.name = "PhysicsRequiredError";
    this.what = what;
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

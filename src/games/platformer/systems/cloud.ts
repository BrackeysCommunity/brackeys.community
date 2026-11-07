import {
  createSolidSystem,
  type EngineContext,
  type RegisteredType,
  type SolidSystem,
  type Style,
} from "@jams/engine/game";

import { PLATFORMER_LAYERS } from "../layers";
import type { CloudEntity } from "../types";
import { withVisuals } from "./visuals";

/** A cloud's collider when it has no material. */
const CLOUD_SURFACE = { friction: 0.7, restitution: 0 };

/** Clouds' collision group: they touch the player only, so props and constructs fall through. */
export const CLOUD_GROUP = "cloud";

export const CLOUD_LOOK = { color: 0xffffff, alpha: 0.5 };
/** Dimmed while the actor can pass through it. */
const PASS_THROUGH_LOOK = { color: 0x666688, alpha: 0.25 };

const cloudStyle = ({ color, alpha }: typeof CLOUD_LOOK): Style => ({
  fill: color,
  stroke: color,
  alpha: alpha * 0.3,
  strokeAlpha: alpha,
});
const SOLID_STYLE = cloudStyle(CLOUD_LOOK);
const PASS_THROUGH_STYLE = cloudStyle(PASS_THROUGH_LOOK);

/**
 * Clouds: one-way solids, box only. The engine's solid system does the
 * physics and the pass-through; this draws each cloud, dimmed while the
 * actor can pass through it.
 */
export function createCloudSystem(ctx: EngineContext, type: RegisteredType): SolidSystem {
  const inner = createSolidSystem(ctx, type, {
    ...CLOUD_SURFACE,
    oneWay: true,
    group: CLOUD_GROUP,
    draw: false,
  });

  const boxOnly = (e: CloudEntity) => {
    if (e.shape.type !== "box") throw new Error(`${type.type} ${e.id} must be a box`);
  };

  const { system, visuals } = withVisuals<CloudEntity, SolidSystem>(
    ctx,
    {
      ...inner,
      spawn(e: CloudEntity) {
        boxOnly(e);
        inner.spawn(e);
      },
      update(e: CloudEntity, prev: CloudEntity) {
        boxOnly(e);
        inner.update!(e, prev);
      },
    },
    PLATFORMER_LAYERS.cloud,
    (e) => (inner.isHidden(e.id) ? PASS_THROUGH_STYLE : SOLID_STYLE),
  );

  return {
    ...system,
    gateOneWay(actorBottomY, dropping) {
      inner.gateOneWay(actorBottomY, dropping);
      visuals.refresh();
    },
    reset() {
      inner.reset?.();
      visuals.refresh();
    },
  };
}

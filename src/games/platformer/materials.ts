import type { MaterialDef } from "@jams/engine/game";

/** Surface materials a solid or mover can take; `solid:<material>` bulk keys come from these. */
export const PLATFORMER_MATERIALS = {
  ice: {
    friction: 0.02,
    restitution: 0,
    description: "low friction, the player slides.",
    style: { fill: 0x88ddff },
  },
  chocolate: {
    friction: 1.5,
    restitution: 0,
    description: "slows movement.",
    style: { fill: 0x8b4513 },
  },
  trampoline: {
    friction: 0.5,
    restitution: 1.2,
    impulse: { x: 0, y: -700 },
    description: "bounces the player up.",
    style: { fill: 0xff00ff },
  },
} as const satisfies Record<string, MaterialDef>;

export type PlatformerMaterial = keyof typeof PLATFORMER_MATERIALS;

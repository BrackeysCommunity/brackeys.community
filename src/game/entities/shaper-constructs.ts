/**
 * Shaper constructs: the objects the Shaper places during play, which a
 * scene can also pre-place.
 *
 * Each construct type has:
 *   - A Rapier rigid body (fixed) unless it is visual-only or an anchor
 *   - A collider with appropriate shape, friction, restitution
 *   - A PixiJS Graphics placeholder visual
 *   - A collision group (SHAMAN_OBJ for physical, SENSOR for effect-only)
 *
 * The player reads bounce pads through collider tags and wind through
 * the runtime's force fields.
 */

import type { Collider, RigidBody } from "@dimforge/rapier2d";
import { Graphics } from "pixi.js";

import { SHAMAN_OBJ_COLLISION_GROUP, createSensorCollider } from "../collisions";
import { addToLayer, type EngineContext } from "../context";
import { degToRad } from "../physics";
import type { SceneConstructType } from "../scene/types";
import type { EntityOf, SceneSystem } from "../systems/scene-system";
import type { Vec2 } from "../types";
import type { AnchorSource, GrappleAnchorSystem } from "./grapple-anchor";

// ─── Construct type definitions ──────────────────────────

export type ConstructType = SceneConstructType;

export type ConstructConfig = {
  label: string;
  /** Hotkey number (1-6) for toolbar selection */
  hotkey: number;
  /** Max instances per round */
  maxPerRound: number;
  /** Whether this creates a physics body (vs sensor/visual-only) */
  isPhysical: boolean;
  /** Whether placement can be rotated */
  rotatable: boolean;
  /** Visual color (placeholder rendering) */
  color: number;
  /** Half-width of collider */
  hw: number;
  /** Half-height of collider */
  hh: number;
};

export const CONSTRUCT_CONFIGS: Record<ConstructType, ConstructConfig> = {
  bridge: {
    label: "Bridge",
    hotkey: 1,
    maxPerRound: 12,
    isPhysical: true,
    rotatable: true,
    color: 0xdeb887, // burlywood
    hw: 60,
    hh: 6,
  },
  bounce_pad: {
    label: "Bounce Pad",
    hotkey: 2,
    maxPerRound: 4,
    isPhysical: true,
    rotatable: false,
    color: 0xff1493, // deep pink
    hw: 40,
    hh: 5,
  },
  wind_zone: {
    label: "Wind Zone",
    hotkey: 3,
    maxPerRound: 4,
    isPhysical: false, // sensor — applies force, no collision
    rotatable: true,
    color: 0x87ceeb, // sky blue
    hw: 50,
    hh: 80,
  },
  grapple_anchor: {
    label: "Grapple Anchor",
    hotkey: 4,
    maxPerRound: 6,
    isPhysical: false, // an anchor, not a body
    rotatable: false,
    color: 0x00ffff, // cyan
    hw: 8,
    hh: 8,
  },
  light_orb: {
    label: "Light Orb",
    hotkey: 5,
    maxPerRound: 5,
    isPhysical: false, // visual only
    rotatable: false,
    color: 0xffd700, // gold
    hw: 12,
    hh: 12,
  },
  shield_barrier: {
    label: "Shield Barrier",
    hotkey: 6,
    maxPerRound: 3,
    isPhysical: true,
    rotatable: true,
    color: 0x9370db, // medium purple
    hw: 8,
    hh: 50,
  },
};

// ─── Construct system ────────────────────────────────────

const BOUNCE_PAD_VELOCITY = -650; // upward launch velocity
const WIND_FORCE_STRENGTH = 800; // game units/sec² applied to player

export type ShaperConstruct = {
  id: string;
  type: ConstructType;
  position: Vec2;
  /** Radians. */
  rotation: number;
  source: AnchorSource;
};

export type ConstructSystem = SceneSystem<EntityOf<"construct">> & {
  /** Place a construct during play; returns its generated id. */
  place: (type: ConstructType, position: Vec2, rotation: number) => string;
  get: (id: string) => ShaperConstruct | undefined;
  /** Remove constructs placed during play, keeping the scene's (round reset) */
  clearRuntime: () => void;
};

type Placed = {
  construct: ShaperConstruct;
  body: RigidBody | null;
  collider: Collider | null;
  gfx: Graphics | null;
};

function drawConstruct(gfx: Graphics, type: ConstructType): void {
  const config = CONSTRUCT_CONFIGS[type];
  if (type === "grapple_anchor" || type === "light_orb") {
    gfx.circle(0, 0, config.hw);
    gfx.fill({ color: config.color, alpha: type === "light_orb" ? 0.4 : 0.8 });
    gfx.stroke({ width: 2, color: config.color, alpha: 1.0 });
  } else if (type === "wind_zone") {
    gfx.rect(-config.hw, -config.hh, config.hw * 2, config.hh * 2);
    gfx.fill({ color: config.color, alpha: 0.15 });
    gfx.stroke({ width: 1, color: config.color, alpha: 0.5 });
    // Arrows point up in local space; the rotation turns them with the wind
    for (let i = -1; i <= 1; i++) {
      const ax = i * config.hw * 0.5;
      gfx.moveTo(ax, config.hh * 0.3);
      gfx.lineTo(ax, -config.hh * 0.3);
      gfx.lineTo(ax - 5, -config.hh * 0.15);
      gfx.moveTo(ax, -config.hh * 0.3);
      gfx.lineTo(ax + 5, -config.hh * 0.15);
      gfx.stroke({ width: 1, color: config.color, alpha: 0.6 });
    }
  } else {
    gfx.rect(-config.hw, -config.hh, config.hw * 2, config.hh * 2);
    gfx.fill({ color: config.color, alpha: 0.7 });
    gfx.stroke({ width: 1, color: config.color, alpha: 1.0 });
  }
}

export function createConstructSystem(
  ctx: EngineContext,
  anchors: GrappleAnchorSystem,
): ConstructSystem {
  const { rapier, physics, view, tags, fields } = ctx;
  const placed = new Map<string, Placed>();
  let nextRuntimeId = 0;

  function create(construct: ShaperConstruct): void {
    despawn(construct.id);
    const { id, type, position, source } = construct;
    const config = CONSTRUCT_CONFIGS[type];
    const rotation = config.rotatable ? construct.rotation : 0;

    if (type === "grapple_anchor") {
      anchors.add(id, position, source);
      placed.set(id, { construct, body: null, collider: null, gfx: null });
      return;
    }

    let gfx: Graphics | null = null;
    if (view) {
      gfx = new Graphics();
      drawConstruct(gfx, type);
      gfx.position.set(position.x, position.y);
      gfx.rotation = rotation;
      addToLayer(view.world, gfx, "construct");
    }

    let body: RigidBody | null = null;
    let collider: Collider | null = null;
    if (type !== "light_orb") {
      body = physics.addRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(position.x, position.y).setRotation(rotation),
      );
      const desc = rapier.ColliderDesc.cuboid(config.hw, config.hh);
      if (type === "wind_zone") {
        collider = createSensorCollider(rapier, physics.world, body, desc);
        fields.add(id, {
          center: position,
          hw: config.hw,
          hh: config.hh,
          rotation,
          force: {
            x: Math.sin(rotation) * WIND_FORCE_STRENGTH,
            y: -Math.cos(rotation) * WIND_FORCE_STRENGTH,
          },
        });
      } else {
        desc.setCollisionGroups(SHAMAN_OBJ_COLLISION_GROUP);
        if (type === "bridge") desc.setFriction(0.8);
        if (type === "bounce_pad") desc.setFriction(0.3).setRestitution(1.2);
        if (type === "shield_barrier") desc.setFriction(0.2);
        collider = physics.addCollider(desc, body);
      }
      tags.set(collider.handle, {
        entityId: id,
        behavior: "construct",
        impulse: type === "bounce_pad" ? { y: BOUNCE_PAD_VELOCITY } : undefined,
      });
    }

    placed.set(id, { construct, body, collider, gfx });
  }

  function despawn(id: string): void {
    const entry = placed.get(id);
    if (!entry) return;
    if (entry.construct.type === "grapple_anchor") anchors.despawn(id);
    if (entry.collider) tags.delete(entry.collider.handle);
    if (entry.body) physics.removeRigidBody(entry.body);
    if (entry.construct.type === "wind_zone") fields.remove(id);
    entry.gfx?.destroy();
    placed.delete(id);
  }

  return {
    behaviors: ["construct"],
    spawn(e) {
      create({
        id: e.id,
        type: e.type,
        position: { x: e.at[0], y: e.at[1] },
        rotation: degToRad(e.rot),
        source: "scene",
      });
    },
    despawn,
    clear() {
      for (const id of [...placed.keys()]) despawn(id);
    },
    size: () => placed.size,
    place(type, position, rotation) {
      const id = `~runtime:${nextRuntimeId++}`;
      create({ id, type, position: { ...position }, rotation, source: "runtime" });
      return id;
    },
    get: (id) => placed.get(id)?.construct,
    clearRuntime() {
      for (const { construct } of [...placed.values()]) {
        if (construct.source === "runtime") despawn(construct.id);
      }
    },
  };
}

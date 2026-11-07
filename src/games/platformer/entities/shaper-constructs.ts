/**
 * Shaper constructs: the objects the Shaper places during play, which a
 * scene can also pre-place.
 *
 * Each construct type has:
 *   - A Rapier rigid body (fixed) unless it is visual-only or an anchor
 *   - A collider with appropriate shape, friction, restitution
 *   - A placeholder visual drawn through the scene view
 *   - The `dynamic` collision group if physical, the `sensor` group if effect-only
 *
 * The player reads bounce pads through collider tags and wind through the
 * system's force fields.
 */

import type { Collider, RigidBody } from "@dimforge/rapier2d";
import type { Vec2 } from "@jams/engine";
import {
  createSensorCollider,
  degToRad,
  type EngineContext,
  type RegisteredType,
  type SceneSystem,
  type Style,
} from "@jams/engine/game";
import type { ShapeObj } from "@jams/engine/scene";

import { createForceFields, type ForceFields } from "../force-fields";
import { PLATFORMER_LAYERS } from "../layers";
import { TYPE } from "../type-names";
import type { ConstructEntity } from "../types";
import type { AnchorSource, GrappleAnchorSystem } from "./grapple-anchor";

// ─── Construct type definitions ──────────────────────────

export const CONSTRUCT_TYPES = [
  "bridge",
  "bounce_pad",
  "wind_zone",
  "grapple_anchor",
  "light_orb",
  "shield_barrier",
] as const;
export type ConstructType = (typeof CONSTRUCT_TYPES)[number];

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
  construct: ConstructType;
  position: Vec2;
  /** Radians. */
  rotation: number;
  source: AnchorSource;
};

export type ConstructSystem = SceneSystem<ConstructEntity> & {
  /** Wind from the wind zones this system placed. */
  readonly forces: Pick<ForceFields, "sample" | "size">;
  /** Place a construct during play; returns its generated id. */
  place: (type: ConstructType, position: Vec2, rotation: number) => string;
  get: (id: string) => ShaperConstruct | undefined;
  /** Remove constructs placed during play, keeping the scene's (round reset) */
  clearRuntime: () => void;
};

type Placed = {
  info: ShaperConstruct;
  body: RigidBody | null;
  collider: Collider | null;
  /** View ids of the construct's drawn pieces. */
  pieces: string[];
};

/** A construct's outline in its own frame: centred, unrotated. */
export function constructShape(type: ConstructType): ShapeObj {
  const { hw, hh } = CONSTRUCT_CONFIGS[type];
  return type === "grapple_anchor" || type === "light_orb"
    ? { type: "circle", cx: 0, cy: 0, r: hw }
    : { type: "box", cx: 0, cy: 0, hw, hh, rotDeg: 0 };
}

type Piece = { part: string; shape: ShapeObj; style: Style };

/** What a construct draws, in its own frame; `part` suffixes the construct's id. */
function constructPieces(type: ConstructType): Piece[] {
  const { color, hw, hh } = CONSTRUCT_CONFIGS[type];
  const body = (style: Omit<Style, "fill" | "stroke">): Piece => ({
    part: "",
    shape: constructShape(type),
    style: { fill: color, stroke: color, ...style },
  });
  if (type === "light_orb") return [body({ alpha: 0.4, strokeAlpha: 1, strokeWidth: 2 })];
  if (type !== "wind_zone") return [body({ alpha: 0.7, strokeAlpha: 1 })];

  // Arrows point up in the zone's frame; its rotation turns them with the wind.
  const pieces = [body({ alpha: 0.15, strokeAlpha: 0.5 })];
  const arrow = { stroke: color, alpha: 0.6 };
  const tip = -hh * 0.3;
  const barb = -hh * 0.15;
  for (let i = 0; i < 3; i++) {
    const ax = (i - 1) * hw * 0.5;
    const shaft: ShapeObj = {
      type: "chain",
      pts: [
        [ax, hh * 0.3],
        [ax, tip],
        [ax - 5, barb],
      ],
    };
    const right: ShapeObj = {
      type: "chain",
      pts: [
        [ax, tip],
        [ax + 5, barb],
      ],
    };
    pieces.push(
      { part: `#arrow${i}`, shape: shaft, style: arrow },
      { part: `#barb${i}`, shape: right, style: arrow },
    );
  }
  return pieces;
}

export function createConstructSystem(ctx: EngineContext, type: RegisteredType): ConstructSystem {
  const { rapier, physics, view, tags } = ctx;
  const fields = createForceFields();
  const placed = new Map<string, Placed>();
  let nextRuntimeId = 0;

  function anchors(): GrappleAnchorSystem {
    const system = ctx.system<GrappleAnchorSystem>(TYPE.anchor);
    if (!system) throw new Error(`${type.type} needs the "${TYPE.anchor}" type registered`);
    return system;
  }

  function create(construct: ShaperConstruct): void {
    despawn(construct.id);
    const { id, construct: kind, position, source } = construct;
    const config = CONSTRUCT_CONFIGS[kind];
    const rotation = config.rotatable ? construct.rotation : 0;

    if (kind === "grapple_anchor") {
      anchors().add(id, position, source);
      placed.set(id, { info: construct, body: null, collider: null, pieces: [] });
      return;
    }

    const pieces: string[] = [];
    if (view) {
      for (const { part, shape, style } of constructPieces(kind)) {
        const pieceId = `${id}${part}`;
        view.draw(pieceId, shape, style, PLATFORMER_LAYERS.construct);
        view.pose(pieceId, position.x, position.y, rotation);
        pieces.push(pieceId);
      }
    }

    let body: RigidBody | null = null;
    let collider: Collider | null = null;
    if (kind !== "light_orb") {
      body = physics.addRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(position.x, position.y).setRotation(rotation),
      );
      const desc = rapier.ColliderDesc.cuboid(config.hw, config.hh);
      if (kind === "wind_zone") {
        collider = createSensorCollider(ctx, body, desc);
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
        desc.setCollisionGroups(ctx.registry.collisionGroups("dynamic"));
        if (kind === "bridge") desc.setFriction(0.8);
        if (kind === "bounce_pad") desc.setFriction(0.3).setRestitution(1.2);
        if (kind === "shield_barrier") desc.setFriction(0.2);
        collider = physics.addCollider(desc, body);
      }
      tags.set(collider.handle, {
        entityId: id,
        type: type.type,
        ...(kind === "bounce_pad" && { impulse: { x: 0, y: BOUNCE_PAD_VELOCITY } }),
      });
    }

    placed.set(id, { info: construct, body, collider, pieces });
  }

  function despawn(id: string): void {
    const entry = placed.get(id);
    if (!entry) return;
    if (entry.info.construct === "grapple_anchor") anchors().despawn(id);
    if (entry.collider) tags.delete(entry.collider.handle);
    if (entry.body) physics.removeRigidBody(entry.body);
    if (entry.info.construct === "wind_zone") fields.remove(id);
    for (const pieceId of entry.pieces) view?.remove(pieceId);
    placed.delete(id);
  }

  return {
    forces: fields,
    spawn(e) {
      create({
        id: e.id,
        construct: e.construct,
        position: { x: e.at[0], y: e.at[1] },
        rotation: degToRad(e.rot ?? 0),
        source: "scene",
      });
    },
    despawn,
    clear() {
      for (const id of [...placed.keys()]) despawn(id);
    },
    size: () => placed.size,
    place(kind, position, rotation) {
      const id = `~runtime:${nextRuntimeId++}`;
      create({ id, construct: kind, position: { ...position }, rotation, source: "runtime" });
      return id;
    },
    get: (id) => placed.get(id)?.info,
    clearRuntime() {
      for (const { info } of [...placed.values()]) {
        if (info.source === "runtime") despawn(info.id);
      }
    },
  };
}

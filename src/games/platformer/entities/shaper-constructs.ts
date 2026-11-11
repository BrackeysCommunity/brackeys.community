/**
 * Shaper constructs: the objects the Shaper places during play, which a
 * scene can also pre-place. The Shaper's placements arrive as commands and
 * become `construct#<n>` entities through `ctx.spawn`, so a replay of the
 * commands places the same constructs.
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
  physicsOf,
  type EngineContext,
  type PlacementCheck,
  type RegisteredType,
  type SceneSystem,
  type Style,
} from "@jams/engine/game";
import type { Bounds, ShapeObj } from "@jams/engine/scene";

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
  /** Half-width of collider, metres */
  hw: number;
  /** Half-height of collider, metres */
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
    hw: 0.6,
    hh: 0.06,
  },
  bounce_pad: {
    label: "Bounce Pad",
    hotkey: 2,
    maxPerRound: 4,
    isPhysical: true,
    rotatable: false,
    color: 0xff1493, // deep pink
    hw: 0.4,
    hh: 0.05,
  },
  wind_zone: {
    label: "Wind Zone",
    hotkey: 3,
    maxPerRound: 4,
    isPhysical: false, // sensor — applies force, no collision
    rotatable: true,
    color: 0x87ceeb, // sky blue
    hw: 0.5,
    hh: 0.8,
  },
  grapple_anchor: {
    label: "Grapple Anchor",
    hotkey: 4,
    maxPerRound: 6,
    isPhysical: false, // an anchor, not a body
    rotatable: false,
    color: 0x00ffff, // cyan
    hw: 0.08,
    hh: 0.08,
  },
  light_orb: {
    label: "Light Orb",
    hotkey: 5,
    maxPerRound: 5,
    isPhysical: false, // visual only
    rotatable: false,
    color: 0xffd700, // gold
    hw: 0.12,
    hh: 0.12,
  },
  shield_barrier: {
    label: "Shield Barrier",
    hotkey: 6,
    maxPerRound: 3,
    isPhysical: true,
    rotatable: true,
    color: 0x9370db, // medium purple
    hw: 0.08,
    hh: 0.5,
  },
};

// ─── Placement rules ─────────────────────────────────────

export type PlacementValidation = PlacementCheck;

/** Ms between two Shaper placements. */
export const PLACEMENT_COOLDOWN_MS = 500;

export function validatePlacement(
  type: ConstructType,
  position: Vec2,
  placedCounts: Record<ConstructType, number>,
  lastPlacementTimeMs: number,
  currentTimeMs: number,
  bounds: Bounds,
): PlacementValidation {
  const config = CONSTRUCT_CONFIGS[type];

  if (currentTimeMs - lastPlacementTimeMs < PLACEMENT_COOLDOWN_MS) {
    const remaining =
      Math.ceil((PLACEMENT_COOLDOWN_MS - (currentTimeMs - lastPlacementTimeMs)) / 100) / 10;
    return { valid: false, reason: `Cooldown: ${remaining}s` };
  }

  if ((placedCounts[type] ?? 0) >= config.maxPerRound) {
    return { valid: false, reason: `Max ${config.label}s reached (${config.maxPerRound})` };
  }

  const [minX, minY, maxX, maxY] = bounds;
  if (position.x < minX || position.x > maxX || position.y < minY || position.y > maxY) {
    return { valid: false, reason: "Out of bounds" };
  }

  return { valid: true };
}

/** A count of 0 for every construct type. */
export function zeroCounts(): Record<ConstructType, number> {
  return Object.fromEntries(CONSTRUCT_TYPES.map((t) => [t, 0])) as Record<ConstructType, number>;
}

// ─── Construct system ────────────────────────────────────

const BOUNCE_PAD_VELOCITY = -6.5; // m/s, upward launch velocity
const WIND_FORCE_STRENGTH = 8; // m/s² applied to player

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
  /**
   * Places a construct outside the entity table, for tools and tests that
   * drive the system directly; returns its generated id. The Shaper goes
   * through `shape` instead.
   */
  place: (type: ConstructType, position: Vec2, rotation: number) => string;
  get: (id: string) => ShaperConstruct | undefined;
  /** Remove constructs `place` made, keeping the scene's. */
  clearRuntime: () => void;
  /** Whether the Shaper may place `type` at `at` this tick: the cooldown, the per-round limit, the scene's bounds. */
  checkShape: (type: ConstructType, at: Vec2) => PlacementValidation;
  /**
   * A `shaper-place`: spawns a `construct#<n>` entity through `ctx.spawn`
   * when `checkShape` allows it. `rotDeg` is whole degrees; a type that
   * doesn't rotate ignores it.
   */
  shape: (type: ConstructType, at: Vec2, rotDeg: number) => PlacementValidation & { id?: string };
  /** A `shaper-remove`: destroys a construct the Shaper placed; false for any other id. */
  unshape: (id: string) => boolean;
  /** The live constructs the Shaper placed, oldest first. */
  shaped: () => readonly string[];
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

/** How far a wind arrow's barbs reach either side of its shaft, metres. */
const BARB_HALF_WIDTH = 0.05;

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
        [ax - BARB_HALF_WIDTH, barb],
      ],
    };
    const right: ShapeObj = {
      type: "chain",
      pts: [
        [ax, tip],
        [ax + BARB_HALF_WIDTH, barb],
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
  const { view, tags } = ctx;
  const fields = createForceFields();
  const placed = new Map<string, Placed>();
  let nextRuntimeId = 0;
  /** Ids `shape` spawned this load, kept across a disable so a re-enable is still the Shaper's. */
  const shapedIds = new Set<string>();
  let shaping = false;
  let lastShapedMs = -Infinity;

  const nowMs = () => ctx.tick * ctx.time.tickMs;

  function shaped(): string[] {
    return [...shapedIds].filter((id) => ctx.exists(id));
  }

  function checkShape(kind: ConstructType, at: Vec2): PlacementValidation {
    const counts = zeroCounts();
    for (const id of shaped()) {
      const info = placed.get(id)?.info;
      if (info) counts[info.construct]++;
    }
    return validatePlacement(kind, at, counts, lastShapedMs, nowMs(), ctx.bounds);
  }

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
      const { rapier, physics } = physicsOf(ctx, type.type, id);
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
    if (entry.body) physicsOf(ctx, type.type, id).physics.removeRigidBody(entry.body);
    if (entry.info.construct === "wind_zone") fields.remove(id);
    for (const pieceId of entry.pieces) view?.remove(pieceId);
    placed.delete(id);
  }

  return {
    forces: fields,
    spawn(e) {
      if (shaping) shapedIds.add(e.id);
      create({
        id: e.id,
        construct: e.construct,
        position: { x: e.at[0], y: e.at[1] },
        rotation: degToRad(e.rot ?? 0),
        source: shapedIds.has(e.id) ? "runtime" : "scene",
      });
    },
    despawn,
    clear() {
      for (const id of [...placed.keys()]) despawn(id);
      shapedIds.clear();
      lastShapedMs = -Infinity;
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
        if (info.source === "runtime" && !shapedIds.has(info.id)) despawn(info.id);
      }
    },
    checkShape,
    shape(kind, at, rotDeg) {
      const check = checkShape(kind, at);
      if (!check.valid) return check;
      const rot = CONSTRUCT_CONFIGS[kind].rotatable ? rotDeg : 0;
      shaping = true;
      let id: string;
      try {
        id = ctx.spawn({
          type: type.type,
          construct: kind,
          at: [at.x, at.y],
          ...(rot !== 0 && { rot }),
        }).id;
      } finally {
        shaping = false;
      }
      lastShapedMs = nowMs();
      return { valid: true, id };
    },
    unshape(id) {
      if (!shapedIds.has(id) || !ctx.exists(id)) return false;
      shapedIds.delete(id);
      ctx.destroy(id);
      return true;
    },
    shaped,
  };
}

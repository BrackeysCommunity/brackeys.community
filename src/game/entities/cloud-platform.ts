import type { Collider, RigidBody } from "@dimforge/rapier2d";
import { Graphics } from "pixi.js";

import { CLOUD_COLLISION_GROUP } from "../collisions";
import { addToLayer, type EngineContext } from "../context";
import { posedBodyDesc, shapeColliderDesc } from "../physics";
import { SURFACE_MATERIALS } from "../surfaces";
import type { EntityOf, SceneSystem } from "../systems/scene-system";
import type { Vec2 } from "../types";

/**
 * Cloud platforms: one-way pass-through.
 *
 * Each cloud hides from the character controller by moving its fixed body
 * off-screen when pass-through and back to its real position when solid.
 * This bypasses broadphase cache issues that affect setCollisionGroups and
 * setSensor: position changes on fixed bodies take effect immediately for
 * shape-cast queries. The visual stays at the real position, dimmed while
 * pass-through.
 *
 * Rule per cloud:
 *   - Player's feet at or above cloud top → solid (real position)
 *   - Player below cloud or holding down  → pass-through (moved to y=-99999)
 *
 * The player entity has zero knowledge of cloud platforms.
 */

const CLOUD_COLOR_SOLID = 0xffffff;
const CLOUD_COLOR_PASSTHROUGH = 0x666688;
const CLOUD_ALPHA_SOLID = 0.5;
const CLOUD_ALPHA_PASSTHROUGH = 0.25;
const HIDDEN_Y = -99999;

export type CloudPlatformSystem = SceneSystem<EntityOf<"cloud">> & {
  /** Call each tick BEFORE player.update(). */
  updateForPlayer: (playerPos: Vec2, playerHalfHeight: number, holdingDown: boolean) => void;
  isHidden: (id: string) => boolean;
};

type CloudState = {
  body: RigidBody;
  collider: Collider;
  realPos: Vec2;
  halfExtents: Vec2;
  hidden: boolean;
  graphic: Graphics | null;
};

export function createCloudPlatformSystem(ctx: EngineContext): CloudPlatformSystem {
  const { rapier, physics, view } = ctx;
  const clouds = new Map<string, CloudState>();

  function drawCloud(cloud: CloudState): void {
    const g = cloud.graphic;
    if (!g) return;
    const color = cloud.hidden ? CLOUD_COLOR_PASSTHROUGH : CLOUD_COLOR_SOLID;
    const alpha = cloud.hidden ? CLOUD_ALPHA_PASSTHROUGH : CLOUD_ALPHA_SOLID;
    const { x: hw, y: hh } = cloud.halfExtents;
    g.clear();
    g.rect(-hw, -hh, hw * 2, hh * 2);
    g.fill({ color, alpha: alpha * 0.3 });
    g.stroke({ color, alpha, width: 1 });
  }

  function setHidden(cloud: CloudState, hidden: boolean): void {
    if (cloud.hidden === hidden) return;
    const y = hidden ? HIDDEN_Y : cloud.realPos.y;
    cloud.body.setTranslation(new rapier.Vector2(cloud.realPos.x, y), true);
    cloud.hidden = hidden;
    drawCloud(cloud);
  }

  function spawn(e: EntityOf<"cloud">): void {
    despawn(e.id);
    if (e.shape.type !== "box") throw new Error(`cloud ${e.id} must be a box`);
    const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), e.shape));
    const mat = SURFACE_MATERIALS.cloud;
    const collider = physics.addCollider(
      shapeColliderDesc(rapier, e.shape)
        .setCollisionGroups(CLOUD_COLLISION_GROUP)
        .setFriction(mat.friction)
        .setRestitution(mat.restitution),
      body,
    );
    ctx.tags.set(collider.handle, { entityId: e.id, behavior: "cloud" });

    let graphic: Graphics | null = null;
    if (view) {
      graphic = new Graphics();
      graphic.position.set(e.shape.cx, e.shape.cy);
      graphic.rotation = body.rotation();
      addToLayer(view.world, graphic, "cloud");
    }

    const cloud: CloudState = {
      body,
      collider,
      realPos: { x: e.shape.cx, y: e.shape.cy },
      halfExtents: { x: e.shape.hw, y: e.shape.hh },
      hidden: false,
      graphic,
    };
    drawCloud(cloud);
    clouds.set(e.id, cloud);
  }

  function despawn(id: string): void {
    const cloud = clouds.get(id);
    if (!cloud) return;
    ctx.tags.delete(cloud.collider.handle);
    physics.removeRigidBody(cloud.body);
    cloud.graphic?.destroy();
    clouds.delete(id);
  }

  function updateForPlayer(playerPos: Vec2, playerHalfHeight: number, holdingDown: boolean): void {
    const playerBottom = playerPos.y + playerHalfHeight;
    for (const cloud of clouds.values()) {
      const cloudTop = cloud.realPos.y - cloud.halfExtents.y;
      const playerAbove = playerBottom <= cloudTop + 4;
      setHidden(cloud, !(playerAbove && !holdingDown));
    }
  }

  return {
    behaviors: ["cloud"],
    spawn,
    despawn,
    clear() {
      for (const id of [...clouds.keys()]) despawn(id);
    },
    reset() {
      for (const cloud of clouds.values()) setHidden(cloud, false);
    },
    size: () => clouds.size,
    updateForPlayer,
    isHidden: (id) => clouds.get(id)?.hidden ?? false,
  };
}

import { Graphics, type Container } from "pixi.js";

import type { PhysicsWorld } from "../physics";
import { getRapier } from "../physics";
import { getCloudPlatformHandles } from "../surfaces";
import type { Vec2 } from "../types";

/**
 * Cloud platform entity — handles one-way pass-through logic.
 *
 * Each cloud independently manages its own visibility to the character
 * controller by moving its rigid body off-screen when pass-through and
 * back to its real position when solid. This bypasses broadphase cache
 * issues that affect setCollisionGroups/setSensor — position changes on
 * fixed bodies take effect immediately for shape-cast queries.
 *
 * Each cloud draws a persistent visual at its real position so it's
 * always visible regardless of the physics body's actual location.
 * Solid clouds are white, pass-through clouds are dimmed.
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

export type CloudPlatformSystem = {
  /** Call each frame BEFORE player.update(). */
  update: (playerPos: Vec2, playerHalfHeight: number, holdingDown: boolean) => void;
  destroy: () => void;
};

type CloudState = {
  handle: number;
  /** The real-world position of this cloud's body */
  realPos: Vec2;
  /** Half-extents of the collider */
  halfExtents: Vec2;
  /** Whether the cloud is currently hidden (off-screen) */
  hidden: boolean;
  /** Visual graphic drawn at real position */
  graphic: Graphics;
};

export function createCloudPlatformSystem(
  physics: PhysicsWorld,
  worldContainer: Container,
): CloudPlatformSystem {
  const RAPIER = getRapier();
  const clouds: CloudState[] = [];

  // Snapshot each cloud's real position and create visuals
  for (const handle of getCloudPlatformHandles()) {
    const collider = physics.world.getCollider(handle);
    if (!collider) continue;
    const body = collider.parent();
    if (!body) continue;
    const pos = body.translation();
    const he = collider.halfExtents();
    const hw = he ? he.x : 60;
    const hh = he ? he.y : 6;

    // Create a visual rectangle at the cloud's real position
    const graphic = new Graphics();
    drawCloud(graphic, hw, hh, CLOUD_COLOR_SOLID, CLOUD_ALPHA_SOLID);
    graphic.position.set(pos.x - hw, pos.y - hh);
    worldContainer.addChild(graphic);

    clouds.push({
      handle,
      realPos: { x: pos.x, y: pos.y },
      halfExtents: { x: hw, y: hh },
      hidden: false,
      graphic,
    });
  }

  function drawCloud(g: Graphics, hw: number, hh: number, color: number, alpha: number): void {
    g.clear();
    // Dashed outline to distinguish from solid geometry
    g.rect(0, 0, hw * 2, hh * 2);
    g.fill({ color, alpha: alpha * 0.3 });
    g.stroke({ color, alpha, width: 1 });
  }

  function update(playerPos: Vec2, playerHalfHeight: number, holdingDown: boolean): void {
    const playerBottom = playerPos.y + playerHalfHeight;

    for (const cloud of clouds) {
      const collider = physics.world.getCollider(cloud.handle);
      if (!collider) continue;
      const body = collider.parent();
      if (!body) continue;

      const cloudTop = cloud.realPos.y - cloud.halfExtents.y;

      // Solid when player's feet are at or above the cloud surface
      // and not holding down to drop through
      const playerAbove = playerBottom <= cloudTop + 4;
      const shouldBeVisible = playerAbove && !holdingDown;

      if (shouldBeVisible && cloud.hidden) {
        // Restore to real position
        body.setTranslation(new RAPIER.Vector2(cloud.realPos.x, cloud.realPos.y), true);
        cloud.hidden = false;
      } else if (!shouldBeVisible && !cloud.hidden) {
        // Move off-screen
        body.setTranslation(new RAPIER.Vector2(cloud.realPos.x, -99999), true);
        cloud.hidden = true;
      }

      // Update visual style based on state
      drawCloud(
        cloud.graphic,
        cloud.halfExtents.x,
        cloud.halfExtents.y,
        cloud.hidden ? CLOUD_COLOR_PASSTHROUGH : CLOUD_COLOR_SOLID,
        cloud.hidden ? CLOUD_ALPHA_PASSTHROUGH : CLOUD_ALPHA_SOLID,
      );
    }
  }

  function destroy(): void {
    for (const cloud of clouds) {
      // Restore physics body
      if (cloud.hidden) {
        const collider = physics.world.getCollider(cloud.handle);
        if (collider) {
          const body = collider.parent();
          if (body) {
            body.setTranslation(new RAPIER.Vector2(cloud.realPos.x, cloud.realPos.y), true);
          }
        }
      }
      // Remove visual
      worldContainer.removeChild(cloud.graphic);
      cloud.graphic.destroy();
    }
    clouds.length = 0;
  }

  return { update, destroy };
}

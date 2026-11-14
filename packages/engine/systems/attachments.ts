import type { Collider, RigidBody } from "@dimforge/rapier2d";

import type { ColliderTags } from "../game/types";
import type { PhysicsWorld } from "../physics";
import { composePose, relativePose, type Pose } from "../runtime/poses";
import type { Vec2 } from "../types";

/**
 * What a riding collider is made on: the host's body, its origin (where
 * the body was when it was offered: a follower's first path point) and
 * who it is.
 */
export type AttachmentHost = { body: RigidBody; origin: Vec2; id: string; type: string };

export type Attachment = {
  /** The collider while the host has a body; null while it waits for one. */
  collider(): Collider | null;
  /** The host while it has a body. */
  host(): AttachmentHost | null;
  /**
   * The riding entity is at world `pose`, and was at `offset` in the host
   * body's frame. Unless that is where the body carried it, moves the
   * collider on the body, now and for the steps to come, to `frame` (its
   * pose in the entity's frame) composed onto the new offset, and returns
   * that offset; null when the body carried it there or it has no collider.
   */
  follow(pose: Readonly<Pose>, offset: Readonly<Pose>, frame: Pose): Pose | null;
  /** Removes the collider (not the body) and stops waiting for the host. */
  detach(): void;
};

/** How near two offsets are, m and rad, for a riding entity's pose to count as where its host carried it. */
const CARRIED_EPSILON = 1e-9;

const carried = (a: Readonly<Pose>, b: Readonly<Pose>): boolean =>
  Math.abs(a.x - b.x) <= CARRIED_EPSILON &&
  Math.abs(a.y - b.y) <= CARRIED_EPSILON &&
  Math.abs(a.rot - b.rot) <= CARRIED_EPSILON;

/**
 * Colliders that ride another entity's body: a solid, sensor or `collider`
 * behavior with no body of its own, under a parent whose kinematic or dynamic
 * body carries it. A host offers its body while it has one; a request made
 * before that, or across a respawn, connects when the body appears. One per
 * runtime; `attach` throws `PhysicsRequiredError` without a physics world.
 */
export type AttachmentHub = {
  /** Offers `body` to ride on; `origin` defaults to where the body is now. */
  host(hostId: string, type: string, body: RigidBody, origin?: Vec2): void;
  /** Call before removing the host's body; the colliders go with it and wait for the next `host`. */
  unhost(hostId: string): void;
  /** The host `hostId` offered, while it has a body. */
  hosted(hostId: string): AttachmentHost | null;
  attach(entityId: string, hostId: string, make: (host: AttachmentHost) => Collider): Attachment;
  /** The ids attached to a host. */
  attachedTo(hostId: string): string[];
  clear(): void;
};

type Request = {
  entityId: string;
  hostId: string;
  make: (host: AttachmentHost) => Collider;
  collider: Collider | null;
};

/**
 * `physics` reads the runtime's world for the entity attaching or detaching,
 * and throws `PhysicsRequiredError` without one.
 */
export function createAttachmentHub(
  physics: (entityId: string) => PhysicsWorld,
  tags: ColliderTags,
): AttachmentHub {
  const hosts = new Map<string, AttachmentHost>();
  const requests = new Map<string, Request[]>();

  function connect(r: Request): void {
    const host = hosts.get(r.hostId);
    if (host) r.collider = r.make(host);
  }

  return {
    host(hostId, type, body, origin) {
      const at = origin ?? body.translation();
      hosts.set(hostId, { body, origin: { x: at.x, y: at.y }, id: hostId, type });
      for (const r of requests.get(hostId) ?? []) if (!r.collider) connect(r);
    },
    unhost(hostId) {
      hosts.delete(hostId);
      for (const r of requests.get(hostId) ?? []) {
        if (r.collider) tags.delete(r.collider.handle);
        r.collider = null;
      }
    },
    hosted: (hostId) => hosts.get(hostId) ?? null,
    attach(entityId, hostId, make) {
      physics(entityId);
      const r: Request = { entityId, hostId, make, collider: null };
      const list = requests.get(hostId) ?? [];
      list.push(r);
      requests.set(hostId, list);
      connect(r);
      return {
        collider: () => r.collider,
        host: () => hosts.get(r.hostId) ?? null,
        follow(pose, offset, frame) {
          const host = hosts.get(r.hostId);
          const c = r.collider;
          if (!host || !c) return null;
          const t = host.body.translation();
          const body = { x: t.x, y: t.y, rot: host.body.rotation() };
          const next = relativePose(pose, body);
          if (carried(next, offset)) return null;
          const at = composePose(next.x, next.y, next.rot, frame);
          c.setTranslationWrtParent({ x: at.x, y: at.y });
          c.setRotationWrtParent(at.rot);
          // queries before the next step must find it there too
          const world = composePose(body.x, body.y, body.rot, at);
          c.setTranslation({ x: world.x, y: world.y });
          c.setRotation(world.rot);
          physics(entityId).moved(c);
          return next;
        },
        detach() {
          if (r.collider) {
            tags.delete(r.collider.handle);
            physics(entityId).removeCollider(r.collider);
            r.collider = null;
          }
          const left = (requests.get(hostId) ?? []).filter((x) => x !== r);
          if (left.length > 0) requests.set(hostId, left);
          else requests.delete(hostId);
        },
      };
    },
    attachedTo: (hostId) => (requests.get(hostId) ?? []).map((r) => r.entityId),
    clear() {
      hosts.clear();
      requests.clear();
    },
  };
}

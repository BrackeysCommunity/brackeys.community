import type { Collider, RigidBody } from "@dimforge/rapier2d";

import type { ColliderTags } from "../game/types";
import type { PhysicsWorld } from "../physics";
import type { Pose } from "../runtime/poses";
import type { Vec2 } from "../types";

/**
 * What an attached collider is made on: the host's body, its origin (a
 * follower's first path point, where the offset is fixed in its frame) and
 * who it is.
 */
export type AttachmentHost = { body: RigidBody; origin: Vec2; id: string; type: string };

export type Attachment = {
  /** The collider while the host has a body; null while it waits for one. */
  collider(): Collider | null;
  /** The host while it has a body. */
  host(): AttachmentHost | null;
  /** Removes the collider (not the body) and stops waiting for the host. */
  detach(): void;
};

/**
 * Colliders that ride another entity's body (`attach` on solids and
 * sensors): a host offers its body when it spawns and withdraws it before
 * the body goes; requests made before the host spawned, or across its
 * respawns, attach when it (re)appears. One per runtime. `attach` throws
 * `PhysicsRequiredError` while the runtime has no physics world.
 */
export type AttachmentHub = {
  host(hostId: string, type: string, body: RigidBody, origin: Vec2): void;
  /** Call before removing the host's body; the colliders go with it and wait for the next `host`. */
  unhost(hostId: string): void;
  /**
   * Call after the host's body moved (`snap` when it jumped there): each
   * collider riding it has `moved` called, to re-pose its entity. `at` is
   * the body's translation and rotation when the caller has just read them,
   * passed on so riders don't read them again.
   */
  moved(hostId: string, snap?: boolean, at?: Readonly<Pose>): void;
  attach(
    entityId: string,
    hostId: string,
    make: (host: AttachmentHost) => Collider,
    moved?: (host: AttachmentHost, snap: boolean, at?: Readonly<Pose>) => void,
  ): Attachment;
  /** The ids attached to a host. */
  attachedTo(hostId: string): string[];
  clear(): void;
};

type Request = {
  entityId: string;
  hostId: string;
  make: (host: AttachmentHost) => Collider;
  moved?: (host: AttachmentHost, snap: boolean, at?: Readonly<Pose>) => void;
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
      hosts.set(hostId, { body, origin: { ...origin }, id: hostId, type });
      for (const r of requests.get(hostId) ?? []) if (!r.collider) connect(r);
    },
    unhost(hostId) {
      hosts.delete(hostId);
      for (const r of requests.get(hostId) ?? []) {
        if (r.collider) tags.delete(r.collider.handle);
        r.collider = null;
      }
    },
    moved(hostId, snap = false, at) {
      const host = hosts.get(hostId);
      if (!host) return;
      for (const r of requests.get(hostId) ?? []) if (r.collider) r.moved?.(host, snap, at);
    },
    attach(entityId, hostId, make, moved) {
      physics(entityId);
      const r: Request = { entityId, hostId, make, collider: null };
      if (moved) r.moved = moved;
      const list = requests.get(hostId) ?? [];
      list.push(r);
      requests.set(hostId, list);
      connect(r);
      return {
        collider: () => r.collider,
        host: () => hosts.get(r.hostId) ?? null,
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

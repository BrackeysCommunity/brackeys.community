import type { Collider, RigidBody } from "@dimforge/rapier2d";

import {
  GROUND_COLLISION_GROUP,
  SHAMAN_OBJ_COLLISION_GROUP,
  SENSOR_EVENTS,
  createSensorCollider,
} from "../collisions";
import type { EngineContext } from "../context";
import { posedBodyDesc, shapeColliderDesc } from "../physics";
import type { SensorKind } from "../scene/types";
import { SURFACE_MATERIALS } from "../surfaces";
import type { EntityOf, SceneSystem } from "./scene-system";

type Owned = { body: RigidBody; collider: Collider };

function createBodyTable(ctx: EngineContext) {
  const owned = new Map<string, Owned>();

  function despawn(id: string): void {
    const entry = owned.get(id);
    if (!entry) return;
    ctx.tags.delete(entry.collider.handle);
    ctx.physics.removeRigidBody(entry.body);
    owned.delete(id);
  }

  function clear(): void {
    for (const id of [...owned.keys()]) despawn(id);
  }

  return { owned, despawn, clear, size: () => owned.size };
}

// ─── Solid ───────────────────────────────────────────────

export function createSolidSystem(ctx: EngineContext): SceneSystem<EntityOf<"solid">> {
  const table = createBodyTable(ctx);
  const { rapier, physics } = ctx;

  return {
    behaviors: ["solid"],
    spawn(e) {
      table.despawn(e.id);
      const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), e.shape));
      const desc = shapeColliderDesc(rapier, e.shape).setCollisionGroups(GROUND_COLLISION_GROUP);
      if (e.material) {
        const mat = SURFACE_MATERIALS[e.material];
        desc.setFriction(mat.friction).setRestitution(mat.restitution);
      }
      const collider = physics.addCollider(desc, body);
      ctx.tags.set(collider.handle, { entityId: e.id, behavior: "solid", material: e.material });
      table.owned.set(e.id, { body, collider });
    },
    despawn: table.despawn,
    clear: table.clear,
    size: table.size,
  };
}

// ─── Prop ────────────────────────────────────────────────

export function createPropSystem(ctx: EngineContext): SceneSystem<EntityOf<"prop">> {
  const table = createBodyTable(ctx);
  const { rapier, physics } = ctx;

  return {
    behaviors: ["prop"],
    spawn(e) {
      table.despawn(e.id);
      const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.dynamic(), e.shape));
      const desc = shapeColliderDesc(rapier, e.shape)
        .setCollisionGroups(SHAMAN_OBJ_COLLISION_GROUP)
        .setRestitution(e.restitution)
        .setDensity(e.density);
      if (e.friction !== undefined) desc.setFriction(e.friction);
      const collider = physics.addCollider(desc, body);
      ctx.tags.set(collider.handle, { entityId: e.id, behavior: "prop" });
      table.owned.set(e.id, { body, collider });
    },
    despawn: table.despawn,
    clear: table.clear,
    size: table.size,
  };
}

// ─── Sensor ──────────────────────────────────────────────

export type SensorHit = { entityId: string; kind: SensorKind; type: string };

export type SensorSystem = SceneSystem<EntityOf<"sensor">> & {
  /** Sensors the collider started overlapping during the last physics step. */
  entered: (other: Collider) => SensorHit[];
};

export function createSensorSystem(ctx: EngineContext): SensorSystem {
  const table = createBodyTable(ctx);
  const kinds = new Map<string, SensorKind>();
  const overlapping = new Set<string>();
  const { rapier, physics } = ctx;

  function despawn(id: string): void {
    table.despawn(id);
    kinds.delete(id);
    overlapping.delete(id);
  }

  return {
    behaviors: ["sensor"],
    spawn(e) {
      despawn(e.id);
      const body = physics.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), e.shape));
      const collider = createSensorCollider(
        rapier,
        physics.world,
        body,
        shapeColliderDesc(rapier, e.shape),
      );
      ctx.tags.set(collider.handle, { entityId: e.id, behavior: "sensor", sensor: e.kind });
      table.owned.set(e.id, { body, collider });
      kinds.set(e.id, e.kind);
    },
    despawn,
    clear() {
      table.clear();
      kinds.clear();
      overlapping.clear();
    },
    size: table.size,
    entered(other) {
      const hits: SensorHit[] = [];
      for (const [id, { collider }] of table.owned) {
        const now = physics.world.intersectionPair(other, collider);
        const was = overlapping.has(id);
        if (now && !was) {
          overlapping.add(id);
          const kind = kinds.get(id)!;
          hits.push({ entityId: id, kind, type: SENSOR_EVENTS[kind] });
        } else if (!now && was) {
          overlapping.delete(id);
        }
      }
      return hits;
    },
  };
}

import { describe, expect, it, beforeEach } from "vite-plus/test";

import {
  GROUP_PLAYER,
  GROUP_GROUND,
  GROUP_SHAMAN_OBJ,
  GROUP_SENSOR,
  GROUP_CLOUD,
  PLAYER_COLLISION_GROUP,
  GROUND_COLLISION_GROUP,
  SHAMAN_OBJ_COLLISION_GROUP,
  SENSOR_COLLISION_GROUP,
  CLOUD_COLLISION_GROUP,
  CLOUD_PASSTHROUGH_GROUP,
  packGroups,
  registerSensor,
  unregisterSensor,
  getSensorType,
  clearSensors,
  registerPlayerCollider,
  unregisterPlayerCollider,
  isPlayerCollider,
} from "../collisions";

/** Simulate Rapier's interaction check: do two collision groups interact? */
function interacts(groupA: number, groupB: number): boolean {
  const memberA = (groupA >>> 16) & 0xffff;
  const filterA = groupA & 0xffff;
  const memberB = (groupB >>> 16) & 0xffff;
  const filterB = groupB & 0xffff;
  return (memberA & filterB) !== 0 && (memberB & filterA) !== 0;
}

// ─── Bitmask packing ─────────────────────────────────────

describe("packGroups", () => {
  it("packs membership into upper 16 bits and filter into lower 16 bits", () => {
    const packed = packGroups(0x0001, 0x0006);
    expect(packed).toBe(0x00010006);
  });

  it("produces correct values for GROUP_PLAYER", () => {
    const packed = packGroups(
      GROUP_PLAYER,
      GROUP_GROUND | GROUP_SHAMAN_OBJ | GROUP_SENSOR | GROUP_CLOUD,
    );
    expect(packed).toBe(PLAYER_COLLISION_GROUP);
  });
});

// ─── Interaction matrix ──────────────────────────────────

describe("collision group interactions", () => {
  it("player ↔ ground: YES", () => {
    expect(interacts(PLAYER_COLLISION_GROUP, GROUND_COLLISION_GROUP)).toBe(true);
  });

  it("player ↔ shaman object: YES", () => {
    expect(interacts(PLAYER_COLLISION_GROUP, SHAMAN_OBJ_COLLISION_GROUP)).toBe(true);
  });

  it("player ↔ player: NO", () => {
    expect(interacts(PLAYER_COLLISION_GROUP, PLAYER_COLLISION_GROUP)).toBe(false);
  });

  it("ground ↔ shaman object: YES", () => {
    expect(interacts(GROUND_COLLISION_GROUP, SHAMAN_OBJ_COLLISION_GROUP)).toBe(true);
  });

  it("shaman object ↔ shaman object: YES", () => {
    expect(interacts(SHAMAN_OBJ_COLLISION_GROUP, SHAMAN_OBJ_COLLISION_GROUP)).toBe(true);
  });

  it("sensor ↔ player: YES", () => {
    expect(interacts(SENSOR_COLLISION_GROUP, PLAYER_COLLISION_GROUP)).toBe(true);
  });

  it("sensor ↔ ground: NO", () => {
    expect(interacts(SENSOR_COLLISION_GROUP, GROUND_COLLISION_GROUP)).toBe(false);
  });

  it("sensor ↔ shaman object: NO", () => {
    expect(interacts(SENSOR_COLLISION_GROUP, SHAMAN_OBJ_COLLISION_GROUP)).toBe(false);
  });

  it("sensor ↔ sensor: NO", () => {
    expect(interacts(SENSOR_COLLISION_GROUP, SENSOR_COLLISION_GROUP)).toBe(false);
  });

  it("ground ↔ ground: NO (no self-collision for static bodies)", () => {
    expect(interacts(GROUND_COLLISION_GROUP, GROUND_COLLISION_GROUP)).toBe(false);
  });

  it("cloud (solid) ↔ player: YES", () => {
    expect(interacts(CLOUD_COLLISION_GROUP, PLAYER_COLLISION_GROUP)).toBe(true);
  });

  it("cloud (passthrough) ↔ player: NO", () => {
    expect(interacts(CLOUD_PASSTHROUGH_GROUP, PLAYER_COLLISION_GROUP)).toBe(false);
  });

  it("cloud (passthrough) ↔ shaman obj: NO", () => {
    // Shaman objects don't interact with cloud group (they use GROUND filter)
    expect(interacts(CLOUD_PASSTHROUGH_GROUP, SHAMAN_OBJ_COLLISION_GROUP)).toBe(false);
  });

  it("cloud (solid) ↔ shaman obj: NO", () => {
    // Even solid clouds are in GROUP_CLOUD, not GROUP_GROUND
    expect(interacts(CLOUD_COLLISION_GROUP, SHAMAN_OBJ_COLLISION_GROUP)).toBe(false);
  });
});

// ─── Sensor registry ─────────────────────────────────────

describe("sensor registry", () => {
  beforeEach(() => {
    clearSensors();
  });

  it("registers and retrieves a sensor type", () => {
    registerSensor(42, "cheese");
    expect(getSensorType(42)).toBe("cheese");
  });

  it("returns undefined for unregistered handles", () => {
    expect(getSensorType(999)).toBeUndefined();
  });

  it("unregisters a sensor", () => {
    registerSensor(42, "cheese");
    unregisterSensor(42);
    expect(getSensorType(42)).toBeUndefined();
  });

  it("clears all sensors", () => {
    registerSensor(1, "cheese");
    registerSensor(2, "hole");
    registerSensor(3, "lava");
    clearSensors();
    expect(getSensorType(1)).toBeUndefined();
    expect(getSensorType(2)).toBeUndefined();
    expect(getSensorType(3)).toBeUndefined();
  });
});

// ─── Player collider registry ────────────────────────────

describe("player collider registry", () => {
  it("registers and identifies a player collider", () => {
    registerPlayerCollider(10);
    expect(isPlayerCollider(10)).toBe(true);
    expect(isPlayerCollider(11)).toBe(false);
  });

  it("unregisters a player collider", () => {
    registerPlayerCollider(10);
    unregisterPlayerCollider(10);
    expect(isPlayerCollider(10)).toBe(false);
  });
});

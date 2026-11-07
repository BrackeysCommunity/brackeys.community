import { describe, expect, it } from "vite-plus/test";

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
  SENSOR_EVENTS,
  packGroups,
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

  it("cloud (solid) ↔ shaman obj: NO", () => {
    // Even solid clouds are in GROUP_CLOUD, not GROUP_GROUND
    expect(interacts(CLOUD_COLLISION_GROUP, SHAMAN_OBJ_COLLISION_GROUP)).toBe(false);
  });
});

// ─── Sensor events ───────────────────────────────────────

describe("SENSOR_EVENTS", () => {
  it("keeps the historical event names for each sensor kind", () => {
    expect(SENSOR_EVENTS).toEqual({ goal: "cheese", exit: "hole", hazard: "lava" });
  });
});

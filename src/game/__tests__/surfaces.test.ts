import { describe, expect, it } from "vite-plus/test";

import { SURFACE_MATERIALS, surfaceMaterialOf, surfaceTypeOf, type SurfaceType } from "../surfaces";

// ─── Surface materials config ────────────────────────────

describe("SURFACE_MATERIALS", () => {
  it("defines all 6 surface types", () => {
    const types: SurfaceType[] = ["normal", "ice", "trampoline", "lava", "chocolate", "cloud"];
    for (const t of types) {
      expect(SURFACE_MATERIALS[t]).toBeDefined();
    }
  });

  it("normal has standard friction and no special effects", () => {
    const m = SURFACE_MATERIALS.normal;
    expect(m.friction).toBeCloseTo(0.7);
    expect(m.restitution).toBe(0);
    expect(m.decelMultiplier).toBe(1);
    expect(m.speedMultiplier).toBe(1);
    expect(m.bounceVelocity).toBe(0);
    expect(m.lethal).toBe(false);
    expect(m.oneWay).toBe(false);
  });

  it("ice has near-zero friction and very low decel", () => {
    const m = SURFACE_MATERIALS.ice;
    expect(m.friction).toBeLessThan(0.1);
    expect(m.decelMultiplier).toBeLessThan(0.1);
  });

  it("trampoline has bounce velocity", () => {
    const m = SURFACE_MATERIALS.trampoline;
    expect(m.bounceVelocity).toBeLessThan(0); // upward = negative
    expect(m.restitution).toBeGreaterThan(1);
  });

  it("lava is lethal", () => {
    expect(SURFACE_MATERIALS.lava.lethal).toBe(true);
  });

  it("chocolate slows movement", () => {
    const m = SURFACE_MATERIALS.chocolate;
    expect(m.speedMultiplier).toBeLessThan(1);
    expect(m.decelMultiplier).toBeGreaterThan(1);
  });

  it("cloud is one-way", () => {
    expect(SURFACE_MATERIALS.cloud.oneWay).toBe(true);
  });
});

// ─── Lookup by collider tag ──────────────────────────────

describe("surfaceTypeOf", () => {
  it("is normal for an untagged collider", () => {
    expect(surfaceTypeOf(undefined)).toBe("normal");
  });

  it("is normal for a solid without a material", () => {
    expect(surfaceTypeOf({ entityId: "~solid:0", behavior: "solid" })).toBe("normal");
  });

  it("uses the tag's material", () => {
    expect(surfaceTypeOf({ entityId: "~solid:ice:0", behavior: "solid", material: "ice" })).toBe(
      "ice",
    );
    expect(surfaceTypeOf({ entityId: "lift", behavior: "mover", material: "chocolate" })).toBe(
      "chocolate",
    );
  });

  it("is cloud for cloud colliders", () => {
    expect(surfaceTypeOf({ entityId: "~cloud:0", behavior: "cloud" })).toBe("cloud");
  });

  it("is lava for hazard sensors", () => {
    expect(surfaceTypeOf({ entityId: "lava", behavior: "sensor", sensor: "hazard" })).toBe("lava");
  });
});

describe("surfaceMaterialOf", () => {
  it("returns the material record for the tag", () => {
    const tag = { entityId: "t", behavior: "solid" as const, material: "trampoline" as const };
    expect(surfaceMaterialOf(tag)).toBe(SURFACE_MATERIALS.trampoline);
    expect(surfaceMaterialOf(undefined)).toBe(SURFACE_MATERIALS.normal);
  });
});

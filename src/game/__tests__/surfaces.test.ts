import { describe, expect, it, beforeEach } from "vite-plus/test";
import {
  SURFACE_MATERIALS,
  registerSurface,
  unregisterSurface,
  getSurfaceType,
  getSurfaceMaterial,
  clearSurfaces,
  registerCloudPlatform,
  unregisterCloudPlatform,
  isCloudPlatform,
  clearCloudPlatforms,
  type SurfaceType,
} from "../surfaces";

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

// ─── Surface registry ────────────────────────────────────

describe("surface registry", () => {
  beforeEach(() => {
    clearSurfaces();
  });

  it("returns 'normal' for unregistered handles", () => {
    expect(getSurfaceType(999)).toBe("normal");
  });

  it("registers and retrieves a surface type", () => {
    registerSurface(42, "ice");
    expect(getSurfaceType(42)).toBe("ice");
  });

  it("getSurfaceMaterial returns correct material", () => {
    registerSurface(42, "trampoline");
    const mat = getSurfaceMaterial(42);
    expect(mat).toBe(SURFACE_MATERIALS.trampoline);
  });

  it("unregisters a surface", () => {
    registerSurface(42, "ice");
    unregisterSurface(42);
    expect(getSurfaceType(42)).toBe("normal");
  });

  it("clears all surfaces", () => {
    registerSurface(1, "ice");
    registerSurface(2, "lava");
    clearSurfaces();
    expect(getSurfaceType(1)).toBe("normal");
    expect(getSurfaceType(2)).toBe("normal");
  });
});

// ─── Cloud platform registry ─────────────────────────────

describe("cloud platform registry", () => {
  beforeEach(() => {
    clearCloudPlatforms();
  });

  it("registers and identifies cloud platforms", () => {
    registerCloudPlatform(10);
    expect(isCloudPlatform(10)).toBe(true);
    expect(isCloudPlatform(11)).toBe(false);
  });

  it("unregisters cloud platforms", () => {
    registerCloudPlatform(10);
    unregisterCloudPlatform(10);
    expect(isCloudPlatform(10)).toBe(false);
  });

  it("clears all cloud platforms", () => {
    registerCloudPlatform(1);
    registerCloudPlatform(2);
    clearCloudPlatforms();
    expect(isCloudPlatform(1)).toBe(false);
    expect(isCloudPlatform(2)).toBe(false);
  });
});

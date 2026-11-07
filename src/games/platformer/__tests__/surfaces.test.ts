import { describe, expect, it } from "vite-plus/test";

import { PLATFORMER_MATERIALS } from "../materials";
import { SURFACES, surfaceNamed, surfaceOf } from "../surfaces";

describe("SURFACES", () => {
  it("has normal plus one surface per material", () => {
    expect(Object.keys(SURFACES).sort()).toEqual(
      ["normal", ...Object.keys(PLATFORMER_MATERIALS)].sort(),
    );
  });

  it("normal has no special effects", () => {
    expect(SURFACES.normal).toMatchObject({
      decelMultiplier: 1,
      speedMultiplier: 1,
      bounceVelocity: 0,
    });
  });

  it("ice has very low decel", () => {
    expect(SURFACES.ice.decelMultiplier).toBeLessThan(0.1);
    expect(PLATFORMER_MATERIALS.ice.friction).toBeLessThan(0.1);
  });

  it("trampoline bounces with its material's impulse", () => {
    expect(SURFACES.trampoline.bounceVelocity).toBe(PLATFORMER_MATERIALS.trampoline.impulse.y);
    expect(SURFACES.trampoline.bounceVelocity).toBeLessThan(0);
  });

  it("chocolate slows movement", () => {
    expect(SURFACES.chocolate.speedMultiplier).toBeLessThan(1);
    expect(SURFACES.chocolate.decelMultiplier).toBeGreaterThan(1);
  });
});

describe("surfaceOf", () => {
  it("is normal for an untagged collider or one without a material", () => {
    expect(surfaceOf(undefined)).toBe(SURFACES.normal);
    expect(surfaceOf({ entityId: "~solid:0", type: "solid" })).toBe(SURFACES.normal);
    expect(surfaceOf({ entityId: "~cloud:0", type: "cloud", oneWay: true })).toBe(SURFACES.normal);
  });

  it("uses the tag's material, whatever the type", () => {
    expect(surfaceOf({ entityId: "~solid:ice:0", type: "solid", material: "ice" })).toBe(
      SURFACES.ice,
    );
    expect(surfaceOf({ entityId: "lift", type: "mover", material: "chocolate" })).toBe(
      SURFACES.chocolate,
    );
  });

  it("is normal for a material it has no modifiers for", () => {
    expect(surfaceNamed("glass")).toBe(SURFACES.normal);
  });
});

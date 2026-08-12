import { describe, expect, it } from "vite-plus/test";

import { placementTypeFromClassification, platformsFromTraits } from "../project-taxonomy";

describe("platformsFromTraits()", () => {
  it("maps p_-prefixed platform traits to platform names, in display order", () => {
    expect(platformsFromTraits(["p_linux", "p_windows", "p_osx", "p_android"])).toEqual([
      "windows",
      "osx",
      "linux",
      "android",
    ]);
  });

  it("ignores non-platform traits", () => {
    expect(platformsFromTraits(["p_windows", "can_be_bought", "in_press_system"])).toEqual([
      "windows",
    ]);
  });

  it("distinguishes 'no traits sent' from 'no platforms'", () => {
    expect(platformsFromTraits(null)).toBeNull();
    expect(platformsFromTraits(undefined)).toBeNull();
    expect(platformsFromTraits([])).toEqual([]);
    expect(platformsFromTraits(["can_be_bought"])).toEqual([]);
  });
});

describe("placementTypeFromClassification()", () => {
  it("derives the placement enum for the kinds it can express", () => {
    expect(placementTypeFromClassification("tool")).toBe("tool");
    expect(placementTypeFromClassification("soundtrack")).toBe("audio");
  });

  it("defaults everything else to game", () => {
    expect(placementTypeFromClassification("game")).toBe("game");
    expect(placementTypeFromClassification("assets")).toBe("game");
    expect(placementTypeFromClassification(null)).toBe("game");
    expect(placementTypeFromClassification(undefined)).toBe("game");
  });
});

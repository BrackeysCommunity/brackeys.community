import { describe, expect, it } from "vite-plus/test";

import { pathWords } from "../field-widgets";

describe("a field's path in words", () => {
  it("reads a behavior field by its behavior's name, then the field's", () => {
    expect(pathWords("behaviors.text.size")).toBe("Text size");
    expect(pathWords("behaviors.text.outline.width")).toBe("Text outline width");
    expect(pathWords("behaviors.camera-target.seat")).toBe("Camera target seat");
  });

  it("counts list items from 1 and drops a keyed item's marker", () => {
    expect(pathWords("behaviors.tween.tweens.1.to.alpha")).toBe("Tween tweens 2 to alpha");
    expect(pathWords("variants.@clink.weight")).toBe("Variants clink weight");
  });

  it("splits camelCase and keeps acronyms upper-case", () => {
    expect(pathWords("maxVoices")).toBe("Max voices");
    expect(pathWords("hud.uiScale")).toBe("HUD UI scale");
  });
});

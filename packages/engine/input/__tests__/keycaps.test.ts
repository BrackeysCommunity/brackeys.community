// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { bindingKeyLabel, keycapLabel, pointerButtonLabel } from "../keycaps";

describe("keycaps", () => {
  it("reads key codes as keycaps", () => {
    expect(
      [
        "KeyQ",
        "Digit3",
        "Numpad4",
        "NumpadEnter",
        "ShiftLeft",
        "ControlRight",
        "AltLeft",
        "MetaRight",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Escape",
        "Backquote",
        "Minus",
        "Equal",
        "BracketLeft",
        "BracketRight",
        "Backslash",
        "Semicolon",
        "Quote",
        "Comma",
        "Period",
        "Slash",
        "Space",
        "Enter",
        "Tab",
        "F5",
      ].map(keycapLabel),
    ).toEqual([
      "Q",
      "3",
      "Num 4",
      "Num Enter",
      "Shift",
      "Ctrl",
      "Alt",
      "Meta",
      "←",
      "→",
      "↑",
      "↓",
      "Esc",
      "`",
      "-",
      "=",
      "[",
      "]",
      "\\",
      ";",
      "'",
      ",",
      ".",
      "/",
      "Space",
      "Enter",
      "Tab",
      "F5",
    ]);
  });

  it("names the three pointer buttons and nothing else", () => {
    expect(["primary", "secondary", "middle", "back"].map(pointerButtonLabel)).toEqual([
      "Click",
      "Right-click",
      "Middle-click",
      null,
    ]);
  });

  it("labels key and pointer bindings and gives pads and touch none", () => {
    expect(bindingKeyLabel({ device: "key", code: "KeyW", axis: "y", value: -1 })).toBe("W");
    expect(bindingKeyLabel({ device: "pointer", button: "primary" })).toBe("Click");
    expect(bindingKeyLabel({ device: "pad", button: "south" })).toBeNull();
    expect(bindingKeyLabel({ device: "touch", control: "menu" })).toBeNull();
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  COLOR_SPACE_IDS,
  COLOR_SPACES,
  hexToRgb,
  isOutOfGamut,
  parseColor,
  rgbToHex,
} from "../color-spaces";

const hexOf = (input: string, prefer?: Parameters<typeof parseColor>[1]) => {
  const rgb = parseColor(input, prefer);
  return rgb ? rgbToHex(rgb) : null;
};

describe("every space round-trips a colour", () => {
  const samples = ["#7f5af0", "#000000", "#ffffff", "#4f9dd9", "#ff0000", "#808080", "#0a3b12"];

  it.each(COLOR_SPACE_IDS)("%s", (id) => {
    const space = COLOR_SPACES[id];
    for (const hex of samples) {
      expect(rgbToHex(space.toRgb(space.fromRgb(hexToRgb(hex))))).toBe(hex);
    }
  });

  it.each(COLOR_SPACE_IDS)("%s reads its own notation back", (id) => {
    const space = COLOR_SPACES[id];
    for (const hex of samples) {
      const text = space.stringify(space.fromRgb(hexToRgb(hex)));
      const back = hexOf(text, id);
      // Integer-rounded notations (HSL, CMYK…) can land one step off.
      const drift = [1, 3, 5].map((i) =>
        Math.abs(parseInt(back!.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)),
      );
      expect(Math.max(...drift), `${text} → ${back}`).toBeLessThanOrEqual(3);
    }
  });
});

describe("known values", () => {
  it("writes each notation the way people paste it", () => {
    const rgb = hexToRgb("#7f5af0");
    const text = (id: (typeof COLOR_SPACE_IDS)[number]) =>
      COLOR_SPACES[id].stringify(COLOR_SPACES[id].fromRgb(rgb));

    expect(text("hex")).toBe("#7f5af0");
    expect(text("rgb")).toBe("rgb(127, 90, 240)");
    expect(text("hsl")).toBe("hsl(255, 83%, 65%)");
    expect(text("hsb")).toBe("hsb(255, 62%, 94%)");
    expect(text("cmyk")).toBe("cmyk(47%, 62%, 0%, 6%)");
    expect(text("vec3")).toBe("0.498, 0.353, 0.941");
    expect(text("dec")).toBe(String(0x7f5af0));
  });

  it("puts sRGB red where CSS Color 4 does in OKLCH", () => {
    const [l, c, h] = COLOR_SPACES.oklch.fromRgb(hexToRgb("#ff0000"));
    expect(l).toBeCloseTo(62.8, 1);
    expect(c).toBeCloseTo(0.2577, 3);
    expect(h).toBeCloseTo(29.23, 1);
  });

  it("flags an OKLCH colour no screen can show", () => {
    expect(isOutOfGamut(COLOR_SPACES.oklch.toRgb([70, 0.4, 150]))).toBe(true);
    expect(isOutOfGamut(COLOR_SPACES.oklch.toRgb([70, 0.05, 150]))).toBe(false);
  });
});

describe("parseColor", () => {
  it.each([
    ["#7f5af0", "#7f5af0"],
    ["#7F5AF0", "#7f5af0"],
    ["7f5af0", "#7f5af0"],
    ["0x7f5af0", "#7f5af0"],
    ["#fff", "#ffffff"],
    ["#7f5af0cc", "#7f5af0"],
    ["rgb(127, 90, 240)", "#7f5af0"],
    ["rgba(127 90 240 / 50%)", "#7f5af0"],
    ["rgb(100%, 0%, 0%)", "#ff0000"],
    ["hsl(255, 83%, 65%)", "#815cf0"],
    ["hsl(255deg 83% 65%)", "#815cf0"],
    ["hsv(255, 62%, 94%)", "#805bf0"],
    ["hsb(0, 100, 100)", "#ff0000"],
    ["oklch(62.8% 0.2577 29.23)", "#ff0000"],
    ["oklch(0.628 0.2577 29.23)", "#ff0000"],
    ["cmyk(0%, 100%, 100%, 0%)", "#ff0000"],
    ["8346352", "#7f5af0"],
    ["127, 90, 240", "#7f5af0"],
    ["0.498, 0.353, 0.941", "#7f5af0"],
    ["new Color(0.498f, 0.353f, 0.941f)", "#7f5af0"],
    ["Color(0.498, 0.353, 0.941, 1)", "#7f5af0"],
    ["vec3(0.498, 0.353, 0.941)", "#7f5af0"],
    ["(1, 0, 0)", "#ff0000"],
    // Reference values from culori and the CSS Color 5 naive-CMYK example.
    ["oklch(0.45 0.12 250)", "#0e5794"],
    ["oklch(80% 50% 120)", "#aecf00"],
    ["hsl(33, 90%, 20%)", "#613805"],
    ["hsv(210, 40%, 55%)", "#54708c"],
    ["cmyk(0%, 81%, 81%, 30%)", "#b32222"],
  ])("%s", (input, expected) => {
    expect(hexOf(input)).toBe(expected);
  });

  it("reads six bare digits as hex, unless the member is working in decimal", () => {
    expect(hexOf("123456")).toBe("#123456");
    expect(hexOf("123456", "dec")).toBe(
      rgbToHex(hexToRgb(`#${(123456).toString(16).padStart(6, "0")}`)),
    );
  });

  it.each(["", "nope", "#12", "rgb(1, 2)", "cmyk(1, 2, 3)", "99999999", "hsl(a, b, c)"])(
    "rejects %j",
    (input) => {
      expect(parseColor(input)).toBeNull();
    },
  );
});

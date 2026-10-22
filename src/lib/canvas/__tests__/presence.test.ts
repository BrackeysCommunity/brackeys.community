import { describe, expect, it } from "vite-plus/test";

import { namesHere, parsePeerState, PRESENCE_COLORS, presenceColor } from "../presence";

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The base themes' backgrounds: `oklch(1 0 0)` and `oklch(0.141 0.005 285.823)`. */
const LIGHT_BACKGROUND = "#ffffff";
const DARK_BACKGROUND = "#09090b";

describe("presence colors", () => {
  it("has eight distinct colors", () => {
    expect(new Set(PRESENCE_COLORS.map((c) => c.color)).size).toBe(8);
  });

  it.each(PRESENCE_COLORS.map((c) => c.color))(
    "%s carries white name tags and stands out on both themes",
    (color) => {
      expect(contrast(color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color, LIGHT_BACKGROUND)).toBeGreaterThanOrEqual(3);
      expect(contrast(color, DARK_BACKGROUND)).toBeGreaterThanOrEqual(3);
    },
  );

  it("gives each color a translucent light variant for text selections", () => {
    for (const { color, colorLight } of PRESENCE_COLORS) expect(colorLight).toBe(`${color}33`);
  });

  it("picks the same color for the same person, and spreads people across the palette", () => {
    expect(presenceColor("user-a")).toBe(presenceColor("user-a"));
    const used = new Set(Array.from({ length: 200 }, (_, i) => presenceColor(`user-${i}`).color));
    expect(used.size).toBe(8);
  });
});

describe("parsePeerState", () => {
  const valid = {
    user: { id: "u1", name: "Ana", avatarUrl: "https://cdn.discordapp.com/a.png" },
    pointer: { x: 10, y: -4 },
    selection: ["a", "b"],
    editing: "a",
  };

  it("reads a peer's state and derives its color from the id", () => {
    expect(parsePeerState({ ...valid, user: { ...valid.user, color: "red" } })).toEqual({
      user: { ...valid.user, ...presenceColor("u1") },
      pointer: { x: 10, y: -4 },
      selection: ["a", "b"],
      editing: "a",
    });
  });

  it("ignores clients without a user", () => {
    expect(parsePeerState(null)).toBeNull();
    expect(parsePeerState({ cursor: {} })).toBeNull();
    expect(parsePeerState({ user: { name: "No id" } })).toBeNull();
  });

  it("drops what it can't trust", () => {
    const parsed = parsePeerState({
      user: { id: "u1", name: "  ", avatarUrl: "javascript:alert(1)" },
      pointer: { x: Number.NaN, y: 1 },
      selection: ["ok", 5, "", "x".repeat(500)],
      editing: 3,
    })!;
    expect(parsed.user.name).toBe("Member");
    expect(parsed.user.avatarUrl).toBeNull();
    expect(parsed.pointer).toBeNull();
    expect(parsed.selection).toEqual(["ok"]);
    expect(parsed.editing).toBeNull();
    expect(parsePeerState({ user: { id: "u1", name: "x".repeat(500) } })!.user.name).toHaveLength(
      80,
    );
  });
});

describe("namesHere", () => {
  it("reads naturally for one to many people", () => {
    expect(namesHere(["Mara"])).toBe("Mara");
    expect(namesHere(["Mara", "Rin"])).toBe("Mara and Rin");
    expect(namesHere(["Mara", "Rin", "Ana"])).toBe("Mara, Rin and Ana");
    expect(namesHere(["Mara", "Rin", "Ana", "Jo"])).toBe("Mara, Rin and 2 others");
  });
});

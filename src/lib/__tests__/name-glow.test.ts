import { describe, expect, it } from "vite-plus/test";

import {
  canUseNameGlow,
  clampGlowColor,
  DEFAULT_NAME_GLOW_MOTION,
  NAME_GLOW_MOTIONS,
  normalizeGlowMotion,
  MAX_GLOW_STOPS,
  nameGlowProps,
  normalizeGlowColors,
  GLOW_MAX_LIGHTNESS,
  GLOW_MIN_LIGHTNESS,
  normalizeGlowColor,
  resolveNameGlow,
} from "@/lib/name-glow";

function lightnessOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const h =
    (max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) *
    60;
  return h < 0 ? h + 360 : h;
}

describe("accepting a picked color", () => {
  it("takes a six-digit hex and lowercases it", () => {
    expect(normalizeGlowColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeGlowColor("  #aabbcc  ")).toBe("#aabbcc");
  });

  // safeThemeColor tolerates these for scraped jam colors; a value heading
  // for an inline style off a free-text picker gets the strict reading.
  it("rejects the shorthand, alpha and functional forms", () => {
    for (const bad of ["#abc", "#aabbccdd", "rgb(1,2,3)", "red", "aabbcc", "", null, undefined]) {
      expect(normalizeGlowColor(bad)).toBeNull();
    }
  });
});

describe("keeping a glow legible on every theme", () => {
  it("leaves a color that already sits in the band exactly as picked", () => {
    // #4f9dd9 — a mid blue, comfortably inside the range.
    expect(clampGlowColor("#4f9dd9")).toBe("#4f9dd9");
  });

  it("lifts near-black picks to the floor", () => {
    const clamped = clampGlowColor("#000000");
    expect(clamped).not.toBeNull();
    expect(lightnessOf(clamped!)).toBeCloseTo(GLOW_MIN_LIGHTNESS, 2);
  });

  it("drops near-white picks to the ceiling", () => {
    const clamped = clampGlowColor("#ffffff");
    expect(clamped).not.toBeNull();
    expect(lightnessOf(clamped!)).toBeCloseTo(GLOW_MAX_LIGHTNESS, 2);
  });

  it("keeps the hue the member actually chose", () => {
    // A very dark red still has to come back red, not a neutral grey.
    const clamped = clampGlowColor("#1a0000");
    expect(clamped).not.toBeNull();
    expect(hueOf(clamped!)).toBeCloseTo(0, 0);
    expect(lightnessOf(clamped!)).toBeCloseTo(GLOW_MIN_LIGHTNESS, 2);
  });

  it("holds every clamped result inside the band", () => {
    for (const hex of ["#000000", "#ffffff", "#010203", "#fefefe", "#7f00ff", "#00ff00"]) {
      const clamped = clampGlowColor(hex)!;
      const l = lightnessOf(clamped);
      expect(l).toBeGreaterThanOrEqual(GLOW_MIN_LIGHTNESS - 0.01);
      expect(l).toBeLessThanOrEqual(GLOW_MAX_LIGHTNESS + 0.01);
    }
  });
});

describe("who actually gets a glow", () => {
  it("gives a boosting member their clamped color", () => {
    expect(resolveNameGlow({ nameGlowColors: ["#000000"], isBooster: true })).not.toBeNull();
  });

  it("withholds it from someone with neither a boost nor a rank", () => {
    expect(resolveNameGlow({ nameGlowColors: ["#4f9dd9"], isBooster: false })).toBeNull();
    expect(
      resolveNameGlow({ nameGlowColors: ["#4f9dd9"], isBooster: false, guildRoles: [] }),
    ).toBeNull();
  });

  it("returns null when an entitled member hasn't picked one", () => {
    expect(resolveNameGlow({ nameGlowColors: null, isBooster: true })).toBeNull();
  });
});

describe("staff entitlement", () => {
  // Staff earn the glow through rank, so they never have to boost for it.
  it.each(["Dev", "Admin", "Moderator", "Staff"])("lets %s wear one unboosted", (role) => {
    expect(canUseNameGlow({ isBooster: false, guildRoles: [role] })).toBe(true);
    expect(
      resolveNameGlow({ nameGlowColors: ["#4f9dd9"], isBooster: false, guildRoles: [role] }),
    ).not.toBeNull();
  });

  // Guru and BIP are community ranks, not staff — the chip tells them apart
  // and so does this.
  it.each(["Guru", "BIP"])("does not extend it to the %s community rank", (role) => {
    expect(canUseNameGlow({ isBooster: false, guildRoles: [role] })).toBe(false);
  });

  it("still lets a booster with no rank wear one", () => {
    expect(canUseNameGlow({ isBooster: true, guildRoles: null })).toBe(true);
  });

  // Stepping down doesn't wipe the stored colours, so the check has to be at
  // render or a former moderator keeps their glow.
  it("drops the glow when the rank goes away", () => {
    expect(
      resolveNameGlow({ nameGlowColors: ["#4f9dd9"], isBooster: false, guildRoles: ["Guru"] }),
    ).toBeNull();
  });
});

describe("a stop list on its way to storage", () => {
  it("keeps the order the member picked", () => {
    expect(normalizeGlowColors(["#AABBCC", "#112233"])).toEqual(["#aabbcc", "#112233"]);
  });

  it("caps the list rather than rejecting a long one", () => {
    const many = ["#111111", "#222222", "#333333", "#444444", "#555555"];
    expect(normalizeGlowColors(many)).toHaveLength(MAX_GLOW_STOPS);
  });

  it("drops entries that aren't colours", () => {
    expect(normalizeGlowColors(["#aabbcc", "nonsense", "#abc"])).toEqual(["#aabbcc"]);
  });

  // "No glow" has one representation, so a list that empties out reads the
  // same as one that was never set.
  it("reports an all-invalid or empty list as null", () => {
    expect(normalizeGlowColors([])).toBeNull();
    expect(normalizeGlowColors(["nope"])).toBeNull();
    expect(normalizeGlowColors(null)).toBeNull();
  });
});

describe("what a glowing name is painted with", () => {
  it("gives a lone stop a flat colour and no animation", () => {
    const props = nameGlowProps(["#4f9dd9"]);
    expect(props.className).toBeUndefined();
    expect(props.style?.color).toBe("#4f9dd9");
  });

  it("gives several stops the rotating gradient", () => {
    const props = nameGlowProps(["#4f9dd9", "#d94f9d", "#9dd94f"]);
    expect(props.className).toBe("name-glow");
    expect(props.style?.color).toBe("transparent");
  });

  it("renders nothing extra without stops", () => {
    expect(nameGlowProps(null)).toEqual({});
    expect(nameGlowProps([])).toEqual({});
  });
});

describe("how the gradient moves", () => {
  it("falls back to the default for an unknown or missing motion", () => {
    expect(normalizeGlowMotion(null)).toBe(DEFAULT_NAME_GLOW_MOTION);
    expect(normalizeGlowMotion("sideways")).toBe(DEFAULT_NAME_GLOW_MOTION);
  });

  it("keeps a motion it recognises", () => {
    for (const motion of NAME_GLOW_MOTIONS) {
      expect(normalizeGlowMotion(motion)).toBe(motion);
    }
  });

  it("gives every motion a paintable gradient", () => {
    for (const motion of NAME_GLOW_MOTIONS) {
      const style = nameGlowProps(["#4f9dd9", "#d94f9d"], motion).style;
      expect(style?.backgroundImage).toContain("--name-glow-stops");
    }
  });

  it("runs the opposite direction for a reversed sweep", () => {
    expect(
      nameGlowProps(["#111111", "#222222"], "sweep-right").style?.animationDirection,
    ).toBeUndefined();
    expect(nameGlowProps(["#111111", "#222222"], "sweep-left").style?.animationDirection).toBe(
      "reverse",
    );
    expect(nameGlowProps(["#111111", "#222222"], "sweep-up").style?.animationDirection).toBe(
      "reverse",
    );
  });

  // "Still" is the one motion with nothing to run, so it must not name an
  // animation at all — the shared class supplies duration and iteration.
  it("names no animation when the glow is still", () => {
    expect(nameGlowProps(["#111111", "#222222"], "still").style?.animationName).toBeUndefined();
  });

  it("uses a radial gradient only for the radial motion", () => {
    expect(nameGlowProps(["#111111", "#222222"], "radial").style?.backgroundImage).toContain(
      "radial-gradient",
    );
    expect(nameGlowProps(["#111111", "#222222"], "rotate").style?.backgroundImage).toContain(
      "linear-gradient",
    );
  });
});

describe("the glow the colours cast", () => {
  it("gives a single stop a halo of its own colour", () => {
    const style = nameGlowProps(["#4f9dd9"]).style;
    expect(style?.textShadow).toContain("#4f9dd9");
  });

  // The glyph is a clipped background painted over transparent text, so a
  // text-shadow would be cast by something invisible; the halo has to be a
  // filter, which reads the rendered alpha instead.
  it("gives a gradient a drop-shadow rather than a text-shadow", () => {
    const style = nameGlowProps(["#4f9dd9", "#d94f9d"]).style;
    expect(style?.textShadow).toBeUndefined();
    expect(style?.filter).toContain("drop-shadow");
    expect(style?.filter).toContain("#4f9dd9");
    expect(style?.filter).toContain("#d94f9d");
  });

  it("takes the motion straight from the stored column", () => {
    expect(nameGlowProps(["#111111", "#222222"], "still").style?.animationName).toBeUndefined();
    expect(nameGlowProps(["#111111", "#222222"], "radial").style?.backgroundImage).toContain(
      "radial-gradient",
    );
    // An unrecognised or absent column still has to paint something.
    expect(nameGlowProps(["#111111", "#222222"], null).style?.animationName).toBe(
      "name-glow-rotate",
    );
  });
});

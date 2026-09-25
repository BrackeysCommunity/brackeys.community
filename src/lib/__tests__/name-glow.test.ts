import { describe, expect, it } from "vite-plus/test";

import {
  canUseNameGlow,
  decodeNameGlow,
  encodeNameGlow,
  DEFAULT_NAME_GLOW_MOTION,
  NAME_GLOW_MOTIONS,
  normalizeGlowMotion,
  MAX_GLOW_STOPS,
  nameGlowProps,
  normalizeGlowColors,
  normalizeGlowColor,
  resolveNameGlow,
} from "@/lib/name-glow";

describe("accepting a picked color", () => {
  it("takes a six-digit hex and lowercases it", () => {
    expect(normalizeGlowColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeGlowColor("  #aabbcc  ")).toBe("#aabbcc");
  });

  it("takes an oklch colour sRGB can't hold, in the picker's own notation", () => {
    expect(normalizeGlowColor("oklch(70% 0.4 150)")).toBe("oklch(70% 0.4 150)");
    expect(normalizeGlowColor("OKLCH( 62.84% 0.25768 29.234 )")).toBe("oklch(62.8% 0.258 29.2)");
    expect(normalizeGlowColor("oklch(50% 0.1 360)")).toBe("oklch(50% 0.1 0)");
  });

  // safeThemeColor tolerates these for scraped jam colors; a value heading
  // for an inline style off a free-text picker gets the strict reading.
  it("rejects the shorthand, alpha and other functional forms", () => {
    for (const bad of [
      "#abc",
      "#aabbccdd",
      "rgb(1,2,3)",
      "red",
      "aabbcc",
      "oklch(0.7 0.4 150)",
      "oklch(70% 0.4 150 / 50%)",
      "oklch(170% 0.1 10)",
      "oklch(70% 0.4 150); color: red",
      "",
      null,
      undefined,
    ]) {
      expect(normalizeGlowColor(bad)).toBeNull();
    }
  });
});

describe("painting what was picked", () => {
  it("leaves near-black, near-white and wide-gamut picks alone", () => {
    const stops = ["#000000", "#ffffff", "oklch(70% 0.4 150)"];
    expect(resolveNameGlow({ nameGlowColors: stops, isBooster: true })).toEqual(stops);
  });

  it("casts an oklch stop's halo without a hex alpha suffix", () => {
    const { style } = nameGlowProps(["oklch(70% 0.4 150)"]);
    expect(style?.textShadow).toBe(
      "0 0 0.5em color-mix(in oklab, oklch(70% 0.4 150) 35%, transparent)",
    );
  });
});

describe("who actually gets a glow", () => {
  it("gives a boosting member their color", () => {
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

describe("rank entitlement", () => {
  // Staff earn the glow through rank, so they never have to boost for it.
  it.each(["Dev", "Admin", "Moderator", "Staff"])("lets %s wear one unboosted", (role) => {
    expect(canUseNameGlow({ isBooster: false, guildRoles: [role] })).toBe(true);
    expect(
      resolveNameGlow({ nameGlowColors: ["#4f9dd9"], isBooster: false, guildRoles: [role] }),
    ).not.toBeNull();
  });

  it.each(["Guru", "BIP"])("lets the %s community rank wear one unboosted", (role) => {
    expect(canUseNameGlow({ isBooster: false, guildRoles: [role] })).toBe(true);
  });

  it("withholds it from roles that aren't a rank", () => {
    expect(canUseNameGlow({ isBooster: false, guildRoles: ["Member"] })).toBe(false);
  });

  it("still lets a booster with no rank wear one", () => {
    expect(canUseNameGlow({ isBooster: true, guildRoles: null })).toBe(true);
  });

  // Stepping down doesn't wipe the stored colours, so the check has to be at
  // render or a former moderator keeps their glow.
  it("drops the glow when the rank goes away", () => {
    expect(
      resolveNameGlow({ nameGlowColors: ["#4f9dd9"], isBooster: false, guildRoles: ["Member"] }),
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

describe("sharing a glow as one line", () => {
  it("writes hex without the hash and oklch as-is", () => {
    expect(encodeNameGlow(["#e3a7a7", "#150b5e", "oklch(70% 0.4 150)"], "sweep-left")).toBe(
      "glow:sweep-left:e3a7a7,150b5e,oklch(70% 0.4 150)",
    );
  });

  it("reads back what it writes", () => {
    const stops = ["#e3a7a7", "#150b5e", "oklch(70% 0.4 150)"];
    expect(decodeNameGlow(encodeNameGlow(stops, "radial"))).toEqual({ stops, motion: "radial" });
  });

  it("forgives what a paste does to it", () => {
    expect(decodeNameGlow("  GLOW: Rotate : #E3A7A7 , 150b5e \n")).toEqual({
      stops: ["#e3a7a7", "#150b5e"],
      motion: "rotate",
    });
    expect(decodeNameGlow("e3a7a7,150b5e")).toEqual({
      stops: ["#e3a7a7", "#150b5e"],
      motion: null,
    });
  });

  it.each([
    "",
    "glow:spin:e3a7a7",
    "glow:rotate:e3a7a7,nope",
    "glow:rotate:e3a7a7,150b5e,1f0fbd,000000",
    "glow:rotate:e3a7a7:extra",
    "rgb(1, 2, 3)",
  ])("refuses %j whole", (raw) => {
    expect(decodeNameGlow(raw)).toBeNull();
  });
});

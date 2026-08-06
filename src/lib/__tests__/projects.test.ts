import { describe, expect, it } from "vite-plus/test";

import {
  pickReleasedAt,
  projectTypeFromClassification,
  projectTypeFromPlacement,
  slugifyProjectTitle,
} from "../projects";

describe("slugifyProjectTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyProjectTitle("Moth Garden")).toBe("moth-garden");
  });

  it("collapses runs of punctuation into one hyphen", () => {
    expect(slugifyProjectTitle("ORB inc. — a game!!")).toBe("orb-inc-a-game");
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyProjectTitle("  ...Wrong File!  ")).toBe("wrong-file");
  });

  it("folds accents rather than dropping the letter", () => {
    expect(slugifyProjectTitle("Pokémon Clone")).toBe("pokemon-clone");
    expect(slugifyProjectTitle("ÑAMTO")).toBe("namto");
  });

  it("falls back to a placeholder when nothing survives", () => {
    // Both exist in the scraped corpus; the collision suffix is what keeps
    // these distinct from each other.
    expect(slugifyProjectTitle("🎮🎮🎮")).toBe("project");
    expect(slugifyProjectTitle("東方")).toBe("project");
    expect(slugifyProjectTitle("")).toBe("project");
  });

  it("caps the length without leaving a trailing hyphen", () => {
    const slug = slugifyProjectTitle(`${"a".repeat(58)} bcdefgh`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("never emits consecutive hyphens", () => {
    expect(slugifyProjectTitle("a  --  b")).toBe("a-b");
  });
});

describe("projectTypeFromPlacement", () => {
  it("remaps the jam pseudo-type to game", () => {
    // `jam` was provenance wearing a type's clothes — a jam entry is a game
    // unless its owner says otherwise.
    expect(projectTypeFromPlacement("jam")).toBe("game");
  });

  it("passes the real kinds through", () => {
    expect(projectTypeFromPlacement("tool")).toBe("tool");
    expect(projectTypeFromPlacement("audio")).toBe("audio");
    expect(projectTypeFromPlacement("app")).toBe("app");
    expect(projectTypeFromPlacement("game")).toBe("game");
  });

  it("defaults to game for anything unknown or missing", () => {
    expect(projectTypeFromPlacement(null)).toBe("game");
    expect(projectTypeFromPlacement("nonsense")).toBe("game");
  });
});

describe("projectTypeFromClassification", () => {
  it("maps itch's own vocabulary", () => {
    expect(projectTypeFromClassification("tool")).toBe("tool");
    expect(projectTypeFromClassification("asset")).toBe("assets");
    expect(projectTypeFromClassification("soundtrack")).toBe("audio");
    expect(projectTypeFromClassification("game")).toBe("game");
  });

  it("puts the non-software kinds in `other` rather than calling them games", () => {
    expect(projectTypeFromClassification("comic")).toBe("other");
    expect(projectTypeFromClassification("book")).toBe("other");
    expect(projectTypeFromClassification("physical_game")).toBe("other");
    expect(projectTypeFromClassification("game_mod")).toBe("other");
  });

  it("is case- and whitespace-tolerant, since the value is stored verbatim", () => {
    expect(projectTypeFromClassification(" SOUNDTRACK ")).toBe("audio");
  });

  it("returns null for absent or unrecognized values, so a caller can keep its own guess", () => {
    expect(projectTypeFromClassification(null)).toBeNull();
    expect(projectTypeFromClassification("")).toBeNull();
    expect(projectTypeFromClassification("something_itch_added_later")).toBeNull();
  });
});

describe("pickReleasedAt", () => {
  const shipped = new Date("2026-03-01T00:00:00Z");

  it("takes the first real date in preference order", () => {
    expect(pickReleasedAt([null, undefined, shipped])).toBe(shipped);
  });

  it("is null when nothing honest is available", () => {
    // Never `createdAt` — that's when the row landed in our DB, not when
    // anything shipped.
    expect(pickReleasedAt([null, undefined])).toBeNull();
    expect(pickReleasedAt([])).toBeNull();
  });

  it("skips an invalid date rather than storing NaN", () => {
    expect(pickReleasedAt([new Date("not-a-date"), shipped])).toBe(shipped);
  });
});

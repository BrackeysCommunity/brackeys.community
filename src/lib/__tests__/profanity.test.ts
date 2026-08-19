import { describe, expect, it } from "vite-plus/test";

import { censorText, hasProfanity } from "@/lib/profanity";

describe("hasProfanity", () => {
  it("is clean for absent and empty text", () => {
    expect(hasProfanity(null)).toBe(false);
    expect(hasProfanity(undefined)).toBe(false);
    expect(hasProfanity("")).toBe(false);
  });

  it("leaves ordinary prose alone", () => {
    expect(hasProfanity("Pixel artist for a PSX-style horror RPG")).toBe(false);
  });
});

describe("censorText", () => {
  it("returns absent and clean text unchanged, by identity", () => {
    expect(censorText(null)).toBe(null);
    expect(censorText(undefined)).toBe(undefined);
    const clean = "Composer looking for a jam crew";
    expect(censorText(clean)).toBe(clean);
  });

  it("asterisks the match and keeps everything around it", () => {
    const out = censorText("this shit is broken");
    expect(out).toBe("this **** is broken");
  });

  it("sees through leetspeak", () => {
    // The dataset's own transformers do this; the test is here so a future
    // matcher swap can't quietly drop it.
    expect(censorText("sh1t")).not.toContain("1");
    expect(censorText("sh1t")).toContain("*");
  });

  it("sees through repeated letters and substituted symbols", () => {
    expect(censorText("sh!t")).toContain("*");
    expect(censorText("fuuuck")).toContain("*");
  });

  it("does not see through separators between the letters", () => {
    // Deliberate, and the reason it is pinned here: skipping non-alphabetic
    // characters in the blacklist is what makes a filter mangle ordinary
    // prose. This one is a viewer comfort setting, not a moderation
    // control — reports are — so a miss costs less than a false positive.
    expect(censorText("s h i t")).toBe("s h i t");
  });

  it("censors every occurrence, not just the first", () => {
    const out = censorText("shit and more shit");
    expect(out.match(/\*/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("leaves the Scunthorpe class of word alone", () => {
    // The whole reason for the dataset's word-boundary handling — a
    // rejected bio was bad enough, a mangled place name is worse.
    const town = "Based in Scunthorpe, open to remote work";
    expect(censorText(town)).toBe(town);
  });
});

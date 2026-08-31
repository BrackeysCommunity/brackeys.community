import { describe, expect, test } from "bun:test";

import { contrastCategories } from "./nsfw.ts";

/** Turn a desired logit into the sigmoid prob the pipeline would emit. */
const sig = (logit: number) => 1 / (1 + Math.exp(-logit));

// Label order matches nsfw.ts: 3 sexual prompts, 3 gore prompts, 6 safe.
const LABELS = [
  "a photo of a naked person",
  "an image showing explicit nudity or sexual content",
  "erotic artwork of a nude figure",
  "a photo of a dead body covered in blood",
  "an image showing graphic gore, blood, and mutilation",
  "artwork of a corpse or severed body parts",
  "video game cover art",
  "pixel art from a video game",
  "a cartoon illustration",
  "a screenshot of a video game",
  "a logo or text banner",
  "a landscape painting",
];

function scored(logits: number[]) {
  return LABELS.map((label, i) => ({ label, score: sig(logits[i] ?? -10) }));
}

describe("contrastCategories", () => {
  test("categories sum to at most 1 and cover both kinds", () => {
    const out = contrastCategories(scored([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(out.sexual).toBeCloseTo(3 / 12);
    expect(out.gore).toBeCloseTo(3 / 12);
  });

  test("a dominant gore prompt drives the gore category toward 1", () => {
    // One gore prompt far above everything else.
    const out = contrastCategories(scored([-5, -5, -5, 6, -5, -5, -5, -5, -5, -5, -5, -5]));
    expect(out.gore).toBeGreaterThan(0.99);
    expect(out.sexual).toBeLessThan(0.01);
  });

  test("strong safe anchors suppress weak flag signals", () => {
    // Flag prompts mildly positive, but a safe anchor wins the contrast.
    const out = contrastCategories(scored([-2, -2, -2, -2, -2, -2, 5, 2, -5, -5, -5, -5]));
    expect(out.sexual).toBeLessThan(0.01);
    expect(out.gore).toBeLessThan(0.01);
  });

  test("raw sigmoid magnitudes don't matter, only contrast does", () => {
    // All sigmoids tiny (SigLIP's usual regime), gore relatively strongest.
    const out = contrastCategories(scored([-9, -9, -9, -4, -9, -9, -8, -8, -8, -8, -8, -8]));
    expect(out.gore).toBeGreaterThan(0.5);
  });
});

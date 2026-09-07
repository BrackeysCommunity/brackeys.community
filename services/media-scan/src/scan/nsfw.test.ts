import { describe, expect, test } from "bun:test";

import { contrastCategories, PROMPT_COUNT } from "./nsfw.ts";

// Prompt order in nsfw.ts: 3 sexual, 3 gore, then the safe anchors.
const SEXUAL = [0, 1, 2];
const GORE = [3, 4, 5];

function logits(overrides: Record<number, number>): number[] {
  const out = new Array<number>(PROMPT_COUNT).fill(-10);
  for (const [i, v] of Object.entries(overrides)) out[Number(i)] = v;
  return out;
}

describe("contrastCategories", () => {
  test("uniform logits split probability by prompt count", () => {
    const out = contrastCategories(new Array<number>(PROMPT_COUNT).fill(0));
    expect(out.sexual).toBeCloseTo(SEXUAL.length / PROMPT_COUNT);
    expect(out.gore).toBeCloseTo(GORE.length / PROMPT_COUNT);
  });

  test("a dominant gore prompt absorbs the contrast without raising sexual", () => {
    // Gore never flags on its own — its prompts exist so a gory cover's
    // probability lands here instead of leaking into the sexual category.
    const out = contrastCategories(logits({ [GORE[0]!]: 6 }));
    expect(out.gore).toBeGreaterThan(0.99);
    expect(out.sexual).toBeLessThan(0.01);
  });

  test("a strong safe anchor suppresses weak flag signals", () => {
    // Flag prompts mildly positive relative to the floor, but a safe anchor
    // (any index past the category prompts) wins the contrast.
    const out = contrastCategories(logits({ 0: -2, 1: -2, 2: -2, 3: -2, 4: -2, 5: -2, 6: 5 }));
    expect(out.sexual).toBeLessThan(0.01);
    expect(out.gore).toBeLessThan(0.01);
  });

  test("absolute logit magnitudes don't matter, only contrast does", () => {
    // Everything deeply negative (SigLIP's usual regime), gore relatively strongest.
    const shifted = logits({ [GORE[0]!]: -4 }).map((z) => z - 5);
    const out = contrastCategories(shifted);
    expect(out.gore).toBeGreaterThan(0.5);
  });
});

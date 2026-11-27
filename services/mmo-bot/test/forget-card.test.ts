import { describe, expect, test } from "bun:test";

import { problems } from "../src/card.ts";
import { forgetAskCard, forgetDoneCard } from "../src/screens/forget.ts";

describe("forget cards", () => {
  for (const character of [true, false]) {
    test(`done card without Redis, character ${character}`, () => {
      const card = forgetDoneCard(character, "memory");
      expect(problems(card, new Set())).toEqual([]);
      expect(JSON.stringify(card)).toContain("in memory only");
    });
  }

  test("the ask card no longer mentions a carry", () => {
    expect(JSON.stringify(forgetAskCard(1))).not.toContain("carry");
  });
});

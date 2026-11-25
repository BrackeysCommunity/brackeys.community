import { describe, expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { canCraft } from "../src/screens/make.ts";

const at = (settlement: number) => ({ settlement, name: `town ${settlement}` });

describe("canCraft", () => {
  const inputs: api.Goods[] = [
    { material: "iron", units: 3 },
    { material: "oak", units: 2 },
  ];

  test("clean units alone cover the recipe", () => {
    expect(
      canCraft(
        [
          { material: "iron", units: 3 },
          { material: "oak", units: 2 },
        ],
        inputs,
      ),
    ).toBe(true);
  });

  test("two shortfalls staged at different origins cannot be crafted", () => {
    const goods: api.Goods[] = [
      { material: "iron", units: 1 },
      { material: "iron", units: 5, staged: at(1) },
      { material: "oak", units: 5, staged: at(2) },
    ];
    expect(canCraft(goods, inputs)).toBe(false);
  });

  test("two shortfalls staged at one origin can be crafted", () => {
    const goods: api.Goods[] = [
      { material: "iron", units: 1 },
      { material: "iron", units: 2, staged: at(1) },
      { material: "oak", units: 2, staged: at(1) },
      { material: "oak", units: 9, staged: at(2) },
    ];
    expect(canCraft(goods, inputs)).toBe(true);
  });
});

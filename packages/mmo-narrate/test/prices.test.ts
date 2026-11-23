import { describe, expect, test } from "vite-plus/test";

import { PRICES, costMicros, upperMicros, type Usage } from "../src/index.ts";

const u = (input: number, output = 0, cacheRead = 0, cacheWrite = 0): Usage => ({
  input,
  output,
  cacheRead,
  cacheWrite,
});

describe("costMicros", () => {
  test("whole micro-dollars, rounded up per call", () => {
    expect(costMicros("claude-haiku-5-5", u(0))).toBe(0);
    expect(costMicros("claude-haiku-5-5", u(1))).toBe(1);
    expect(costMicros("claude-haiku-5-5", u(10))).toBe(1);
    expect(costMicros("claude-haiku-5-5", u(11))).toBe(2);
    expect(costMicros("claude-haiku-5-5", u(30))).toBe(3);
    expect(costMicros("claude-haiku-5-5", u(0, 0, 100))).toBe(1);
    expect(costMicros("claude-haiku-5-5", u(0, 0, 0, 8))).toBe(1);
    expect(costMicros("claude-haiku-5-5", u(0, 0, 0, 9))).toBe(2);
  });

  test("each token kind at its own price", () => {
    expect(costMicros("claude-haiku-5-5", u(1_400, 300))).toBe(290);
    expect(costMicros("claude-sonnet-5-5", u(1_000, 100, 1_000, 1_000))).toBe(
      2_000 + 1_000 + 100 + 2_500,
    );
    expect(costMicros("claude-opus-5-5", u(1_000_000, 1_000_000))).toBe(24_000_000);
  });

  test("the table matches the pinned list prices", () => {
    expect(PRICES["claude-haiku-5-5"]).toEqual({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
    });
    expect(PRICES["claude-sonnet-5-5"]).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
    });
    expect(PRICES["claude-opus-5-5"]).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
    });
  });
});

describe("upperMicros", () => {
  test("every input token at the dearer rate, plus the whole output allowance", () => {
    expect(upperMicros("claude-haiku-5-5", 3_000, 2_000)).toBe(
      Math.ceil(1_000 * 0.125 + 2_000 * 0.5),
    );
    expect(upperMicros("claude-sonnet-5-5", 1, 0)).toBe(3);
  });

  test("it is never below what the stub's reckoning of the same call costs", () => {
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const) {
      for (const chars of [0, 7, 3_600, 60_000]) {
        const real = costMicros(model, u(Math.ceil(chars / 4), 1_500));
        expect(upperMicros(model, chars, 1_500)).toBeGreaterThanOrEqual(real);
      }
    }
  });
});

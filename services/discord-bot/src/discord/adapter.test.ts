import { expect, test } from "bun:test";

import { commandCooldownLine } from "./adapter.ts";

test("a command's own cooldown line states the allowance and the wait", () => {
  const rule = { limit: 10, windowMs: 10 * 60_000 };
  expect(commandCooldownLine(4 * 60_000 + 1, rule)).toBe(
    "That's the limit of 10 uses per 10 minutes. Try again in 5 minutes.",
  );
  expect(commandCooldownLine(20_000, { limit: 2, windowMs: 60_000 })).toBe(
    "That's the limit of 2 uses per minute. Try again in a minute.",
  );
});

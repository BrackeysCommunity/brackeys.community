import { describe, expect, test } from "bun:test";

import { createCooldown } from "./cooldown.ts";

describe("cooldown", () => {
  test("allows up to the limit inside the window, then refuses with a retry hint", () => {
    const cd = createCooldown({ limit: 3, windowMs: 10_000 });
    expect(cd.check("u1", 1000).allowed).toBe(true);
    expect(cd.check("u1", 2000).allowed).toBe(true);
    expect(cd.check("u1", 3000).allowed).toBe(true);
    expect(cd.check("u1", 4000)).toEqual({ allowed: false, retryAfterMs: 7000 });
    // Another user is unaffected.
    expect(cd.check("u2", 4000).allowed).toBe(true);
  });

  test("the window slides", () => {
    const cd = createCooldown({ limit: 2, windowMs: 10_000 });
    cd.check("u1", 0);
    cd.check("u1", 5000);
    expect(cd.check("u1", 9999).allowed).toBe(false);
    expect(cd.check("u1", 10_001).allowed).toBe(true);
  });
});

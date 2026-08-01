import { describe, expect, test } from "bun:test";

import { displacedSlug } from "./sync-jam.ts";

describe("displacedSlug", () => {
  test("parks a displaced jam under a recognizable synthetic slug", () => {
    expect(displacedSlug("days-of-horror-4", 123456)).toBe("days-of-horror-4--displaced-123456");
  });
});

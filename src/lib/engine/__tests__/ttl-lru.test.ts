import { describe, expect, it } from "vite-plus/test";

import { ttlLru } from "../ttl-lru";

describe("ttlLru", () => {
  it("answers a value until its time is up", () => {
    const cache = ttlLru<string, number>({ max: 10, ttlMs: 100 });
    cache.set("a", 1, 0);
    expect(cache.get("a", 99)).toBe(1);
    expect(cache.get("a", 100)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("drops the least recently read entry past its size", () => {
    const cache = ttlLru<string, number>({ max: 2, ttlMs: 1_000 });
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    expect(cache.get("a", 1)).toBe(1);
    cache.set("c", 3, 2);
    expect(cache.get("b", 3)).toBeUndefined();
    expect(cache.get("a", 3)).toBe(1);
    expect(cache.get("c", 3)).toBe(3);
  });

  it("restarts an entry's time when it's set again", () => {
    const cache = ttlLru<string, number>({ max: 10, ttlMs: 100 });
    cache.set("a", 1, 0);
    cache.set("a", 2, 90);
    expect(cache.get("a", 150)).toBe(2);
  });

  it("deletes one entry, the ones a test picks, or all", () => {
    const cache = ttlLru<string, { project: string }>({ max: 10, ttlMs: 1_000 });
    cache.set("x/1", { project: "x" }, 0);
    cache.set("x/2", { project: "x" }, 0);
    cache.set("y/1", { project: "y" }, 0);
    cache.delete("x/1");
    expect(cache.get("x/1", 1)).toBeUndefined();
    cache.deleteWhere((v) => v.project === "x");
    expect(cache.size).toBe(1);
    expect(cache.get("y/1", 1)).toEqual({ project: "y" });
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

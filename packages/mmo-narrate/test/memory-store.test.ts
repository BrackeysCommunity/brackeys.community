import { describe, expect, test } from "vite-plus/test";

import { memoryStore } from "../src/index.ts";

describe("memoryStore", () => {
  test("values expire against the injected clock", async () => {
    let now = 0;
    const s = memoryStore({ now: () => now });
    await s.set("a", "1", 10);
    await s.set("forever", "x", null);
    expect(await s.get("a")).toBe("1");
    now = 9_999;
    expect(await s.get("a")).toBe("1");
    now = 10_000;
    expect(await s.get("a")).toBeNull();
    now = 1e12;
    expect(await s.get("forever")).toBe("x");
    expect(s.keys()).toEqual(["forever"]);
  });

  test("counters take their TTL when created", async () => {
    let now = 0;
    const s = memoryStore({ now: () => now });
    expect(await s.incr("c", 5)).toBe(1);
    now = 4_000;
    expect(await s.incr("c", 5)).toBe(2);
    now = 5_000;
    expect(await s.get("c")).toBeNull();
    expect(await s.incr("c", 5)).toBe(1);
  });

  test("hashes add integers field by field", async () => {
    const s = memoryStore();
    await s.hincr("h", { usd: 3, "chronicle.calls": 1 }, 60);
    await s.hincr("h", { usd: 4 }, 60);
    expect(await s.hgetall("h")).toEqual({ usd: "7", "chronicle.calls": "1" });
    expect(await s.hgetall("none")).toEqual({});
    await expect(s.hincr("h", { usd: 0.5 }, 60)).rejects.toThrow();
  });

  test("a list keeps the newest entries", async () => {
    const s = memoryStore();
    for (const v of ["a", "b", "c", "d"]) await s.push("held", v, 3);
    expect(s.list("held")).toEqual(["d", "c", "b"]);
  });

  test("a key holds one type", async () => {
    const s = memoryStore();
    await s.hincr("h", { a: 1 }, 60);
    await expect(s.get("h")).rejects.toThrow();
    await s.set("t", "text", null);
    await expect(s.incr("t", 60)).rejects.toThrow();
    await expect(s.push("t", "x", 3)).rejects.toThrow();
  });
});

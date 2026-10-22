import { describe, expect, it } from "vite-plus/test";

import { presenceInstancesKey, presenceKey, readPresence } from "../sync-channels";

function fakeRedis(data: Record<string, string | string[]>) {
  return {
    smembers: async (key: string) => (data[key] as string[] | undefined) ?? [],
    mget: async (...keys: string[]) => keys.map((key) => (data[key] as string | undefined) ?? null),
  };
}

describe("readPresence", () => {
  const prefix = "staging:canvas-sync";

  it("unions every instance's users per document and skips expired or empty ones", async () => {
    const redis = fakeRedis({
      [presenceInstancesKey(prefix, "canvas:a")]: ["i1", "i2", "dead"],
      [presenceKey(prefix, "canvas:a", "i1")]: JSON.stringify(["u1", "u2"]),
      [presenceKey(prefix, "canvas:a", "i2")]: JSON.stringify(["u2", "u3"]),
      [presenceInstancesKey(prefix, "canvas:b")]: ["i1"],
      [presenceKey(prefix, "canvas:b", "i1")]: "not json",
    });
    const found = await readPresence(redis, prefix, ["canvas:a", "canvas:b", "canvas:c"]);
    expect([...found.keys()]).toEqual(["canvas:a"]);
    expect(found.get("canvas:a")!.sort()).toEqual(["u1", "u2", "u3"]);
  });
});

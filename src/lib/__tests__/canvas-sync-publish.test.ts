import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { projectRevokesFor } from "@/lib/canvas/revokes";
import { parseRevokeMessage, revokeTombstoneKeys, syncEnvPrefix } from "@/lib/canvas/sync-channels";

const sent = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/redis", () => ({
  createRedisClient: async () => ({
    status: "ready",
    publish: async (channel: string, message: string) => void sent.calls.push([channel, message]),
    set: async (key: string, value: string) => void sent.calls.push([key, value]),
  }),
}));

const { publishProjectRevoke, publishSceneRevoke } = await import("@/lib/canvas-sync-publish");

const PREFIX = syncEnvPrefix("publish-test");

beforeEach(() => {
  sent.calls = [];
  vi.stubEnv("REDIS_URL", "redis://unused");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "publish-test");
});

afterEach(() => vi.unstubAllEnvs());

describe("publishProjectRevoke", () => {
  it("publishes a project revoke and tombstones it where every project document looks", async () => {
    await publishProjectRevoke("jam", "u1");
    const [[channel, message], [key]] = sent.calls as [[string, string], [string]];
    expect(channel).toBe(`${PREFIX}:revoke`);
    expect(parseRevokeMessage(message)).toEqual({ projectId: "jam", userId: "u1" });
    for (const name of ["project:jam", "scene:jam.level-1", "asset:jam.k1"]) {
      expect(revokeTombstoneKeys(PREFIX, name, "u1")).toContain(key);
    }
    expect(revokeTombstoneKeys(PREFIX, "scene:other.level-1", "u1")).not.toContain(key);
  });

  it("revokes everyone on the project without a user", async () => {
    await publishProjectRevoke("jam");
    expect(parseRevokeMessage(sent.calls[0]![1] as string)).toEqual({ projectId: "jam" });
    expect(sent.calls[1]![0]).toBe(`${PREFIX}:revoked:project:jam:`);
  });

  it("leaves a scene revoke to its one scene", async () => {
    await publishSceneRevoke("jam.level-1");
    const key = sent.calls[1]![0] as string;
    expect(revokeTombstoneKeys(PREFIX, "scene:jam.level-1", "u1")).toContain(key);
    expect(revokeTombstoneKeys(PREFIX, "asset:jam.k1", "u1")).not.toContain(key);
  });

  it("does nothing without Redis", async () => {
    vi.stubEnv("REDIS_URL", "");
    await publishProjectRevoke("jam");
    expect(sent.calls).toEqual([]);
  });
});

describe("projectRevokesFor", () => {
  it("closes every connection to a deleted project and none on a restore", () => {
    expect(projectRevokesFor({ type: "deleted", projectId: "jam" })).toEqual([
      { projectId: "jam" },
    ]);
    expect(projectRevokesFor({ type: "restored", projectId: "jam" })).toEqual([]);
  });
});

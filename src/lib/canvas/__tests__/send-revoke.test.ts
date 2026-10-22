import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  parseRevokeMessage,
  revokeChannel,
  revokeTombstoneKey,
  revokeTombstoneKeys,
  type RevokeMessage,
  sendRevoke,
} from "@/lib/canvas/sync-channels";

const PREFIX = "test:canvas-sync";

function recorder(failOn?: "publish" | "set") {
  const calls: unknown[][] = [];
  return {
    calls,
    client: {
      publish: async (channel: string, message: string) => {
        if (failOn === "publish") throw new Error("publish down");
        calls.push(["publish", channel, message]);
        return 1;
      },
      set: async (key: string, value: string, mode: "PX", ms: number) => {
        if (failOn === "set") throw new Error("set down");
        calls.push(["set", key, value, mode, ms]);
        return "OK";
      },
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("sendRevoke", () => {
  it("publishes first, then writes the tombstone with the revoke time and TTL", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const { client, calls } = recorder();
    await sendRevoke(client, PREFIX, { canvasId: "c1", userId: "u1" }, 62_000);
    expect(calls).toEqual([
      ["publish", revokeChannel(PREFIX), JSON.stringify({ canvasId: "c1", userId: "u1" })],
      ["set", `${PREFIX}:revoked:c1:u1`, "1700000000000", "PX", 62_000],
    ]);
  });

  it.each<[RevokeMessage, string]>([
    [{ canvasId: "c1" }, `${PREFIX}:revoked:c1:`],
    [{ userId: "u1" }, `${PREFIX}:revoked::u1`],
  ])("a %j revoke tombstones the key the service checks", async (message, key) => {
    const { client, calls } = recorder();
    await sendRevoke(client, PREFIX, message, 1_000);
    expect(calls[1]?.[1]).toBe(key);
    expect(revokeTombstoneKeys(PREFIX, "c1", "u1")).toContain(key);
    expect(parseRevokeMessage(calls[0]![2] as string)).toEqual(message);
  });

  it("a failed publish writes no tombstone and surfaces the error", async () => {
    const { client, calls } = recorder("publish");
    await expect(sendRevoke(client, PREFIX, { canvasId: "c1" }, 1_000)).rejects.toThrow(
      "publish down",
    );
    expect(calls).toEqual([]);
  });

  it("a failed tombstone write still leaves the publish sent", async () => {
    const { client, calls } = recorder("set");
    await expect(sendRevoke(client, PREFIX, { canvasId: "c1" }, 1_000)).rejects.toThrow("set down");
    expect(calls.map((c) => c[0])).toEqual(["publish"]);
  });

  it("keys never collide between a canvas-wide and a user-wide revoke", () => {
    expect(revokeTombstoneKey(PREFIX, "x", undefined)).not.toBe(
      revokeTombstoneKey(PREFIX, undefined, "x"),
    );
  });
});

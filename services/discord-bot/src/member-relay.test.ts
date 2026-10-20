import { describe, expect, test } from "bun:test";

import { RELAY_SIGNATURE_HEADER, verifyRelay } from "../../../src/lib/bot-relay-signature.ts";
import { createMemberRelay, identityChanged, type MemberIdentity } from "./member-relay.ts";

const base: MemberIdentity = {
  guildAvatar: null,
  nickname: "Job",
  avatar: "abc",
  username: "duxez",
};

describe("identityChanged", () => {
  test("an uncached old member always counts", () => {
    expect(identityChanged(null, base)).toBe(true);
  });

  test("role-only updates don't", () => {
    expect(identityChanged(base, { ...base })).toBe(false);
  });

  test("a new global or server avatar does", () => {
    expect(identityChanged(base, { ...base, avatar: "def" })).toBe(true);
    expect(identityChanged(base, { ...base, guildAvatar: "g1" })).toBe(true);
  });
});

describe("createMemberRelay", () => {
  test("collapses a burst into one signed POST", async () => {
    const requests: Request[] = [];
    const relay = createMemberRelay({
      appUrl: "https://site.test",
      secret: "bot-token",
      debounceMs: 5,
      fetchImpl: async (request) => {
        requests.push(request);
        return new Response(null, { status: 204 });
      },
    });

    relay.relay("100000000000000003");
    relay.relay("100000000000000003");
    await Bun.sleep(30);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toBe("https://site.test/api/discord/member-sync");
    const body = await request!.text();
    expect(JSON.parse(body)).toEqual({ discordId: "100000000000000003" });
    expect(await verifyRelay("bot-token", body, request!.headers.get(RELAY_SIGNATURE_HEADER))).toBe(
      true,
    );
  });

  test("a failed POST is logged, not thrown", async () => {
    const lines: string[] = [];
    const relay = createMemberRelay({
      appUrl: "https://site.test",
      secret: "bot-token",
      debounceMs: 1,
      fetchImpl: async () => {
        throw new Error("down");
      },
      log: (line) => lines.push(line),
    });
    relay.relay("100000000000000003");
    await Bun.sleep(20);
    expect(lines.some((line) => line.includes("failed"))).toBe(true);
  });
});

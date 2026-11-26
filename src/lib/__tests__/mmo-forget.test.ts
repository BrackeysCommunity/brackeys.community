import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  env: {} as { MMO_WORLD_URL?: string; MMO_MAP_TOKEN?: string; MMO_FORGET_TOKEN?: string },
  accounts: [] as { accountId: string }[],
}));

vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => state.accounts }) }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({
  account: { accountId: "account.accountId", userId: "account.userId", providerId: "p" },
}));

const {
  deletionForgetKey,
  ForgetError,
  forgetEnabled,
  forgetGameData,
  forgetUserGameData,
  gameDataStatus,
  settingsForgetKey,
} = await import("@/lib/mmo-forget");
const { worldFetch } = await import("@/lib/mmo-map/world");

interface Call {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
}

let calls: Call[] = [];
let reply: () => Response;

beforeEach(() => {
  for (const k of Object.keys(state.env)) delete state.env[k as keyof typeof state.env];
  state.env.MMO_WORLD_URL = "http://world.test/";
  state.env.MMO_MAP_TOKEN = "map-token";
  state.env.MMO_FORGET_TOKEN = "forget-token";
  state.accounts = [{ accountId: "123456789012345678" }];
  calls = [];
  reply = () => Response.json({ forgotten: true, swept: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      calls.push({
        url: String(input),
        init,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
      });
      return reply();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forgetEnabled", () => {
  it("needs both the world and the forget token", () => {
    expect(forgetEnabled()).toBe(true);
    delete state.env.MMO_FORGET_TOKEN;
    expect(forgetEnabled()).toBe(false);
    state.env.MMO_FORGET_TOKEN = "forget-token";
    delete state.env.MMO_WORLD_URL;
    expect(forgetEnabled()).toBe(false);
  });
});

describe("forgetGameData", () => {
  it("posts one forget request with the forget token and nothing else", async () => {
    await expect(forgetGameData("123456789012345678", "site-forget-abc")).resolves.toEqual({
      forgotten: true,
      swept: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://world.test/v1/forget");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].headers).toEqual({
      accept: "application/json",
      authorization: "Bearer forget-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      interactionId: "site-forget-abc",
      discordId: "123456789012345678",
    });
  });

  it("throws with the world's status and code when it refuses", async () => {
    reply = () => Response.json({ code: "unauthorized" }, { status: 401 });
    const err = await forgetGameData("1", "k").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForgetError);
    expect(err).toMatchObject({ status: 401, code: "unauthorized" });
    expect(String(err)).not.toContain("forget-token");
  });

  it("throws when the world cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(forgetGameData("1", "k")).rejects.toMatchObject({
      status: 0,
      code: "unavailable",
    });
  });

  it("never calls the world without the forget token", async () => {
    delete state.env.MMO_FORGET_TOKEN;
    await expect(forgetGameData("1", "k")).rejects.toThrow(/not set/);
    expect(calls).toEqual([]);
  });
});

describe("worldFetch beside worldPost", () => {
  it("still reads with the map token and no body", async () => {
    await worldFetch("/v1/map/index", { server: "1" });

    expect(calls[0].url).toBe("http://world.test/v1/map/index?server=1");
    expect(calls[0].init.method).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].headers).toEqual({
      accept: "application/json",
      authorization: "Bearer map-token",
    });
  });
});

describe("keys", () => {
  it("gives an account deletion one key, from the user id's hash", () => {
    expect(deletionForgetKey("u1")).toBe(deletionForgetKey("u1"));
    expect(deletionForgetKey("u1")).toMatch(/^site-forget-[0-9a-f]{16}$/);
    expect(deletionForgetKey("u1")).not.toContain("u1");
    expect(deletionForgetKey("u2")).not.toBe(deletionForgetKey("u1"));
  });

  it("gives every settings request a key of its own, within the world's limit", () => {
    const a = settingsForgetKey("u1");
    const b = settingsForgetKey("u1");

    expect(a).not.toBe(b);
    expect(a.startsWith(`${deletionForgetKey("u1")}-`)).toBe(true);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).not.toContain("/");
  });
});

describe("the settings section's gate and action", () => {
  it("shows only with forget enabled, a user and a linked Discord account", async () => {
    await expect(gameDataStatus("u1")).resolves.toEqual({ shown: true });
    await expect(gameDataStatus(undefined)).resolves.toEqual({ shown: false });
    state.accounts = [];
    await expect(gameDataStatus("u1")).resolves.toEqual({ shown: false });
    state.accounts = [{ accountId: "1" }];
    delete state.env.MMO_FORGET_TOKEN;
    await expect(gameDataStatus("u1")).resolves.toEqual({ shown: false });
  });

  it("forgets the linked account's character with a fresh key", async () => {
    await forgetUserGameData("u1");
    await forgetUserGameData("u1");

    const bodies = calls.map((c) => JSON.parse(c.init.body as string) as Record<string, string>);
    expect(bodies.map((b) => b.discordId)).toEqual(["123456789012345678", "123456789012345678"]);
    expect(bodies[0].interactionId).not.toBe(bodies[1].interactionId);
  });

  it("refuses without a linked Discord account", async () => {
    state.accounts = [];
    await expect(forgetUserGameData("u1")).rejects.toThrow(/Discord/);
    expect(calls).toEqual([]);
  });
});

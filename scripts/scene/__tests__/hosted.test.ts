// @vitest-environment node
import { COLLAB_LAYOUT_VERSION } from "@jams/engine/collab";
import { SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_SYNC_TOKEN_PATH,
  AGENT_TOKEN_ENV,
  AgentTokenExpiredError,
  AgentTokenRevokedError,
  agentTokenFrom,
  createAgentSyncTokens,
  HostedError,
  HostedProjectsOffError,
  requireAgentToken,
  SYNC_TOKEN_REFRESH_MARGIN_MS,
  SYNC_TOKEN_TTL_MS,
} from "../hosted";

const SITE = "https://staging.example.test";
const SECRET = "jat_s3cretValueThatMustNeverPrint";

type Call = { url: string; init: RequestInit };
type Reply = { status?: number; body?: unknown; date?: number | null } | Error;

/** A fetch that answers from `replies` in order and records every call. */
function fakeFetch(replies: Reply[], clock: { t: number }) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    const reply = replies.shift();
    if (!reply) throw new Error("no reply queued");
    if (reply instanceof Error) throw reply;
    const headers = new Headers({ "content-type": "application/json" });
    const date = reply.date === undefined ? clock.t : reply.date;
    if (date !== null) headers.set("date", new Date(date).toUTCString());
    return new Response(JSON.stringify(reply.body ?? null), {
      status: reply.status ?? 200,
      headers,
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const grant = (n: number, at: number, over: Record<string, unknown> = {}) => ({
  body: {
    token: `sync-${n}`,
    url: "wss://sync.example.test",
    access: "write",
    projectId: "demo",
    agentId: "agent-1",
    expiresAt: at + SYNC_TOKEN_TTL_MS,
    ...over,
  },
});

function setup(replies: (clock: { t: number }) => Reply[], extra = {}) {
  const clock = { t: Date.UTC(2026, 10, 7, 12) };
  const { fetch, calls } = fakeFetch(replies(clock), clock);
  const tokens = createAgentSyncTokens({
    site: SITE,
    agentToken: SECRET,
    fetch,
    now: () => clock.t,
    ...extra,
  });
  return { clock, calls, tokens };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

const neverLeaks = (error: unknown) => {
  expect(String(error)).not.toContain(SECRET);
  expect(JSON.stringify(error)).not.toContain(SECRET);
  expect((error as Error).stack ?? "").not.toContain(SECRET);
};

describe("agentTokenFrom", () => {
  it("prefers --token, falls back to the env, and is null when neither is set", () => {
    expect(agentTokenFrom("jat_flag", { [AGENT_TOKEN_ENV]: "jat_env" })).toBe("jat_flag");
    expect(agentTokenFrom(undefined, { [AGENT_TOKEN_ENV]: " jat_env \n" })).toBe("jat_env");
    expect(agentTokenFrom(undefined, {})).toBeNull();
    expect(agentTokenFrom(undefined, { [AGENT_TOKEN_ENV]: "  " })).toBeNull();
  });

  it("refuses a bare --token and names both sources when one is required", () => {
    expect(() => agentTokenFrom(true, {})).toThrow(HostedError);
    const error = (() => {
      try {
        requireAgentToken(undefined, {});
      } catch (e) {
        return e as HostedError;
      }
    })();
    expect(error?.code).toBe("no-token");
    expect(error?.message).toContain("--token");
    expect(error?.message).toContain(AGENT_TOKEN_ENV);
  });
});

describe("createAgentSyncTokens", () => {
  it("posts the bearer token and the client's versions to the exchange route", async () => {
    const { calls, tokens } = setup((c) => [grant(1, c.t)]);
    const got = await tokens.get();
    expect(got).toMatchObject({
      token: "sync-1",
      url: "wss://sync.example.test",
      access: "write",
      projectId: "demo",
      agentId: "agent-1",
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`${SITE}${AGENT_SYNC_TOKEN_PATH}`);
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(typeof call?.init.body).toBe("string");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      formatVersion: SCENE_FORMAT_VERSION,
      layoutVersion: COLLAB_LAYOUT_VERSION,
    });
    expect(await tokens.token()).toBe("sync-1");
    expect(calls).toHaveLength(1);
  });

  it("holds a token until the margin before expiry, then refreshes it", async () => {
    const { clock, calls, tokens } = setup((c) => [
      grant(1, c.t),
      grant(2, c.t + SYNC_TOKEN_TTL_MS - SYNC_TOKEN_REFRESH_MARGIN_MS),
    ]);
    expect((await tokens.get()).token).toBe("sync-1");
    clock.t += SYNC_TOKEN_TTL_MS - SYNC_TOKEN_REFRESH_MARGIN_MS - 1;
    expect((await tokens.get()).token).toBe("sync-1");
    expect(calls).toHaveLength(1);
    clock.t += 1;
    expect((await tokens.get()).token).toBe("sync-2");
    expect(calls).toHaveLength(2);
  });

  it("shares one request between concurrent asks", async () => {
    const { calls, tokens } = setup((c) => [grant(1, c.t)]);
    const [a, b, c] = await Promise.all([tokens.get(), tokens.token(), tokens.get()]);
    expect(a.token).toBe("sync-1");
    expect(b).toBe("sync-1");
    expect(c).toBe(a);
    expect(calls).toHaveLength(1);
  });

  it("refresh() mints whatever is held", async () => {
    const { calls, tokens } = setup((c) => [grant(1, c.t), grant(2, c.t)]);
    await tokens.get();
    expect((await tokens.refresh()).token).toBe("sync-2");
    expect(calls).toHaveLength(2);
  });

  it("measures the lifetime by the site's clock, never past the TTL", async () => {
    const ahead = setup((c) => [{ ...grant(1, c.t + 3_600_000), date: c.t + 3_600_000 }]);
    expect((await ahead.tokens.get()).expiresAt).toBe(ahead.clock.t + SYNC_TOKEN_TTL_MS);

    const behind = setup((c) => [{ ...grant(1, c.t - 3_600_000), date: c.t - 3_600_000 }]);
    expect((await behind.tokens.get()).expiresAt).toBe(behind.clock.t + SYNC_TOKEN_TTL_MS);

    const short = setup((c) => [{ ...grant(1, c.t - 30_000), date: c.t }]);
    expect((await short.tokens.get()).expiresAt).toBe(short.clock.t + 30_000);

    const undated = setup((c) => [{ ...grant(1, c.t + 999_999), date: null }]);
    expect((await undated.tokens.get()).expiresAt).toBe(undated.clock.t + SYNC_TOKEN_TTL_MS);
  });

  it("keeps the held token through a failed refresh while it is still valid", async () => {
    const { clock, tokens } = setup((c) => [
      grant(1, c.t),
      new TypeError("socket hang up"),
      new TypeError("socket hang up"),
    ]);
    await tokens.get();
    clock.t += SYNC_TOKEN_TTL_MS - SYNC_TOKEN_REFRESH_MARGIN_MS;
    expect((await tokens.get()).token).toBe("sync-1");
    clock.t += SYNC_TOKEN_REFRESH_MARGIN_MS;
    const error = await caught(tokens.get());
    expect(error).toBeInstanceOf(HostedError);
    expect((error as HostedError).code).toBe("unreachable");
  });

  it("types an expired agent token and never asks again", async () => {
    const { calls, tokens } = setup(() => [
      { status: 401, body: { message: "That agent token is expired." } },
    ]);
    const error = await caught(tokens.get());
    expect(error).toBeInstanceOf(AgentTokenExpiredError);
    expect((error as HostedError).code).toBe("expired");
    expect((error as HostedError).status).toBe(401);
    neverLeaks(error);
    expect(await caught(tokens.get())).toBe(error);
    expect(calls).toHaveLength(1);
  });

  it("types a revoked agent token, dropping the held sync token", async () => {
    const { clock, calls, tokens } = setup((c) => [
      grant(1, c.t),
      { status: 401, body: { message: "That agent token is revoked." } },
    ]);
    await tokens.get();
    clock.t += SYNC_TOKEN_TTL_MS - SYNC_TOKEN_REFRESH_MARGIN_MS;
    const error = await caught(tokens.get());
    expect(error).toBeInstanceOf(AgentTokenRevokedError);
    expect((error as HostedError).code).toBe("revoked");
    neverLeaks(error);
    expect(await caught(tokens.get())).toBe(error);
    expect(calls).toHaveLength(2);
  });

  it("types the flag being off, and asks again later since a flag can flip", async () => {
    const { calls, tokens } = setup((c) => [
      { status: 404, body: { message: "Not found." } },
      grant(1, c.t),
    ]);
    const error = await caught(tokens.get());
    expect(error).toBeInstanceOf(HostedProjectsOffError);
    expect((error as HostedError).code).toBe("flag-off");
    neverLeaks(error);
    expect((await tokens.get()).token).toBe("sync-1");
    expect(calls).toHaveLength(2);
  });

  it.each([
    [401, "That agent token isn't valid.", "invalid"],
    [403, "The token's creator no longer has staff access.", "forbidden"],
    [404, "No such project.", "project-missing"],
    [429, "Too many sync tokens for this agent token; slow down.", "rate-limited"],
    [503, "Live projects aren't set up here.", "not-configured"],
    [500, "", "refused"],
  ] as const)("maps a %i (%s) to %s", async (status, message, code) => {
    const { tokens } = setup(() => [{ status, body: message ? { message } : null }]);
    const error = await caught(tokens.get());
    expect(error).toBeInstanceOf(HostedError);
    expect(error).not.toBeInstanceOf(AgentTokenExpiredError);
    expect(error).not.toBeInstanceOf(AgentTokenRevokedError);
    expect(error).not.toBeInstanceOf(HostedProjectsOffError);
    expect((error as HostedError).code).toBe(code);
    expect((error as HostedError).status).toBe(status);
  });

  it("refuses a token for another project, once", async () => {
    const { calls, tokens } = setup((c) => [grant(1, c.t, { projectId: "other" })], {
      projectId: "demo",
    });
    const error = await caught(tokens.get());
    expect((error as HostedError).code).toBe("wrong-project");
    expect(await caught(tokens.get())).toBe(error);
    expect(calls).toHaveLength(1);
  });

  it("refuses a malformed grant", async () => {
    const { tokens } = setup((c) => [grant(1, c.t, { token: 42 })]);
    expect(((await caught(tokens.get())) as HostedError).code).toBe("bad-response");
  });

  it("never prints the secret, even when the site or the network echoes it", async () => {
    const { tokens } = setup(() => [{ status: 401, body: { message: `Bad bearer ${SECRET}` } }]);
    const error = await caught(tokens.get());
    expect((error as HostedError).code).toBe("invalid");
    neverLeaks(error);

    const offline = setup(() => [new Error(`connect failed for ${SECRET}`)]);
    const down = await caught(offline.tokens.get());
    expect((down as HostedError).code).toBe("unreachable");
    neverLeaks(down);

    expect(JSON.stringify(offline.tokens)).not.toContain(SECRET);
    expect(Object.values(offline.tokens).join(" ")).not.toContain(SECRET);
  });

  it("refuses a site that isn't http(s) and an empty agent token up front", () => {
    expect(() => createAgentSyncTokens({ site: "ftp://x.test", agentToken: SECRET })).toThrow(
      expect.objectContaining({ code: "bad-url" }),
    );
    expect(() => createAgentSyncTokens({ site: "not a url", agentToken: SECRET })).toThrow(
      expect.objectContaining({ code: "bad-url" }),
    );
    expect(() => createAgentSyncTokens({ site: SITE, agentToken: "  " })).toThrow(
      expect.objectContaining({ code: "no-token" }),
    );
  });
});

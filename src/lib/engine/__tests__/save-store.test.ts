import { describe, expect, it } from "vite-plus/test";

import { HOST_NO_SITE_SAVES_MESSAGE } from "../host-server";
import { SITE_SAVE_LIMITS } from "../limits";
import { ReleaseError } from "../release-errors";
import { saveSignedOut, SIGNED_IN_SAVES_DESCRIBE, type AccountSaves } from "../save-api";
import {
  deleteAccountSave,
  fetchAccountSaves,
  fetchSaveText,
  SAVE_FAILED_MESSAGE,
  SAVE_UNREACHABLE_MESSAGE,
  siteSaveStore,
} from "../save-store";

type Call = {
  url: string;
  method: string;
  credentials: RequestCredentials | undefined;
  body: string | null;
};

/** A `fetch` that records each call and answers from `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

const summary = { slot: "a", meta: { scene: "one", savedAt: 1, playTicks: 2 }, bytes: 120 };

describe("siteSaveStore", () => {
  it("is a host store with the site's limits and the signed-in sentence", () => {
    const store = siteSaveStore("p1", { fetch: fakeFetch(() => json({})).fetch });
    expect(store.kind).toBe("host");
    expect(store.limits).toEqual(SITE_SAVE_LIMITS);
    expect(store.describe).toBe(SIGNED_IN_SAVES_DESCRIBE);
    expect(siteSaveStore("p1", { describe: "Until the list answers." }).describe).toBe(
      "Until the list answers.",
    );
  });

  it("lists through the project's route and takes its describe and limits", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        saves: [summary],
        limits: { maxBytes: 1_000, maxSlots: 2 },
        describe: HOST_NO_SITE_SAVES_MESSAGE,
        mode: "own",
      }),
    );
    const store = siteSaveStore("my game", { fetch });
    expect(await store.list("tactics")).toEqual([summary]);
    expect(calls).toEqual([
      { url: "/api/engine/saves/my%20game", method: "GET", credentials: "same-origin", body: null },
    ]);
    expect(store.describe).toBe(HOST_NO_SITE_SAVES_MESSAGE);
    expect(store.limits).toEqual({ maxBytes: 1_000, maxSlots: 2 });
  });

  it("lists nothing when the route refuses or the request fails", async () => {
    const refused = siteSaveStore("p1", {
      fetch: fakeFetch(() => json(saveSignedOut(), 401)).fetch,
    });
    expect(await refused.list("g")).toEqual([]);
    expect(refused.describe).toBe(SIGNED_IN_SAVES_DESCRIBE);
    const offline = siteSaveStore("p1", {
      fetch: fakeFetch(() => Promise.reject(new TypeError("Failed to fetch"))).fetch,
    });
    expect(await offline.list("g")).toEqual([]);
  });

  it("loads the list, or throws when the route refuses or the request fails", async () => {
    const answer = {
      saves: [summary],
      limits: { maxBytes: 1_000, maxSlots: 2 },
      describe: SIGNED_IN_SAVES_DESCRIBE,
      mode: "site",
    };
    const store = siteSaveStore("p1", { fetch: fakeFetch(() => json(answer)).fetch });
    expect(await store.load()).toEqual(answer);
    expect(store.limits).toEqual({ maxBytes: 1_000, maxSlots: 2 });

    const refused = siteSaveStore("p1", {
      fetch: fakeFetch(() => json(saveSignedOut(), 401)).fetch,
    });
    const error = await refused.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReleaseError);
    expect((error as ReleaseError).status).toBe(401);
    expect((error as ReleaseError).body).toEqual(saveSignedOut());

    const offline = siteSaveStore("p1", {
      fetch: fakeFetch(() => Promise.reject(new TypeError("Failed to fetch"))).fetch,
    });
    await expect(offline.load()).rejects.toThrow("Failed to fetch");
  });

  it("reads a slot's text, and null for an empty slot or a failure", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.url.endsWith("/a")
        ? new Response('{"kind":"save"}', { headers: { "content-type": "application/json" } })
        : json({ code: "not-found", message: "There is no save in this slot." }, 404),
    );
    const store = siteSaveStore("p1", { fetch });
    expect(await store.read("g", "a")).toBe('{"kind":"save"}');
    expect(await store.read("g", "b")).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["/api/engine/saves/p1/a", "/api/engine/saves/p1/b"]);
    const offline = siteSaveStore("p1", {
      fetch: fakeFetch(() => Promise.reject(new TypeError("offline"))).fetch,
    });
    expect(await offline.read("g", "a")).toBeNull();
  });

  it("writes the raw text with PUT and answers the stored bytes", async () => {
    const { fetch, calls } = fakeFetch(() => json({ bytes: 42 }));
    const store = siteSaveStore("p1", { fetch });
    expect(await store.write("g", "a", '{"x":1}')).toEqual({ ok: true, bytes: 42 });
    expect(calls).toEqual([
      {
        url: "/api/engine/saves/p1/a",
        method: "PUT",
        credentials: "same-origin",
        body: '{"x":1}',
      },
    ]);
  });

  it("passes a refusal's code, message, hint and limit through unchanged", async () => {
    const refusal = {
      code: "save-too-large",
      message: "Your saves would take 1.1 MB; the site keeps 1 MB per player.",
      hint: "Delete a save in Settings.",
      limit: "account-total",
      used: 1_100_000,
      max: 1_048_576,
    };
    const store = siteSaveStore("p1", { fetch: fakeFetch(() => json(refusal, 413)).fetch });
    const result = await store.write("g", "a", "{}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe("save-too-large");
    expect(result.issue.message).toBe(refusal.message);
    expect(result.issue.hint).toBe(refusal.hint);
    expect(result.issue.detail).toEqual({
      limit: "account-total",
      used: 1_100_000,
      max: 1_048_576,
    });
  });

  it("keeps a signed-out refusal as save-forbidden with the API's words", async () => {
    const body = saveSignedOut();
    const store = siteSaveStore("p1", { fetch: fakeFetch(() => json(body, 401)).fetch });
    const result = await store.write("g", "a", "{}");
    expect(result).toMatchObject({
      ok: false,
      issue: { code: "save-forbidden", message: body.message },
    });
  });

  it("reads a code the engine doesn't know as save-store-failed, its message kept", async () => {
    const store = siteSaveStore("p1", {
      fetch: fakeFetch(() => json({ code: "not-found", message: "Not found." }, 404)).fetch,
    });
    expect(await store.write("g", "a", "{}")).toMatchObject({
      ok: false,
      issue: { code: "save-store-failed", message: "Not found." },
    });
  });

  it("reads a refusal without the API's body as save-store-failed", async () => {
    const store = siteSaveStore("p1", {
      fetch: fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 502 })).fetch,
    });
    expect(await store.write("g", "a", "{}")).toMatchObject({
      ok: false,
      issue: { code: "save-store-failed", message: SAVE_FAILED_MESSAGE },
    });
  });

  it("reads a network failure as save-store-failed", async () => {
    const store = siteSaveStore("p1", {
      fetch: fakeFetch(() => Promise.reject(new TypeError("Failed to fetch"))).fetch,
    });
    expect(await store.write("g", "a", "{}")).toMatchObject({
      ok: false,
      issue: { code: "save-store-failed", message: SAVE_UNREACHABLE_MESSAGE },
    });
  });

  it("removes with DELETE and swallows a failure", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await siteSaveStore("p1", { fetch }).remove("g", "a");
    expect(calls).toEqual([
      { url: "/api/engine/saves/p1/a", method: "DELETE", credentials: "same-origin", body: null },
    ]);
    const offline = siteSaveStore("p1", {
      fetch: fakeFetch(() => Promise.reject(new TypeError("offline"))).fetch,
    });
    await expect(offline.remove("g", "a")).resolves.toBeUndefined();
  });
});

describe("the account helpers", () => {
  const account: AccountSaves = {
    games: [
      {
        projectId: "p1",
        title: "Tactics",
        saves: [
          {
            ...summary,
            gameVersion: 1,
            releaseId: "r1",
            writtenAt: "2026-11-01T00:00:00.000Z",
            usedAt: "2026-11-02T00:00:00.000Z",
          },
        ],
      },
    ],
    usedBytes: 120,
    maxBytes: 1_048_576,
    expiryDays: 180,
  };

  it("fetchAccountSaves reads the account's list", async () => {
    const { fetch, calls } = fakeFetch(() => json(account));
    expect(await fetchAccountSaves({ fetch })).toEqual(account);
    expect(calls).toEqual([
      { url: "/api/engine/saves", method: "GET", credentials: "same-origin", body: null },
    ]);
  });

  it("fetchAccountSaves throws the API's refusal", async () => {
    const body = saveSignedOut();
    const error = await fetchAccountSaves({
      fetch: fakeFetch(() => json(body, 401)).fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReleaseError);
    expect((error as ReleaseError).status).toBe(401);
    expect((error as ReleaseError).body).toEqual(body);
    expect((error as ReleaseError).message).toBe(body.message);
  });

  it("fetchSaveText reads a slot's text, null for an empty slot, and throws a refusal", async () => {
    const texts = fakeFetch((call) =>
      call.url.endsWith("/a")
        ? new Response('{"kind":"save"}')
        : json({ code: "not-found", message: "There is no save in this slot." }, 404),
    );
    expect(await fetchSaveText("p1", "a", { fetch: texts.fetch })).toBe('{"kind":"save"}');
    expect(await fetchSaveText("p1", "b", { fetch: texts.fetch })).toBeNull();
    const limited = {
      code: "save-store-failed",
      message: "You're opening saves very often. Try again in a few minutes.",
    };
    await expect(
      fetchSaveText("p1", "a", { fetch: fakeFetch(() => json(limited, 429)).fetch }),
    ).rejects.toMatchObject({ status: 429, body: limited });
  });

  it("deleteAccountSave deletes one slot and throws a refusal", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await deleteAccountSave("p 1", "a", { fetch });
    expect(calls).toEqual([
      {
        url: "/api/engine/saves/p%201/a",
        method: "DELETE",
        credentials: "same-origin",
        body: null,
      },
    ]);
    await expect(
      deleteAccountSave("p1", "a", {
        fetch: fakeFetch(() => new Response("oops", { status: 500 })).fetch,
      }),
    ).rejects.toMatchObject({
      status: 500,
      body: { code: "save-store-failed", message: SAVE_FAILED_MESSAGE },
    });
  });

  it("uses the page's fetch when none is given", async () => {
    const { fetch, calls } = fakeFetch(() => json(account));
    const original = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      await fetchAccountSaves();
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toHaveLength(1);
  });
});

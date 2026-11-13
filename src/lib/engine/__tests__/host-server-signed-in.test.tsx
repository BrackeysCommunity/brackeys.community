// @vitest-environment jsdom
import type { SaveLimits, SaveSummary } from "@jams/engine";
import { channelSaveStore } from "@jams/engine/standalone";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HOST_NO_SITE_SAVES_HINT,
  HOST_NO_SITE_SAVES_MESSAGE,
  type HostServerOptions,
  type SaveMode,
} from "../host-server";
import { SITE_SAVE_LIMITS } from "../limits";
import {
  localPlaySaves,
  SIGNED_IN_SAVES_DESCRIBE,
  SIGNED_OUT_SAVES_DESCRIBE,
} from "../local-saves";
import { apiErrorResponse, type ReleaseApiError } from "../release-errors";
import { engineProjectSavesPath, engineSavePath } from "../route-paths";
import { saveAccountFull, saveNotSite, saveWritesRateLimited } from "../save-api";
import { siteSaveStore } from "../save-store";
import {
  disposeHostRigs,
  hostRig as rig,
  refusal,
  RIG_RELEASE as RELEASE,
  rigSaveText as saveText,
} from "./host-rig";

const PLAYER = { signedIn: true, name: "Ada" };

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

/**
 * The save API for one project, as the routes answer it: `list`, and one
 * slot's read, write and delete. `refuse` answers the next write with an
 * error body instead; `limits` and `mode` are what the list reports.
 */
function fakeApi() {
  const texts = new Map<string, string>();
  const api = {
    calls: [] as { method: string; path: string; credentials?: RequestCredentials }[],
    limits: { ...SITE_SAVE_LIMITS } as SaveLimits,
    mode: "site" as SaveMode,
    refuse: null as { body: ReleaseApiError; status?: number } | null,
    texts,
    /** The site store for this project over this API. */
    store: () => siteSaveStore(RELEASE.projectId, { fetch: api.fetch as unknown as typeof fetch }),
    fetch: vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      api.calls.push({ method, path, credentials: init.credentials });
      if (path === engineProjectSavesPath(RELEASE.projectId) && method === "GET") {
        const saves: SaveSummary[] = [...texts].map(([slot, text]) => ({
          slot,
          meta: { scene: "one", savedAt: 0, playTicks: 0 },
          bytes: bytesOf(text),
        }));
        return Response.json({
          saves,
          limits: api.limits,
          describe: SIGNED_IN_SAVES_DESCRIBE,
          mode: api.mode,
        });
      }
      const prefix = engineSavePath(RELEASE.projectId, "");
      const slot = path.startsWith(prefix) ? decodeURIComponent(path.slice(prefix.length)) : "";
      if (!slot) return apiErrorResponse({ code: "not-found", message: "Not found." }, 404);
      if (method === "PUT") {
        if (api.refuse) {
          const { body, status } = api.refuse;
          api.refuse = null;
          return apiErrorResponse(body, status);
        }
        const text = init.body as string;
        texts.set(slot, text);
        return Response.json({ bytes: bytesOf(text) });
      }
      if (method === "DELETE") {
        texts.delete(slot);
        return new Response(null, { status: 204 });
      }
      const text = texts.get(slot);
      return text === undefined
        ? apiErrorResponse({ code: "not-found", message: "There is no save in this slot." }, 404)
        : new Response(text, { headers: { "content-type": "application/json; charset=utf-8" } });
    }),
  };
  return api;
}

/** A signed-in play page: the site store over the fake API, as the page builds it after sign-in reloads it. */
function signedIn(api: ReturnType<typeof fakeApi>, mode: HostServerOptions["mode"] = "site") {
  const store = api.store();
  return rig({
    saves: () => store,
    describe: () => store.describe,
    mode,
    player: () => PLAYER,
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  disposeHostRigs();
  vi.restoreAllMocks();
});

describe("signed in, the host serves saves from the save API", () => {
  it("welcomes the frame with the player and the signed-in save menu", async () => {
    const channel = await signedIn(fakeApi()).connect();
    expect(channel.welcome.player).toEqual(PLAYER);
    expect(channel.welcome.saves).toEqual({
      describe: SIGNED_IN_SAVES_DESCRIBE,
      limits: SITE_SAVE_LIMITS,
      mode: "site",
    });
  });

  it("writes, reads, lists and removes through the API, not this browser", async () => {
    const api = fakeApi();
    const channel = await signedIn(api).connect();
    const text = saveText("slot-1");
    const written = await channel.request("saves.write", {
      gameId: "tactics",
      slot: "slot-1",
      text,
    });
    expect(written).toEqual({ ok: true, bytes: bytesOf(text) });
    expect(api.texts.get("slot-1")).toBe(text);
    expect(api.calls).toContainEqual({
      method: "PUT",
      path: engineSavePath(RELEASE.projectId, "slot-1"),
      credentials: "same-origin",
    });
    expect(await channel.request("saves.read", { gameId: "tactics", slot: "slot-1" })).toBe(text);
    const listed = await channel.request("saves.list", { gameId: "tactics" });
    expect(listed.map((s) => s.slot)).toEqual(["slot-1"]);
    await channel.request("saves.remove", { gameId: "tactics", slot: "slot-1" });
    expect(api.texts.has("slot-1")).toBe(false);
    expect(api.calls.map((c) => c.method)).toContain("DELETE");
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it.each([
    ["the account total", saveAccountFull(1_048_000), 413],
    ["the hourly rate", saveWritesRateLimited(), 429],
    ["a game that saves elsewhere", saveNotSite(), 403],
  ])("hands %s refusal to the game in the API's words", async (_name, body, status) => {
    const api = fakeApi();
    const channel = await signedIn(api).connect();
    api.refuse = { body, status };
    const store = channelSaveStore(channel);
    const result = await store.write("tactics", "a", saveText("a"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe(body.code);
      expect(result.issue.message).toBe(body.message);
      if (body.hint !== undefined) expect(result.issue.hint).toBe(body.hint);
    }
  });

  it("refuses an oversized save with the site's message before it reaches the API", async () => {
    const api = fakeApi();
    const channel = await signedIn(api).connect();
    const base = saveText("a", "");
    const text = saveText("a", "x".repeat(33 * 1024 - bytesOf(base)));
    const result = await channel.request("saves.write", { gameId: "tactics", slot: "a", text });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("save-too-large");
      expect(result.issue.message).toBe(
        "This save is 33 KB; saves on jams.team are limited to 32 KB.",
      );
    }
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("saves.changed", () => {
  it("tells the frame its saves moved to the account, with the account's describe and limits", async () => {
    const api = fakeApi();
    let store = localPlaySaves(RELEASE.projectId);
    const r = rig({ saves: () => store, describe: () => store.describe, mode: "site" });
    const channel = await r.connect();
    const frameStore = channelSaveStore(channel);
    expect(frameStore.describe).toBe(SIGNED_OUT_SAVES_DESCRIBE);
    expect(frameStore.limits).toEqual(SITE_SAVE_LIMITS);

    store = api.store();
    api.limits = { maxBytes: 16 * 1024, maxSlots: 2 };
    await store.list(RELEASE.gameId);
    const seen = vi.fn();
    channel.on("saves.changed", seen);
    r.server.notifySavesChanged();
    const next = { describe: SIGNED_IN_SAVES_DESCRIBE, limits: api.limits, mode: "site" };
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(next));
    expect(frameStore.describe).toBe(SIGNED_IN_SAVES_DESCRIBE);
    expect(frameStore.limits).toEqual(api.limits);

    const written = await frameStore.write("tactics", "a", saveText("a"));
    expect(written.ok).toBe(true);
    expect(api.texts.has("a")).toBe(true);
  });

  it("never reports limits above the site's", async () => {
    const api = fakeApi();
    api.limits = { maxBytes: 1024 * 1024, maxSlots: 99 };
    const store = api.store();
    await store.list(RELEASE.gameId);
    const channel = await rig({
      saves: () => store,
      describe: () => store.describe,
      mode: "site",
    }).connect();
    expect(channel.welcome.saves.limits).toEqual(SITE_SAVE_LIMITS);
  });

  it("carries a mode change, and site writes stop", async () => {
    const api = fakeApi();
    let mode: SaveMode = "site";
    const store = api.store();
    const r = rig({ saves: () => store, describe: () => store.describe, mode: () => mode });
    const channel = await r.connect();
    const seen = vi.fn();
    channel.on("saves.changed", seen);
    mode = "none";
    r.server.notifySavesChanged();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(expect.objectContaining({ mode })));
    const issue = await refusal(
      channel.request("saves.write", { gameId: "tactics", slot: "a", text: saveText("a") }),
    );
    expect(issue.code).toBe("save-forbidden");
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("a game that doesn't save to the site", () => {
  it.each(["own", "none"] as const)(
    "refuses %s mode's writes with save-forbidden and never calls the API",
    async (mode) => {
      const api = fakeApi();
      const channel = await signedIn(api, mode).connect();
      expect(channel.welcome.saves.mode).toBe(mode);
      const issue = await refusal(
        channel.request("saves.write", { gameId: "tactics", slot: "a", text: saveText("a") }),
      );
      expect(issue.code).toBe("save-forbidden");
      expect(issue.message).toBe(HOST_NO_SITE_SAVES_MESSAGE);
      expect(issue.hint).toBe(HOST_NO_SITE_SAVES_HINT);
      expect(issue.message).toBe(saveNotSite().message);
      expect(issue.hint).toBe(saveNotSite().hint);

      const game = await channelSaveStore(channel).write("tactics", "a", saveText("a"));
      expect(game.ok).toBe(false);
      if (!game.ok) expect(game.issue).toEqual(issue);

      expect(await channel.request("saves.list", { gameId: "tactics" })).toEqual([]);
      expect(await channel.request("saves.read", { gameId: "tactics", slot: "a" })).toBeNull();
      expect(api.fetch).not.toHaveBeenCalled();
    },
  );
});

import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { engineGamesAllowed } from "../guard";
import { assertEngineGames, engineGamesOpen } from "../guard-server";

const state = vi.hoisted(() => ({
  env: { VITE_DEPLOY_ENV: "staging" as "production" | "staging" | "development" | undefined },
  flag: vi.fn(async (_flag: string, _id: string) => true),
}));

vi.mock("@/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/env")>()),
  env: state.env,
}));
vi.mock("@/lib/posthog-server", () => ({
  ANONYMOUS_FLAG_DISTINCT_ID: "anonymous",
  isServerFlagEnabled: state.flag,
}));

beforeEach(() => {
  state.env.VITE_DEPLOY_ENV = "staging";
  state.flag.mockReset();
  state.flag.mockResolvedValue(true);
});

describe("engineGamesAllowed", () => {
  it("refuses production and allows staging and development", () => {
    state.env.VITE_DEPLOY_ENV = "production";
    expect(engineGamesAllowed()).toBe(false);
    state.env.VITE_DEPLOY_ENV = "staging";
    expect(engineGamesAllowed()).toBe(true);
    state.env.VITE_DEPLOY_ENV = "development";
    expect(engineGamesAllowed()).toBe(true);
  });
});

describe("assertEngineGames", () => {
  it("refuses on production even with the flag on, without asking for the flag", async () => {
    state.env.VITE_DEPLOY_ENV = "production";
    await expect(assertEngineGames({ userId: "u1" })).rejects.toBeInstanceOf(ORPCError);
    await expect(assertEngineGames({ userId: "u1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.flag).not.toHaveBeenCalled();
    expect(await engineGamesOpen("u1")).toBe(false);
  });

  it("refuses on staging while the caller's flag is off", async () => {
    state.flag.mockResolvedValue(false);
    await expect(assertEngineGames({ userId: "u1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.flag).toHaveBeenCalledWith("engine-games-enabled", "u1");
    expect(await engineGamesOpen("u1")).toBe(false);
  });

  it("passes on staging and development with the caller's flag on", async () => {
    await expect(assertEngineGames({ userId: "u1" })).resolves.toBeUndefined();
    state.env.VITE_DEPLOY_ENV = "development";
    await expect(assertEngineGames({ userId: "u1" })).resolves.toBeUndefined();
    expect(await engineGamesOpen("u1")).toBe(true);
  });

  it("asks for a signed-out caller's flag under the anonymous id", async () => {
    await assertEngineGames({ userId: null });
    expect(state.flag).toHaveBeenCalledWith("engine-games-enabled", "anonymous");
  });
});

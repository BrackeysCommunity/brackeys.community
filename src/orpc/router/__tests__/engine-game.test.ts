import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getGamePage, getGamePlay, reportGame } from "@/orpc/router/engine-game";
import { asUser } from "@/test/orpc";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
  syncDiscordProfile: async () => ({ guildRolesSynced: false }),
}));
vi.mock("@/lib/staff-roles", () => ({
  resolveUserRoles: async (userId: string) => (userId === "staff" ? ["Staff"] : []),
}));
const state = vi.hoisted(() => ({ open: true, calls: [] as string[] }));
vi.mock("@/lib/engine/guard-server", async () => {
  const { ORPCError: Refusal } = await import("@orpc/client");
  return {
    assertEngineGames: async () => {
      if (!state.open) throw new Refusal("NOT_FOUND", { message: "Not found." });
    },
  };
});
vi.mock("@/lib/engine/viewer", () => ({ viewerOf: async (userId: string) => ({ userId }) }));
vi.mock("@/lib/engine/game-play", () => ({
  resolvePlay: async () => {
    state.calls.push("play");
    return { ok: true, play: { frame: "f" } };
  },
}));
vi.mock("@/lib/engine/game-page", () => ({
  gamePage: async () => {
    state.calls.push("page");
    return { title: "t" };
  },
}));
vi.mock("@/lib/engine/release-moderation", () => ({
  reportGame: async () => {
    state.calls.push("report");
    return { ok: true };
  },
}));

const PLAY = { projectId: "kitchen", version: "latest" };

async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ORPCError) return error.code;
    throw error;
  }
  return "OK";
}

beforeEach(() => {
  state.open = true;
  state.calls.length = 0;
});

describe("hosted game procedures are staff only", () => {
  it("answers a staff caller", async () => {
    await expect(call(getGamePlay, PLAY, asUser("staff"))).resolves.toEqual({ frame: "f" });
    await expect(call(getGamePage, { projectId: "kitchen" }, asUser("staff"))).resolves.toEqual({
      title: "t",
    });
    await expect(
      call(reportGame, { projectId: "kitchen", reason: "broken" }, asUser("staff")),
    ).resolves.toEqual({ ok: true });
    expect(state.calls).toEqual(["play", "page", "report"]);
  });

  it("reads as not found to signed-out and non-staff viewers of the play and game pages", async () => {
    for (const viewer of [null, "member"]) {
      expect(await codeOf(call(getGamePlay, PLAY, asUser(viewer)))).toBe("NOT_FOUND");
      expect(await codeOf(call(getGamePage, { projectId: "kitchen" }, asUser(viewer)))).toBe(
        "NOT_FOUND",
      );
    }
    expect(state.calls).toEqual([]);
  });

  it("refuses a report from anyone but staff", async () => {
    const input = { projectId: "kitchen", reason: "broken" };
    expect(await codeOf(call(reportGame, input, asUser(null)))).toBe("UNAUTHORIZED");
    expect(await codeOf(call(reportGame, input, asUser("member")))).toBe("FORBIDDEN");
    expect(state.calls).toEqual([]);
  });

  it("stays closed to staff while the flag or the guard is off", async () => {
    state.open = false;
    expect(await codeOf(call(getGamePlay, PLAY, asUser("staff")))).toBe("NOT_FOUND");
    expect(state.calls).toEqual([]);
  });
});

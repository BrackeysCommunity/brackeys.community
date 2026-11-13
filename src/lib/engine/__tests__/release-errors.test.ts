import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";

import { formatCount } from "@/lib/format-bytes";

import {
  LIVE_LIMITS,
  MIN_HOSTED_ENGINE,
  RELEASE_FILE_PUTS_PER_HOUR,
  UPLOAD_SESSION_HOURS,
} from "../limits";
import { breakerReason } from "../live-outcomes";
import {
  apiErrorResponse,
  liveBlocked,
  orpcRefusals,
  RELEASE_ERROR_CODES,
  ReleaseError,
  releaseEngineOld,
  releaseFilesMissing,
  releaseNotCanonical,
  releaseProjectMismatch,
  releaseRateLimited,
  releaseRemoved,
  releaseUploadExpired,
  toOrpcError,
} from "../release-errors";

describe("release errors", () => {
  it("send one body over HTTP and oRPC, with the code's status", async () => {
    const err = new ReleaseError(releaseEngineOld("0.14.0"));
    const response = apiErrorResponse(err);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual(err.body);
    const orpc = toOrpcError(err);
    expect(orpc).toBeInstanceOf(ORPCError);
    expect(orpc.status).toBe(422);
    expect(orpc.message).toBe(err.body.message);
    expect(orpc.data).toEqual(body);
  });

  it("give an engine issue code a 400 and a quota a 413", () => {
    expect(apiErrorResponse({ code: "hash-mismatch", message: "x" }).status).toBe(400);
    expect(toOrpcError({ code: "quota-exceeded", message: "x" }).status).toBe(413);
  });

  it("format their numbers from limits.ts", () => {
    expect(releaseEngineOld("0.14.0").message).toContain(`${MIN_HOSTED_ENGINE} or newer`);
    expect(releaseUploadExpired().message).toContain(`${UPLOAD_SESSION_HOURS} hours`);
    expect(releaseRateLimited("files").message).toContain(formatCount(RELEASE_FILE_PUTS_PER_HOUR));
    expect(releaseFilesMissing(1).message).toBe("1 file of this upload hasn't arrived yet.");
  });

  it("word a scene version's refusals with the release's codes", () => {
    expect(releaseRateLimited("scene-begins")).toEqual({
      code: "release-rate-limited",
      message: `You've started ${formatCount(LIVE_LIMITS.beginsPerHour)} scene publishes this hour, the most per hour.`,
      hint: "Wait a few minutes, then publish again.",
    });
    expect(releaseNotCanonical("scene-version")).toMatchObject({
      code: "release-not-canonical",
      message: expect.stringContaining("This scene-version.json isn't the text"),
    });
    expect(releaseNotCanonical().message).toContain("This release.json isn't the text");
    expect(releaseProjectMismatch("project", "kitchen", "lanes", "scene-version").message).toBe(
      'This scene version is of the project "lanes", not "kitchen".',
    );
    expect(releaseProjectMismatch("game", "kitchen", "lanes", "scene-version").message).toBe(
      'This scene version is for the game "lanes"; the project "kitchen" hosts another game.',
    );
    expect(releaseProjectMismatch("project", "kitchen", "lanes").message).toBe(
      'This build is of the project "lanes", not "kitchen".',
    );
  });

  it("word the breaker's block with the sentence the block reason stores", () => {
    expect(liveBlocked({ scene: "level-1", number: 4 }, { failed: 5, total: 12 }).message).toBe(
      `level-1@4 is blocked: ${breakerReason(5, 12)}.`,
    );
  });

  it("say why a scene version is blocked, and go out as a conflict", () => {
    const breaker = liveBlocked({ scene: "level-1", number: 4 }, { failed: 5, total: 12 });
    expect(breaker).toEqual({
      code: "live-blocked",
      message: "level-1@4 is blocked: 5 of 12 players' games failed after this update.",
      hint: "Unblock it in the editor's Publish panel (the game's page links to it), or publish a fixed version.",
    });
    expect(
      liveBlocked({ scene: "level-1", number: 1200 }, { failed: 1500, total: 2000 }).message,
    ).toBe(
      `level-1@${formatCount(1200)} is blocked: ${formatCount(1500)} of ${formatCount(2000)} players' games failed after this update.`,
    );
    expect(
      liveBlocked({ scene: "level-1", number: 4 }, { reason: "Softlocks at the ford" }).message,
    ).toBe("level-1@4 is blocked: Softlocks at the ford");
    expect(liveBlocked({ scene: "level-1", number: 4 }, { reason: null }).message).toBe(
      "level-1@4 is blocked.",
    );
    expect(RELEASE_ERROR_CODES).toContain("live-blocked");
    expect(apiErrorResponse(breaker).status).toBe(409);
    expect(toOrpcError(breaker).code).toBe("CONFLICT");
  });

  it("date a removed release in UTC", () => {
    // 23:30 on 2 Dec in UTC is 3 Dec east of it: the message says 2 Dec everywhere.
    expect(releaseRemoved(2, new Date("2026-12-02T23:30:00Z")).message).toBe(
      "v2 was removed on 2 Dec 2026; its files are gone.",
    );
  });

  it("turn a ReleaseError into the oRPC answer and let others through", async () => {
    await expect(
      orpcRefusals(async () => {
        throw new ReleaseError(releaseUploadExpired());
      }),
    ).rejects.toMatchObject({ status: 410, data: { code: "release-upload-expired" } });
    await expect(
      orpcRefusals(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

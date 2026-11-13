import type { LivePublishProgress } from "@jams/engine/editor-ui";
import { ORPCError } from "@orpc/client";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  editorLiveHost,
  liveBlockedText,
  liveRemovalText,
  liveUsageText,
  liveWording,
  PublishHostError,
  type LiveRpc,
  type SendText,
} from "../editor-live-host";
import { LIVE_LIMITS, QUOTA_WARN_RATIO } from "../limits";
import { usageLevel } from "../quota";
import { engineReleaseFilePath } from "../route-paths";

const KB = 1024;
const MB = 1_048_576;
const VERSION_ID = "aa".repeat(32);
const SCENE_HASH = "bb".repeat(32);
const PREFAB_HASH = "cc".repeat(32);
const HELD_HASH = "dd".repeat(32);

const texts = {
  [SCENE_HASH]: '{"scene":true}',
  [PREFAB_HASH]: '{"prefab":true}',
  [HELD_HASH]: '{"held":true}',
};

function fakeRpc(calls: string[], patch: Partial<Record<keyof LiveRpc, unknown>> = {}) {
  const track =
    <A extends unknown[], R>(name: string, run: (...args: A) => R) =>
    (...args: A) => {
      calls.push(name);
      return run(...args);
    };
  const rpc = {
    beginSceneVersion: vi.fn(
      track("begin", async () => ({
        uploadId: "up-1",
        versionId: VERSION_ID,
        number: null,
        missing: [
          { sha256: SCENE_HASH, bytes: 14 },
          { sha256: PREFAB_HASH, bytes: 15 },
        ],
        issues: [],
        usage: { before: [], after: [] },
      })),
    ),
    commitSceneVersion: vi.fn(
      track("commit", async () => ({
        versionId: VERSION_ID,
        scene: "level-1",
        number: 4,
        created: true,
        liveOn: "preview" as const,
      })),
    ),
    promoteSceneVersion: vi.fn(
      track("promote", async (input: { number: number }) => ({
        from: 3,
        to: input.number,
        timing: "now" as const,
      })),
    ),
    rollbackSceneVersion: vi.fn(track("rollback", async () => ({ from: 4, to: 3 }))),
    clearSceneVersion: vi.fn(track("clear", async () => ({ from: 4 }))),
    listSceneVersions: vi.fn(track("list", async () => [])),
    getLiveBase: vi.fn(
      track("base", async () => ({
        channel: "preview" as const,
        release: { id: "ee".repeat(32), version: 7, manifest: "{}" },
        live: {
          number: 3,
          versionId: VERSION_ID,
          timing: "boundary" as const,
          since: new Date("2026-11-12T09:30:00Z"),
          descriptor: "{}",
        },
        texts: { [SCENE_HASH]: texts[SCENE_HASH] },
        latest: 3,
      })),
    ),
    unblockSceneVersion: vi.fn(track("unblock", async () => null)),
    getProjectUsage: vi.fn(
      track("usage", async () => ({
        usage: { liveToday: 6, liveVersions: { kept: 12, bytes: 409_600 } },
        lines: [],
      })),
    ),
    ...patch,
  };
  return rpc as typeof rpc & LiveRpc;
}

function fakeFetch(
  calls: string[],
  respond: (url: string) => Response = () => new Response(null, { status: 204 }),
) {
  return vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`put ${url.split("/").pop()?.slice(0, 2)}`);
    expect(init.method).toBe("PUT");
    return respond(url);
  });
}

const hostOver = (rpc: LiveRpc, send: SendText, publisher?: boolean) =>
  editorLiveHost({
    project: "demo",
    rpc: () => Promise.resolve(rpc),
    fetch: send,
    ...(publisher !== undefined ? { publisher } : {}),
  });

describe("publishing a scene version", () => {
  it("begins, uploads each missing text, then commits, with progress", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls);
    const send = fakeFetch(calls);
    const progress: LivePublishProgress[] = [];
    const published = await hostOver(rpc, send).publish(
      "{version}",
      texts,
      { channel: "preview", timing: "boundary", note: "Moved the start" },
      (p) => progress.push(p),
    );
    expect(calls).toEqual(["begin", "put bb", "put cc", "commit"]);
    expect(rpc.beginSceneVersion).toHaveBeenCalledWith({
      projectId: "demo",
      version: "{version}",
      channel: "preview",
      timing: "boundary",
      note: "Moved the start",
    });
    expect(rpc.commitSceneVersion).toHaveBeenCalledWith({ uploadId: "up-1" });
    expect(progress).toEqual([
      { step: "begin" },
      { step: "upload", sent: 0, total: 29 },
      { step: "upload", sent: 14, total: 29 },
      { step: "upload", sent: 29, total: 29 },
      { step: "commit" },
    ]);
    expect(published).toEqual({
      versionId: VERSION_ID,
      scene: "level-1",
      number: 4,
      created: true,
      channel: "preview",
    });
  });

  it("uploads only the texts the site is missing, each to its release file route", async () => {
    const calls: string[] = [];
    const send = fakeFetch(calls);
    await hostOver(fakeRpc(calls), send).publish("{version}", texts, {
      channel: "preview",
      timing: "next-load",
    });
    expect(send.mock.calls.map(([url, init]) => [url, init.body])).toEqual([
      [engineReleaseFilePath("up-1", SCENE_HASH), texts[SCENE_HASH]],
      [engineReleaseFilePath("up-1", PREFAB_HASH), texts[PREFAB_HASH]],
    ]);

    const none: string[] = [];
    const held = fakeRpc(none, {
      beginSceneVersion: vi.fn(async () => ({
        uploadId: "up-2",
        versionId: VERSION_ID,
        number: 4,
        missing: [],
        issues: [],
        usage: { before: [], after: [] },
      })),
    });
    const quiet = fakeFetch(none);
    await hostOver(held, quiet).publish("{version}", texts, {
      channel: "preview",
      timing: "next-load",
    });
    expect(quiet).not.toHaveBeenCalled();
  });

  it("promotes to production after the commit, leaving preview where it is", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls, {
      commitSceneVersion: vi.fn(async () => {
        calls.push("commit");
        return { versionId: VERSION_ID, scene: "level-1", number: 4, created: true, liveOn: null };
      }),
    });
    const progress: LivePublishProgress[] = [];
    const published = await hostOver(rpc, fakeFetch(calls)).publish(
      "{version}",
      texts,
      { channel: "production", timing: "now" },
      (p) => progress.push(p),
    );
    expect(calls).toEqual(["begin", "put bb", "put cc", "commit", "promote"]);
    expect(rpc.beginSceneVersion).toHaveBeenCalledWith({
      projectId: "demo",
      version: "{version}",
      channel: "none",
    });
    expect(rpc.promoteSceneVersion).toHaveBeenCalledWith({
      projectId: "demo",
      scene: "level-1",
      number: 4,
      channel: "production",
      timing: "now",
    });
    expect(progress.at(-1)).toEqual({ step: "promote" });
    expect(published.channel).toBe("production");
  });

  it("hands a refusal's code, message and hint to the caller, and stops there", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls, {
      beginSceneVersion: vi.fn(async () => {
        throw new ORPCError("FORBIDDEN", {
          status: 403,
          message: "This project has published 100 scene versions today, the most per day.",
          data: {
            code: "quota-exceeded",
            message: "This project has published 100 scene versions today, the most per day.",
            hint: "Try again after midnight UTC, or publish a release.",
          },
        });
      }),
    });
    const refused = await hostOver(rpc, fakeFetch(calls))
      .publish("{version}", texts, { channel: "preview", timing: "next-load" })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PublishHostError);
    expect(refused).toMatchObject({
      code: "quota-exceeded",
      message: "This project has published 100 scene versions today, the most per day.",
      hint: "Try again after midnight UTC, or publish a release.",
    });
    expect(rpc.commitSceneVersion).not.toHaveBeenCalled();
  });

  it("reads a refused upload's JSON error, and never commits after it", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls);
    const send = fakeFetch(calls, () =>
      Response.json(
        {
          code: "release-hash-mismatch",
          message: "This file's bytes don't hash to its name.",
          hint: "Build the version again.",
        },
        { status: 400 },
      ),
    );
    await expect(
      hostOver(rpc, send).publish("{version}", texts, { channel: "preview", timing: "next-load" }),
    ).rejects.toMatchObject({
      name: "PublishHostError",
      code: "release-hash-mismatch",
      message: "This file's bytes don't hash to its name.",
      hint: "Build the version again.",
    });
    expect(calls).toEqual(["begin", "put bb"]);
  });

  it("refuses before uploading when the site asks for a text the version doesn't carry", async () => {
    const calls: string[] = [];
    await expect(
      hostOver(fakeRpc(calls), fakeFetch(calls)).publish(
        "{version}",
        { [SCENE_HASH]: texts[SCENE_HASH] },
        { channel: "preview", timing: "next-load" },
      ),
    ).rejects.toMatchObject({ code: "live-text-missing" });
    expect(calls).toEqual(["begin", "put bb"]);
  });
});

describe("the pointers and the reads", () => {
  it("moves a scene's pointers for the project", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls);
    const host = hostOver(rpc, fakeFetch(calls));
    expect(await host.promote("level-1", 4, "production", "boundary")).toEqual({ from: 3, to: 4 });
    expect(rpc.promoteSceneVersion).toHaveBeenCalledWith({
      projectId: "demo",
      scene: "level-1",
      number: 4,
      channel: "production",
      timing: "boundary",
    });
    expect(await host.rollback("level-1", "preview")).toEqual({ from: 4, to: 3 });
    expect(rpc.rollbackSceneVersion).toHaveBeenLastCalledWith({
      projectId: "demo",
      scene: "level-1",
      channel: "preview",
    });
    await host.rollback("level-1", "preview", { to: 2, timing: "now" });
    expect(rpc.rollbackSceneVersion).toHaveBeenLastCalledWith({
      projectId: "demo",
      scene: "level-1",
      channel: "preview",
      to: 2,
      timing: "now",
    });
    expect(await host.clear("level-1", "production")).toEqual({ from: 4, to: null });
    expect(rpc.clearSceneVersion).toHaveBeenCalledWith({
      projectId: "demo",
      scene: "level-1",
      channel: "production",
    });
    await host.unblock("level-1", 4);
    expect(rpc.unblockSceneVersion).toHaveBeenCalledWith({
      projectId: "demo",
      scene: "level-1",
      number: 4,
    });
  });

  it("reads the base with its date in UTC ISO", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls);
    const base = await hostOver(rpc, fakeFetch(calls)).base("level-1", "preview");
    expect(rpc.getLiveBase).toHaveBeenCalledWith({
      projectId: "demo",
      scene: "level-1",
      channel: "preview",
    });
    expect(base.live?.since).toBe("2026-11-12T09:30:00.000Z");
    expect(base.release?.version).toBe(7);
  });

  it("lists versions with their pointers, badge, forecast and hide reason", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls, {
      listSceneVersions: vi.fn(async () => [
        {
          scene: "level-1",
          number: 4,
          id: VERSION_ID,
          createdAt: new Date("2026-11-12T09:00:00Z"),
          createdBy: "Jo",
          note: "Moved the start",
          physics: "none",
          dataBytes: 14 * KB,
          compatKey: "ff".repeat(32),
          baseReleaseId: null,
          pointers: [
            {
              channel: "preview",
              timing: "next-load",
              since: new Date("2026-11-12T09:30:00Z"),
              by: "Jo",
            },
          ],
          blocked: { at: new Date("2026-11-12T10:00:00Z"), by: "system", reason: null },
          hidden: null,
          collectedAt: null,
          reports: { ok: 7, failed: 5 },
          removalAt: null,
        },
        {
          scene: "level-1",
          number: 1,
          id: "ab".repeat(32),
          createdAt: new Date("2026-11-01T09:00:00Z"),
          createdBy: null,
          note: null,
          physics: "none",
          dataBytes: 12 * KB,
          compatKey: "ff".repeat(32),
          baseReleaseId: null,
          pointers: [],
          blocked: null,
          hidden: { at: new Date("2026-11-02T00:00:00Z"), reason: null },
          collectedAt: null,
          reports: { ok: 0, failed: 0 },
          removalAt: new Date("2026-11-30T23:30:00Z"),
        },
      ]),
    });
    const [live, old] = await hostOver(rpc, fakeFetch(calls)).list("level-1");
    expect(rpc.listSceneVersions).toHaveBeenCalledWith({ projectId: "demo", scene: "level-1" });
    expect(live).toMatchObject({
      number: 4,
      createdAt: "2026-11-12T09:00:00.000Z",
      pointers: [
        { channel: "preview", timing: "next-load", since: "2026-11-12T09:30:00.000Z", by: "Jo" },
      ],
      blocked: { by: "system", text: "Blocked: 5 of 12 players' games failed after this update." },
      removal: null,
      collected: false,
    });
    expect(old).toMatchObject({
      hidden: "Hidden by staff.",
      removal: {
        at: "2026-11-30T23:30:00.000Z",
        text: "level-1@1 will be removed on 30 Nov 2026. Point a channel at it to keep it.",
      },
    });
  });

  it("reads the live usage from the project's usage report", async () => {
    const calls: string[] = [];
    const rpc = fakeRpc(calls);
    expect(await hostOver(rpc, fakeFetch(calls)).usage()).toEqual({
      today: 6,
      versions: 12,
      bytes: 409_600,
    });
    expect(rpc.getProjectUsage).toHaveBeenCalledWith({ projectId: "demo" });
  });

  it("lets publishers move production unless told otherwise", () => {
    const calls: string[] = [];
    expect(hostOver(fakeRpc(calls), fakeFetch(calls)).role()).toEqual({ publisher: true });
    expect(hostOver(fakeRpc(calls), fakeFetch(calls), false).role()).toEqual({ publisher: false });
  });
});

describe("the live wording", () => {
  const wording = liveWording();

  it("states the note's limit and the dialog's maxima from the site's limits", () => {
    expect(wording.noteMaxChars).toBe(LIVE_LIMITS.noteChars);
    expect(wording.notePlaceholder).toBe("What changed, for your team (up to 200 characters)");
    expect(wording.dataMaxBytes).toBe(2 * MB);
    expect(wording.versionsPerDay).toBe(100);
  });

  it("writes the data and today lines at each usage level", () => {
    const at = (ratio: number, max: number) => Math.round(max * ratio);
    const levels = [0.007, QUOTA_WARN_RATIO, 1];
    expect(levels.map((r) => usageLevel(r))).toEqual(["ok", "warn", "full"]);
    expect(levels.map((r) => wording.data(at(r, wording.dataMaxBytes)))).toEqual([
      "Data: 14 KB of 2 MB",
      "Data: 1.6 MB of 2 MB",
      "Data: 2 MB of 2 MB",
    ]);
    expect(wording.data(14 * KB)).toBe("Data: 14 KB of 2 MB");
    expect([6, 80, 100].map((count) => wording.today(count))).toEqual([
      "Today: 6 of 100 versions",
      "Today: 80 of 100 versions",
      "Today: 100 of 100 versions",
    ]);
  });

  it("says what Stop does, for each timing", () => {
    expect(wording.stopConfirm({ release: 7, scene: "The ford", timing: "next-load" })).toBe(
      "Players go back to v7's version of The ford the next time the level loads.",
    );
    expect(wording.stopConfirm({ release: 7, scene: "The ford", timing: "boundary" })).toBe(
      "Players go back to v7's version of The ford at the next safe moment.",
    );
    expect(wording.stopConfirm({ release: 7, scene: "The ford", timing: "now" })).toBe(
      "Players go back to v7's version of The ford now.",
    );
  });

  it("writes the badge, the forecast in UTC and Usage's live line", () => {
    expect(
      liveBlockedText({ by: "user", reason: "Softlocks at the gate." }, { ok: 0, failed: 0 }),
    ).toBe("Blocked: Softlocks at the gate.");
    expect(liveRemovalText("level-1", 1, "2026-12-31T23:30:00Z")).toBe(
      "level-1@1 will be removed on 31 Dec 2026. Point a channel at it to keep it.",
    );
    expect(liveUsageText({ kept: 12, bytes: 409_600 })).toBe(
      "of which live scenes: 400 KB in 12 versions. Each scene keeps its 5 newest versions plus those on a channel; others go 14 days after publishing.",
    );
    expect(liveUsageText({ kept: 1, bytes: 0 })).toMatch(
      /^of which live scenes: 0 B in 1 version\./,
    );
  });
});

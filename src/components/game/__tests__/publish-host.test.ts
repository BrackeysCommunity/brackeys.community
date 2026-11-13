import { ORPCError } from "@orpc/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { PROJECT_QUOTA } from "@/lib/engine/limits";
import { usageLines } from "@/lib/engine/quota";
import type { StoredUsage } from "@/lib/engine/usage";

import {
  publishAllowed,
  PublishHostError,
  publishWording,
  releaseView,
  sitePublishHost,
  usageView,
  type SitePublishRpc,
} from "../publish-host";

const MB = 1_048_576;

const stored = (patch: Partial<StoredUsage> = {}): StoredUsage => ({
  blobBytes: 41 * MB,
  liveBlobBytes: 30 * MB,
  trashBytes: 6 * MB,
  trashAssets: 12,
  historyBytes: 5 * MB,
  docs: 212,
  docBytes: 3.1 * MB,
  releases: 7,
  keptReleases: 6,
  pinned: { channels: 2, jams: 1 },
  releaseStorageBytes: 120 * MB,
  largestRelease: { version: 7, bytes: 38 * MB },
  releasesToday: 3,
  liveVersions: { kept: 0, bytes: 0 },
  liveToday: 0,
  nextCollection: [],
  ...patch,
});

const report = (usage: StoredUsage) => ({ usage, lines: usageLines(usage) });

const summary = {
  version: 2,
  id: "ab".repeat(32),
  createdAt: new Date("2026-11-01T10:00:00Z"),
  totalBytes: 12 * MB,
  fileCount: 40,
  engineVersion: "0.14.1",
  target: "web",
  channels: ["preview" as const],
  jams: [{ jamId: 9, title: "Autumn Jam" }],
  firstPromotedAt: null,
  collectedAt: null,
  hidden: null,
  audience: "publishers" as const,
  removalAt: new Date("2026-11-30T23:30:00Z"),
  playUrl: "/games/demo/play/2",
};

function fakeRpc(patch: Partial<Record<keyof SitePublishRpc, unknown>> = {}) {
  const rpc = {
    getProjectUsage: vi.fn(async () => report(stored())),
    listReleases: vi.fn(async () => [
      { ...summary, version: 3, channels: ["production" as const] },
      summary,
    ]),
    promoteRelease: vi.fn(async () => ({ from: 1, to: 2 })),
    rollbackRelease: vi.fn(async () => ({ from: 2, to: 1 })),
    getGameSettings: vi.fn(async () => ({
      visibility: "unlisted",
      reviewPending: true,
      saveMode: "site",
      connectOrigins: ["https://api.example.test"],
      online: true,
    })),
    setGameSettings: vi.fn(async () => ({
      visibility: "unlisted",
      reviewPending: true,
      saveMode: "site",
      connectOrigins: [],
      online: false,
    })),
    ...patch,
  };
  return rpc as typeof rpc & SitePublishRpc;
}

const hostOver = (rpc: SitePublishRpc, team: string | null = "Bit Bakers") =>
  sitePublishHost({ project: "demo", team, openTokenDialog: vi.fn(), rpc });

describe("the usage rows", () => {
  it("writes each quota's line with its numbers, and the asset breakdown under asset storage", () => {
    const view = usageView(report(stored()), ["production", "preview"]);
    expect(view.lines.map((l) => [l.quota, l.text, l.detail])).toEqual([
      [
        "assetBytes",
        "Asset storage: 41 MB of 256 MB",
        "30 MB in use · 6 MB in the trash · 5 MB replaced versions (deleted 30 days after replacement)",
      ],
      ["docs", "Documents: 212 of 1,000 · 3.1 MB of 64 MB", undefined],
      [
        "releaseStorageBytes",
        "Release storage: 120 MB of 512 MB",
        "of which live scenes: 0 B in 0 versions. Each scene keeps its 5 newest versions plus those on a channel; others go 14 days after publishing.",
      ],
      ["releaseBytes", "Largest release: v7, 38 MB of 100 MB per release", undefined],
      [
        "releasesKept",
        "Releases kept: 6 of 10 (plus pinned)",
        "Pinned: production, preview, 1 jam version",
      ],
      ["jamPins", "Jam versions: 1 of 8", undefined],
      ["releasesPerDay", "Today: 3 of 20 releases", undefined],
    ]);
    expect(view.footer).toBe(
      "These limits are per project. Cleanup runs every day: releases outside the 10 newest 14 days after publishing, replaced asset versions after 30 days. Pinned releases are never removed.",
    );
  });

  it("says under release storage what the live scenes hold", () => {
    const view = usageView(report(stored({ liveVersions: { kept: 12, bytes: 409_600 } })));
    expect(view.lines.find((l) => l.quota === "releaseStorageBytes")?.detail).toBe(
      "of which live scenes: 400 KB in 12 versions. Each scene keeps its 5 newest versions plus those on a channel; others go 14 days after publishing.",
    );
  });

  it("says nothing under the rows while every quota is ok", () => {
    const view = usageView(report(stored()));
    expect(view.lines.every((l) => l.level === "ok")).toBe(true);
    expect(view.notice).toBeNull();
  });

  it("warns from 80% of any quota", () => {
    const view = usageView(
      report(stored({ releaseStorageBytes: PROJECT_QUOTA.releaseStorageBytes * 0.8 })),
    );
    expect(view.lines.find((l) => l.quota === "releaseStorageBytes")?.level).toBe("warn");
    expect(view.notice).toEqual({
      level: "warn",
      text: "Nearly full. Releases outside the 10 newest are removed 14 days after publishing unless pinned; unpin jam versions you no longer need.",
    });
  });

  it("says full at 100%, over any quota that is only nearly full", () => {
    const view = usageView(
      report(
        stored({
          blobBytes: PROJECT_QUOTA.assetBytes * 0.9,
          releasesToday: PROJECT_QUOTA.releasesPerDay,
        }),
      ),
    );
    expect(view.lines.find((l) => l.quota === "releasesPerDay")).toMatchObject({
      text: "Today: 20 of 20 releases",
      level: "full",
      ratio: 1,
    });
    expect(view.notice).toEqual({
      level: "full",
      text: "Full. New releases are refused until releases are removed or unpinned.",
    });
  });

  it("takes the documents row's level from whichever of its two quotas is fuller", () => {
    const view = usageView(report(stored({ docBytes: PROJECT_QUOTA.docBytes })));
    expect(view.lines.find((l) => l.quota === "docs")).toMatchObject({
      level: "full",
      used: PROJECT_QUOTA.docBytes,
      max: PROJECT_QUOTA.docBytes,
    });
  });

  it("asks before emptying the trash, with its count and size, and has no trash when it's empty", () => {
    expect(usageView(report(stored())).trash).toEqual({
      assets: 12,
      bytes: 6 * MB,
      confirm: "Permanently delete 12 assets in the trash (6 MB)? This can't be undone.",
    });
    expect(usageView(report(stored({ trashAssets: 1 }))).trash?.confirm).toBe(
      "Permanently delete 1 asset in the trash (6 MB)? This can't be undone.",
    );
    expect(usageView(report(stored({ trashBytes: 0, trashAssets: 0 }))).trash).toBeNull();
  });

  it("names a release-less project's largest release, and counts pins when the channels are unknown", () => {
    const view = usageView(
      report(stored({ largestRelease: null, pinned: { channels: 1, jams: 0 } })),
    );
    expect(view.lines.find((l) => l.quota === "releaseBytes")?.text).toBe(
      "Largest release: none yet, up to 100 MB per release",
    );
    expect(view.lines.find((l) => l.quota === "releasesKept")?.detail).toBe("Pinned: 1 channel");
  });
});

describe("the publish wording", () => {
  it("writes the command for the project and every number from the site's limits", () => {
    const wording = publishWording("demo", "Bit Bakers");
    expect(wording.command).toBe("vp run scene game release create demo");
    expect(wording.visibility.team).toBe("Team: everyone on Bit Bakers can play.");
    expect(wording.saveModes.site).toBe(
      "On jams.team (players who sign in get 4 saves of 32 KB, deleted after 180 days unused)",
    );
    expect(wording.connectsTo).toBe(
      "Origins this game may contact, up to 4. They are shown on the game page.",
    );
    expect(wording.privateLinks).toBe(
      "A private or team release opens through a link that works for 12 hours.",
    );
    expect(publishWording("demo").visibility.team).toBe(
      "Team: everyone on the project's team can play.",
    );
  });

  it("dates a release's removal in UTC", () => {
    const view = releaseView(summary);
    expect(view).toMatchObject({
      version: 2,
      createdAt: "2026-11-01T10:00:00.000Z",
      bytes: 12 * MB,
      engine: "0.14.1",
      jams: ["Autumn Jam"],
      hidden: null,
      collected: false,
      removal: {
        at: "2026-11-30T23:30:00.000Z",
        text: "v2 will be removed on 30 Nov 2026. Pin it to a jam or move a channel to it to keep it.",
      },
    });
    expect(
      releaseView({
        ...summary,
        removalAt: null,
        collectedAt: "2026-12-01T00:00:00Z",
        hidden: { reason: null },
      }),
    ).toMatchObject({ removal: null, collected: true, hidden: "Hidden by staff." });
  });
});

describe("the site's publish host", () => {
  it("is absent while engine-games-enabled is off", () => {
    expect(publishAllowed(() => false)).toBe(false);
    expect(publishAllowed((name) => name === "engine-games-enabled")).toBe(true);
    expect(publishAllowed((name) => name === "engine-projects")).toBe(false);
  });

  it("reads usage and names the pinned channels from the release list", async () => {
    const rpc = fakeRpc();
    const view = await hostOver(rpc).usage();
    expect(rpc.getProjectUsage).toHaveBeenCalledWith({ projectId: "demo" });
    expect(view.lines.find((l) => l.quota === "releasesKept")?.detail).toBe(
      "Pinned: production, preview, 1 jam version",
    );
  });

  it("still shows usage when the release list fails", async () => {
    const rpc = fakeRpc({
      listReleases: vi.fn(async () => {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "down" });
      }),
    });
    const view = await hostOver(rpc).usage();
    expect(view.lines.find((l) => l.quota === "releasesKept")?.detail).toBe(
      "Pinned: 2 channels, 1 jam version",
    );
  });

  it("lists releases newest first as the site answers, and moves channels for the project", async () => {
    const rpc = fakeRpc();
    const host = hostOver(rpc);
    expect((await host.releases()).map((r) => [r.version, r.channels])).toEqual([
      [3, ["production"]],
      [2, ["preview"]],
    ]);
    expect(await host.promote(2, "production")).toEqual({ from: 1, to: 2 });
    expect(rpc.promoteRelease).toHaveBeenCalledWith({
      projectId: "demo",
      version: 2,
      channel: "production",
    });
    await host.promote(3, "production", { keepScenes: ["level-1"] });
    expect(rpc.promoteRelease).toHaveBeenLastCalledWith({
      projectId: "demo",
      version: 3,
      channel: "production",
      keepScenes: ["level-1"],
    });
    await host.rollback("production");
    expect(rpc.rollbackRelease).toHaveBeenLastCalledWith({
      projectId: "demo",
      channel: "production",
    });
    await host.rollback("preview", 1);
    expect(rpc.rollbackRelease).toHaveBeenLastCalledWith({
      projectId: "demo",
      channel: "preview",
      to: 1,
    });
  });

  it("turns an oRPC refusal into the host's error, with the site's message and hint", async () => {
    const rpc = fakeRpc({
      promoteRelease: vi.fn(async () => {
        throw new ORPCError("FORBIDDEN", {
          status: 403,
          message: "Only the game's publishers can do this.",
          data: {
            code: "release-forbidden",
            message: "Only the game's publishers can do this.",
            hint: "Publishers are the project's creator and its team's owners.",
          },
        });
      }),
    });
    const refused = await hostOver(rpc)
      .promote(2, "production")
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PublishHostError);
    expect(refused).toMatchObject({
      message: "Only the game's publishers can do this.",
      code: "release-forbidden",
      hint: "Publishers are the project's creator and its team's owners.",
    });

    const notFound = fakeRpc({
      getProjectUsage: vi.fn(async () => {
        throw new ORPCError("NOT_FOUND", { message: "Not found." });
      }),
    });
    await expect(hostOver(notFound).usage()).rejects.toMatchObject({
      name: "PublishHostError",
      message: "Not found.",
      code: "NOT_FOUND",
    });
  });

  it("reads and writes the game's settings, with the project's team", async () => {
    const rpc = fakeRpc();
    const host = hostOver(rpc);
    expect(await host.settings()).toEqual({
      visibility: "unlisted",
      reviewPending: true,
      saveMode: "site",
      connectOrigins: ["https://api.example.test"],
      online: true,
      team: "Bit Bakers",
    });
    expect(rpc.getGameSettings).toHaveBeenCalledWith({ projectId: "demo" });
    const saved = await host.setSettings({
      visibility: "public",
      connectOrigins: ["https://api.example.test"],
    });
    expect(rpc.setGameSettings).toHaveBeenCalledWith({
      projectId: "demo",
      visibility: "public",
      connectOrigins: ["https://api.example.test"],
    });
    expect(saved).toMatchObject({ reviewPending: true, team: "Bit Bakers" });
  });

  it("says when going private left old public copies at the edge, and keeps the note out of the view", async () => {
    const rpc = fakeRpc({
      setGameSettings: vi.fn(async () => ({
        visibility: "private",
        reviewPending: false,
        saveMode: "site",
        connectOrigins: [],
        online: false,
        edgeNote: "Edge purge isn't configured.",
      })),
    });
    const warning = vi.fn();
    const notify = Object.assign(vi.fn(), { success: vi.fn(), warning, error: vi.fn() });
    const host = sitePublishHost({ project: "demo", openTokenDialog: vi.fn(), rpc, notify });
    const saved = await host.setSettings({ visibility: "private" });
    expect(saved).not.toHaveProperty("edgeNote");
    expect(warning).toHaveBeenCalledWith("Old public copies may stay cached for a while", {
      description: "Edge purge isn't configured.",
    });
  });

  it("publishes live scenes for the same project whenever it publishes releases", async () => {
    const getProjectUsage = vi.fn(async () =>
      report(stored({ liveToday: 6, liveVersions: { kept: 12, bytes: 409_600 } })),
    );
    const listSceneVersions = vi.fn(async () => []);
    const rpc = fakeRpc({ getProjectUsage, listSceneVersions });
    const host = hostOver(rpc);
    expect(host.live).toBeDefined();
    expect(await host.live?.usage()).toEqual({ today: 6, versions: 12, bytes: 409_600 });
    await host.live?.list();
    expect(listSceneVersions).toHaveBeenCalledWith({ projectId: "demo" });
    expect(host.live?.role()).toEqual({ publisher: true });
    expect(host.live?.wording.versionsPerDay).toBe(100);
    expect(
      sitePublishHost({
        project: "demo",
        openTokenDialog: vi.fn(),
        rpc,
        publisher: false,
      }).live?.role(),
    ).toEqual({ publisher: false });
  });

  it("opens the site's token dialog", () => {
    const openTokenDialog = vi.fn();
    sitePublishHost({ project: "demo", openTokenDialog, rpc: fakeRpc() }).openTokenDialog();
    expect(openTokenDialog).toHaveBeenCalledOnce();
  });
});

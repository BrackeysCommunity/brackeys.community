import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_SYNC_TOKEN_PATH,
  BLOBS_PATH,
  BUNDLE_PATH,
  engineBlobPath,
  engineBundlePath,
  engineReleaseCommitPath,
  engineReleaseFilePath,
  engineReleaseMovePath,
  engineReleaseRollbackPath,
  engineReleasesPath,
  engineReleaseZipPath,
  engineLiveBasePath,
  engineLiveCommitPath,
  engineLiveMovePath,
  engineLivePath,
  engineLivePromotePath,
  engineLiveStreamPath,
  engineProjectSavesPath,
  engineSavePath,
  ENGINE_SAVES_PATH,
  gamePagePath,
  gamePlayPath,
  LIVE_BASE_PATH,
  LIVE_COMMIT_PATH,
  LIVE_MOVE_PATH,
  LIVE_PATH,
  LIVE_PROMOTE_PATH,
  PROJECT_SAVES_PATH,
  RELEASE_COMMIT_PATH,
  RELEASE_FILE_PATH,
  RELEASE_MOVE_PATH,
  RELEASE_ROLLBACK_PATH,
  RELEASE_ZIP_PATH,
  RELEASES_PATH,
  SAVE_SLOT_PATH,
  SAVES_PATH,
} from "../route-paths";

const HASH = "ab".repeat(32);

describe("engine route paths", () => {
  it("build paths the routes match, the project id encoded", () => {
    expect(BLOBS_PATH.exec(engineBlobPath("a b/c"))?.slice(1)).toEqual(["a%20b%2Fc", undefined]);
    expect(BLOBS_PATH.exec(engineBlobPath("demo", HASH))?.slice(1)).toEqual(["demo", HASH]);
    expect(BUNDLE_PATH.exec(engineBundlePath("a b"))?.[1]).toBe("a%20b");
    expect(BLOBS_PATH.test(engineBundlePath("demo"))).toBe(false);
    expect(BLOBS_PATH.test(AGENT_SYNC_TOKEN_PATH)).toBe(false);
    expect(BUNDLE_PATH.test(AGENT_SYNC_TOKEN_PATH)).toBe(false);
  });

  it("build the game's page and play paths, pinned or not, the project id encoded", () => {
    expect(gamePagePath("a b")).toBe("/games/a%20b");
    expect(gamePlayPath("a b")).toBe("/games/a%20b/play");
    expect(gamePlayPath("a b", 7)).toBe("/games/a%20b/play/7");
    expect(gamePlayPath("demo", "preview")).toBe("/games/demo/play/preview");
  });

  it("build the release paths their matchers take apart, and no other's", () => {
    expect(RELEASES_PATH.exec(engineReleasesPath("a b"))?.[1]).toBe("a%20b");
    expect(RELEASE_COMMIT_PATH.exec(engineReleaseCommitPath("demo"))?.[1]).toBe("demo");
    expect(RELEASES_PATH.test(engineReleaseCommitPath("demo"))).toBe(false);
    expect(RELEASE_MOVE_PATH.exec(engineReleaseMovePath("demo", 7, "promote"))?.slice(1)).toEqual([
      "demo",
      "7",
      "promote",
    ]);
    expect(RELEASE_MOVE_PATH.exec(engineReleaseMovePath("demo", 2, "rollback"))?.[3]).toBe(
      "rollback",
    );
    expect(RELEASE_ROLLBACK_PATH.exec(engineReleaseRollbackPath("demo"))?.[1]).toBe("demo");
    expect(RELEASE_MOVE_PATH.test(engineReleaseRollbackPath("demo"))).toBe(false);
    expect(RELEASE_FILE_PATH.exec(engineReleaseFilePath("up/1", HASH))?.slice(1)).toEqual([
      "up%2F1",
      HASH,
    ]);
    expect(RELEASE_ZIP_PATH.exec(engineReleaseZipPath(HASH))?.[1]).toBe(HASH);
    expect(RELEASE_ZIP_PATH.test(engineReleaseFilePath("u", HASH))).toBe(false);
    expect(BLOBS_PATH.test(engineReleasesPath("demo"))).toBe(false);
  });

  it("build the live paths their matchers take apart, the query aside, and no other's", () => {
    const url = (path: string) => new URL(path, "https://site.test");
    const pathOf = (path: string) => url(path).pathname;
    expect(LIVE_PATH.exec(engineLivePath("a b"))?.[1]).toBe("a%20b");
    const listed = url(engineLivePath("demo", "level 1"));
    expect(LIVE_PATH.test(listed.pathname)).toBe(true);
    expect(listed.searchParams.get("scene")).toBe("level 1");
    expect(LIVE_COMMIT_PATH.exec(engineLiveCommitPath("demo"))?.[1]).toBe("demo");
    expect(LIVE_PATH.test(engineLiveCommitPath("demo"))).toBe(false);

    const base = url(engineLiveBasePath("demo", "level/1", "production"));
    expect(LIVE_BASE_PATH.exec(base.pathname)?.slice(1)).toEqual(["demo", "level%2F1"]);
    expect(base.searchParams.get("channel")).toBe("production");
    const stream = url(engineLiveStreamPath("a b", "preview"));
    expect(stream.pathname).toBe("/api/engine/live/a%20b/stream");
    expect(stream.searchParams.get("channel")).toBe("preview");
    expect(LIVE_PROMOTE_PATH.exec(engineLivePromotePath("demo", "level-1", 4))?.slice(1)).toEqual([
      "demo",
      "level-1",
      "4",
    ]);
    expect(
      LIVE_MOVE_PATH.exec(engineLiveMovePath("demo", "level-1", "rollback"))?.slice(1),
    ).toEqual(["demo", "level-1", "rollback"]);
    expect(LIVE_MOVE_PATH.exec(engineLiveMovePath("demo", "level-1", "clear"))?.[3]).toBe("clear");

    // A scene named like a move or "commit" stays a scene.
    expect(LIVE_COMMIT_PATH.test(pathOf(engineLiveBasePath("demo", "commit", "preview")))).toBe(
      false,
    );
    expect(LIVE_MOVE_PATH.test(engineLivePromotePath("demo", "clear", 1))).toBe(false);
    expect(LIVE_PROMOTE_PATH.test(engineLiveMovePath("demo", "1", "rollback"))).toBe(false);
    for (const path of [
      engineLivePath("demo"),
      engineLiveCommitPath("demo"),
      engineLivePromotePath("demo", "level-1", 4),
    ]) {
      expect(RELEASES_PATH.test(path)).toBe(false);
      expect(RELEASE_COMMIT_PATH.test(path)).toBe(false);
      expect(RELEASE_MOVE_PATH.test(path)).toBe(false);
    }
  });

  it("build the save paths their matchers take apart, and no other's", () => {
    expect(SAVES_PATH.test(ENGINE_SAVES_PATH)).toBe(true);
    expect(PROJECT_SAVES_PATH.exec(engineProjectSavesPath("a b"))?.[1]).toBe("a%20b");
    expect(SAVE_SLOT_PATH.exec(engineSavePath("demo", "slot/1"))?.slice(1)).toEqual([
      "demo",
      "slot%2F1",
    ]);
    expect(SAVES_PATH.test(engineProjectSavesPath("demo"))).toBe(false);
    expect(PROJECT_SAVES_PATH.test(engineSavePath("demo", "auto"))).toBe(false);
    expect(SAVE_SLOT_PATH.test(engineProjectSavesPath("demo"))).toBe(false);
    expect(BLOBS_PATH.test(engineSavePath("demo", "auto"))).toBe(false);
  });
});

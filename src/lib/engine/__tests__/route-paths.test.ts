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
  RELEASE_COMMIT_PATH,
  RELEASE_FILE_PATH,
  RELEASE_MOVE_PATH,
  RELEASE_ROLLBACK_PATH,
  RELEASE_ZIP_PATH,
  RELEASES_PATH,
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
});

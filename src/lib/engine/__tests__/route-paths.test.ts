import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_SYNC_TOKEN_PATH,
  BLOBS_PATH,
  BUNDLE_PATH,
  engineBlobPath,
  engineBundlePath,
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
});

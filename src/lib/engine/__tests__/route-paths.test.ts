import { describe, expect, it } from "vite-plus/test";

import { AGENT_SYNC_TOKEN_PATH as CLI_AGENT_SYNC_TOKEN_PATH } from "../../../../scripts/scene/hosted";
import {
  AGENT_SYNC_TOKEN_PATH,
  BLOBS_PATH,
  BUNDLE_PATH,
  engineBlobPath,
  engineBundlePath,
} from "../route-paths";

const HASH = "ab".repeat(32);

describe("engine route paths", () => {
  it("are the ones the scene CLI's hosted client calls", () => {
    expect(CLI_AGENT_SYNC_TOKEN_PATH).toBe(AGENT_SYNC_TOKEN_PATH);
  });

  it("build paths the routes match, the project id encoded", () => {
    expect(BLOBS_PATH.exec(engineBlobPath("a b/c"))?.slice(1)).toEqual(["a%20b%2Fc", undefined]);
    expect(BLOBS_PATH.exec(engineBlobPath("demo", HASH))?.slice(1)).toEqual(["demo", HASH]);
    expect(BUNDLE_PATH.exec(engineBundlePath("a b"))?.[1]).toBe("a%20b");
    expect(BLOBS_PATH.test(engineBundlePath("demo"))).toBe(false);
  });
});

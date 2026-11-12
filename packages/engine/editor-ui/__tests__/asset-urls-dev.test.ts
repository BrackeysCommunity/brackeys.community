import { describe, expect, it, vi } from "vite-plus/test";

import type { BundleEntry } from "../../project/index";
import { projectBlobs } from "../connect/blobs";
import { devAssetUrl, devBlobRoute } from "../connect/dev";

const sha256 = "ab".repeat(32);
const entry: BundleEntry = { id: "sky", kind: "texture", sha256, bytes: 10 };

describe("dev asset URLs", () => {
  it("serves dev textures from the dev server's project route", () => {
    expect(devAssetUrl()("platformer", entry)).toBe(`/__project/platformer/blob/${sha256}`);
  });

  it("is a hash under the project's blob route, with the id encoded", () => {
    expect(devAssetUrl()("a b/c", entry)).toBe(`${devBlobRoute("a b/c")}/${sha256}`);
    expect(devAssetUrl()("a b/c", entry)).toContain("a%20b%2Fc");
  });

  it("loads the editor's textures from the blob route its session uploads to", async () => {
    const fetcher = vi.fn(
      async (_url: string) => new Response(new Uint8Array([1]), { status: 200 }),
    );
    await projectBlobs(devBlobRoute("p1"), fetcher as unknown as typeof fetch).read(sha256);
    expect(fetcher.mock.calls[0]?.[0]).toBe(devAssetUrl()("p1", entry));
  });
});

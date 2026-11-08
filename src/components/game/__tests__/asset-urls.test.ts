import type { BundleEntry } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import { engineBlobPath } from "@/lib/engine/route-paths";

import { hostedAssetUrl } from "../asset-urls";

const sha256 = "ab".repeat(32);
const entry: BundleEntry = { id: "sky", kind: "texture", sha256, bytes: 10 };

describe("hosted asset URLs", () => {
  it("serves textures from the site's engine route", () => {
    expect(hostedAssetUrl("p1", entry)).toBe(`/api/engine/projects/p1/blobs/${sha256}`);
  });

  it("is the hash under the project's blob route, with the id encoded", () => {
    expect(hostedAssetUrl("a b/c", entry)).toBe(engineBlobPath("a b/c", sha256));
    expect(hostedAssetUrl("a b/c", entry)).toContain("a%20b%2Fc");
  });
});

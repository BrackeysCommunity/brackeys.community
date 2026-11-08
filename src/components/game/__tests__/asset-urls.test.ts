import type { BundleEntry } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import {
  assetUrl,
  devAssetUrl,
  EDITOR_BLOB_HOST,
  editorAssetUrl,
  hostedAssetUrl,
} from "../asset-urls";
import { blobRoute } from "../project-blobs";

const sha256 = "ab".repeat(32);
const entry: BundleEntry = { id: "sky", kind: "texture", sha256, bytes: 10 };

describe("asset URLs", () => {
  it("serves dev textures from the dev server's project route", () => {
    expect(devAssetUrl("platformer", entry)).toBe(`/__project/platformer/blob/${sha256}`);
  });

  it("serves hosted textures from the site's engine route", () => {
    expect(hostedAssetUrl("p1", entry)).toBe(`/api/engine/projects/p1/blobs/${sha256}`);
  });

  it("is a hash under the project's blob route, with the id encoded", () => {
    for (const kind of ["dev", "hosted"] as const)
      expect(assetUrl(kind)("a b/c", entry)).toBe(
        `${blobRoute({ kind, project: "a b/c" })}/${sha256}`,
      );
    expect(devAssetUrl("a b/c", entry)).toContain("a%20b%2Fc");
  });

  it("loads the editor's textures from the blob route its session uploads to", () => {
    expect(EDITOR_BLOB_HOST).toBe("dev");
    expect(editorAssetUrl("p1", entry)).toBe(
      `${blobRoute({ kind: EDITOR_BLOB_HOST, project: "p1" })}/${sha256}`,
    );
  });
});

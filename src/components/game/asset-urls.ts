import type { AssetUrl } from "@jams/engine";

import { blobRoute, type BlobHost } from "./project-blobs";

/** The URL a loader fetches a bundle entry's texture from, on the blob route of `kind`. */
export function assetUrl(kind: BlobHost["kind"]): AssetUrl {
  return (project, entry) => `${blobRoute({ kind, project })}/${entry.sha256}`;
}

/** The dev server's project route: `/__project/<id>/blob/<sha256>`. */
export const devAssetUrl: AssetUrl = assetUrl("dev");

/** The site's engine route: `/api/engine/projects/<id>/blobs/<sha256>`. */
export const hostedAssetUrl: AssetUrl = assetUrl("hosted");

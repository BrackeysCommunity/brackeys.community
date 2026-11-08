import type { AssetUrl } from "@jams/engine";

import { blobRoute, type BlobHost } from "./project-blobs";

/** The URL a loader fetches a bundle entry's texture from, on the blob route of `kind`. */
export function assetUrl(kind: BlobHost["kind"]): AssetUrl {
  return (project, entry) => `${blobRoute({ kind, project })}/${entry.sha256}`;
}

const assetUrls: Record<BlobHost["kind"], AssetUrl> = {
  dev: assetUrl("dev"),
  hosted: assetUrl("hosted"),
};

/** The dev server's project route: `/__project/<id>/blob/<sha256>`. */
export const devAssetUrl: AssetUrl = assetUrls.dev;

/** The site's engine route: `/api/engine/projects/<id>/blobs/<sha256>`. */
export const hostedAssetUrl: AssetUrl = assetUrls.hosted;

/** The blob host of the editor's project session: the dev server's, the only one the editor connects to. */
export const EDITOR_BLOB_HOST = "dev" satisfies BlobHost["kind"];

/** The URL scheme textures of the editor's open project load from. */
export const editorAssetUrl: AssetUrl = assetUrls[EDITOR_BLOB_HOST];

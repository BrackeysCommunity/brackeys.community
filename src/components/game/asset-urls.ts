import type { AssetUrl } from "@jams/engine";

import { engineBlobPath } from "@/lib/engine/route-paths";

/** The site's engine route for an asset loader: `/api/engine/projects/<id>/blobs/<sha256>`. */
export const hostedAssetUrl: AssetUrl = (project, entry) => engineBlobPath(project, entry.sha256);

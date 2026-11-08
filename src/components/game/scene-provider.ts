import * as Hocuspocus from "@hocuspocus/provider";
import type { DocOrigin } from "@jams/engine/collab";
import { createKindRegistry } from "@jams/engine/project";
import type { Registry } from "@jams/engine/scene";

import { EDITOR_BLOB_HOST } from "./asset-urls";
import { blobContentStore, projectBlobs, type ProjectBlobs } from "./project-blobs";
import {
  connectProjectSession,
  hocuspocusTransport,
  type ProjectSessionLink,
} from "./use-project-session";

const transport = hocuspocusTransport(Hocuspocus);

/** The editor's project session, and the dev server's blob route for that project. */
export type EditorProjectConnection = ProjectSessionLink & { blobs: ProjectBlobs };

/**
 * The editor's project session on the dev server's collab endpoint: one
 * Hocuspocus socket for the project doc and every scene and prefab doc it
 * opens, with the dev server's blob route as its content store. Loaded with
 * the editor, so neither the provider nor `yjs` reaches a production
 * bundle. The dev server takes no tokens.
 */
export function connectEditorProject({
  project,
  registry,
  origin,
  url,
}: {
  project: string;
  /** The registry the game reads scenes with; its game's asset kinds join the engine's. */
  registry: Registry;
  /** The editor's origin: the same object its editor sessions write with, so undo tracks them. */
  origin: DocOrigin;
  url?: string;
}): EditorProjectConnection {
  const blobs = projectBlobs({ kind: EDITOR_BLOB_HOST, project });
  const link = connectProjectSession({
    project,
    host: { kind: EDITOR_BLOB_HOST, ...(url ? { url } : {}) },
    registry,
    kinds: createKindRegistry(registry.game),
    origin,
    store: blobContentStore(blobs),
    transport,
  });
  return { ...link, blobs };
}

import { buildAtFrom, COLLAB_LAYOUT_VERSION } from "@jams/engine/collab";
import {
  connectProjectSession,
  createProjectTokens,
  offConnection,
  projectBlobs,
  type CloseReason,
  type EditorHost,
  type ProjectTokens,
  type ProjectTransport,
} from "@jams/engine/editor-ui";
import { createKindRegistry, type ProjectId } from "@jams/engine/project";
import { SCENE_FORMAT_VERSION } from "@jams/engine/scene";

import { SYNC_LIMITS } from "@/lib/canvas/limits";
import { SYNC_CLOSE, syncCloseCode } from "@/lib/canvas/sync-channels";
import type { SyncAccess } from "@/lib/canvas/token";
import { engineBlobPath } from "@/lib/engine/route-paths";
import { client } from "@/orpc/client";

import { hostedAssetUrl } from "./asset-urls";

/** The flag a hosted project opens behind; while it is off the editor's connection stays "off". */
export const ENGINE_PROJECTS_FLAG = "engine-projects";

export type MintProjectToken = Parameters<typeof createProjectTokens>[1];

/** Project tokens from the site's `getProjectSyncToken`. */
export const mintWithOrpc: MintProjectToken = (request) => client.getProjectSyncToken(request);

/** What a canvas-sync close means for a doc: revoked and too large stop it, anything else retries. */
export function syncCloseReason(code: number | null, reason?: string): CloseReason {
  const sync = syncCloseCode({ code: code ?? undefined, reason });
  if (sync === SYNC_CLOSE.revoked) return "revoked";
  if (sync === SYNC_CLOSE.tooLarge) return "too-large";
  return "retry";
}

/** One project's tokens, minted over oRPC and reused for canvas-sync's token lifetime. */
export function hostedProjectTokens(
  project: ProjectId,
  opts: { access?: SyncAccess; mint?: MintProjectToken; now?: () => number } = {},
): ProjectTokens {
  return createProjectTokens(
    {
      projectId: project,
      formatVersion: SCENE_FORMAT_VERSION,
      layoutVersion: COLLAB_LAYOUT_VERSION,
      access: opts.access ?? "write",
    },
    opts.mint ?? mintWithOrpc,
    { ttlMs: SYNC_LIMITS.tokenTtlMs, ...(opts.now ? { now: opts.now } : {}) },
  );
}

const BUILD_AT = buildAtFrom(import.meta.env.VITE_BUILD_AT);

/**
 * A project hosted on jams.team: its session on canvas-sync, with a token
 * per doc open from the site's oRPC mint, and its blobs on the site's
 * engine route. While `flag("engine-projects")` is off, `connect` opens
 * nothing.
 */
export function hostedProject(opts: {
  transport: ProjectTransport;
  flag: (name: string) => boolean;
  access?: SyncAccess;
  mint?: MintProjectToken;
  buildAt?: number;
}): Pick<EditorHost, "connect" | "assetUrl"> {
  const access = opts.access ?? "write";
  return {
    assetUrl: hostedAssetUrl,
    connect({ project, registry, origin }) {
      if (!opts.flag(ENGINE_PROJECTS_FLAG)) return offConnection(access);
      const link = connectProjectSession({
        project,
        registry,
        kinds: createKindRegistry(registry.game),
        origin,
        transport: opts.transport,
        tokens: hostedProjectTokens(project, { access, ...(opts.mint ? { mint: opts.mint } : {}) }),
        access,
        closeReason: syncCloseReason,
        buildAt: opts.buildAt ?? BUILD_AT,
      });
      return { ...link, blobs: projectBlobs(engineBlobPath(project)) };
    },
  };
}

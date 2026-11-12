import {
  ENGINE_ASSET_KINDS,
  type AssetKindDef,
  type BlobKindDef,
  type KindRegistry,
} from "@jams/engine/project";

import { checkRateLimit } from "@/lib/rate-limit";

/** Engine blobs a member may upload a day: its own budget, apart from images and canvas uploads. */
export const ENGINE_BLOB_UPLOADS_PER_DAY = 500;

/** No upload is read past this, whatever its kind allows. */
export const ENGINE_BLOB_MAX_BYTES = 64 * 1024 * 1024;

/** Agent token exchanges per credential an hour: a CLI refreshes its 60 s sync token about once a minute. */
export const AGENT_SYNC_TOKENS_PER_HOUR = 600;

/** A pushed bundle's JSON, texts and sidecars only (blobs travel by hash). */
export const ENGINE_BUNDLE_MAX_BYTES = 32 * 1024 * 1024;

/** What the upload route needs from a blob kind. */
export type BlobKindLimits = Pick<BlobKindDef, "kind" | "maxBytes" | "contentTypes">;

/** The blob kinds the site accepts, by name; undefined refuses the kind. */
export type BlobKindLookup = (kind: string) => BlobKindLimits | undefined;

/** A lookup over a kind registry or a list of kinds; doc and code kinds are refused. */
export function blobKindLookup(
  kinds: KindRegistry | readonly (AssetKindDef | (BlobKindLimits & { storage: "blob" }))[],
): BlobKindLookup {
  const list = "list" in kinds ? kinds.list() : kinds;
  const blobs = new Map<string, BlobKindLimits>();
  for (const def of list) if (def.storage === "blob") blobs.set(def.kind, def);
  return (kind) => blobs.get(kind);
}

/** The blob kinds the upload route accepts: the engine's, each capped at its own `maxBytes`. */
export const ENGINE_BLOB_KINDS: BlobKindLookup = blobKindLookup(ENGINE_ASSET_KINDS);

export function engineBlobUploadAllowed(userId: string): Promise<boolean> {
  return checkRateLimit("engine-blob", userId, ENGINE_BLOB_UPLOADS_PER_DAY, 86400);
}

export function agentSyncTokenAllowed(tokenId: string): Promise<boolean> {
  return checkRateLimit("engine-agent-sync", tokenId, AGENT_SYNC_TOKENS_PER_HOUR, 3600);
}

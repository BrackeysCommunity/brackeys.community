import { itchImageId } from "../../../../src/lib/media-scan-queue.ts";

/**
 * Which path an entry scan takes (plan 24 phase 4). A revisit is one
 * request in the common case — data.json for the creator's tags and the
 * current cover id — and only turns into a full fetch-hash-score when the
 * cover actually changed. Everything that makes the stored row stale
 * (older detector, dead cover, no embedding, a different encoder, a cover
 * id the crawler already saw change) takes the full path from the start.
 */
export type ScanMode = "full" | "revisit";

export type StoredScan = {
  detectorVersion: number;
  coverStatus: string;
  coverUrl: string | null;
  hasEmbedding: boolean;
  embeddingModel: string | null;
};

export function scanMode(
  entry: { gameCoverUrl: string | null },
  scan: StoredScan | null,
  current: { detectorVersion: number; model: string },
): ScanMode {
  if (!scan) return "full";
  if (scan.detectorVersion < current.detectorVersion) return "full";
  if (scan.coverStatus !== "fetched") return "full";
  if (!scan.hasEmbedding || scan.embeddingModel !== current.model) return "full";
  if (itchImageId(scan.coverUrl) !== itchImageId(entry.gameCoverUrl)) return "full";
  return "revisit";
}

/**
 * Which cover URL to fetch first, given what entries.json stored and what
 * data.json says now (plan 24 phase 2). A replaced cover prefers the live
 * one; anything else fetches the stored derivative and keeps data.json's as
 * the fallback for a dead URL — same image, different crop.
 */
export function coverCandidates(
  storedUrl: string | null,
  currentUrl: string | null,
): { first: string | null; fallback: string | null; replaced: boolean } {
  const stored = itchImageId(storedUrl);
  const current = itchImageId(currentUrl);
  const replaced = current != null && current !== stored;
  if (replaced) return { first: currentUrl, fallback: storedUrl, replaced };
  return {
    first: storedUrl,
    fallback: currentUrl && currentUrl !== storedUrl ? currentUrl : null,
    replaced,
  };
}

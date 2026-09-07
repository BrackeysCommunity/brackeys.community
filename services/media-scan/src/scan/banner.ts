import { eq, sql } from "drizzle-orm";

import { itchJams, itchJamScans, type ScanCoverStatus } from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { fetchCover, hashCover } from "./cover.ts";
import { encodeEmbedding } from "./embedding.ts";
import { DETECTOR_VERSION, type ScanContext } from "./entry.ts";
import { NSFW_MODEL, nsfwScore } from "./nsfw.ts";

/**
 * A jam's banner (plan 24 phase 3): fetched, hashed, and scored into
 * `itch.jam_scans` — the same fingerprint the entries get, so a banner
 * exists in the corpus. No flags in v1: `social.entry_flags` is entry-keyed
 * and a banner over threshold is logged at warn level for now. No theft
 * matching either — hosts reuse banners across editions, and a corpus match
 * would flag every annual jam against itself.
 */
export async function scanBannerById(
  jamId: number,
  ctx: ScanContext,
): Promise<{ coverStatus: ScanCoverStatus; score: number | null } | "missing"> {
  const [jam] = await db
    .select({
      jamId: itchJams.jamId,
      slug: itchJams.slug,
      bannerUrl: itchJams.bannerUrl,
      missingSince: itchJams.missingSince,
    })
    .from(itchJams)
    .where(eq(itchJams.jamId, jamId))
    .limit(1);
  if (!jam || jam.missingSince) return "missing";

  const bytes = jam.bannerUrl ? await fetchCover(jam.bannerUrl) : null;
  const status: ScanCoverStatus = bytes ? "fetched" : jam.bannerUrl ? "gone" : "none";
  const phash = bytes ? await hashCover(bytes) : null;
  const nsfw = bytes && ctx.nsfwEnabled ? await nsfwScore(bytes) : null;

  const values = {
    bannerUrl: jam.bannerUrl,
    bannerStatus: status,
    bannerPhash: phash,
    nsfwScore: nsfw?.score ?? null,
    bannerEmbedding: nsfw?.embedding ? encodeEmbedding(nsfw.embedding) : null,
    embeddingModel: nsfw?.embedding ? NSFW_MODEL : null,
    detectorVersion: DETECTOR_VERSION,
    scannedAt: sql`now()`,
  };
  await db
    .insert(itchJamScans)
    .values({ jamId: jam.jamId, ...values })
    .onConflictDoUpdate({ target: itchJamScans.jamId, set: values });

  if (nsfw && nsfw.score >= config.NSFW_THRESHOLD) {
    console.warn(
      `[banner] jam ${jam.slug} (${jam.jamId}) banner scored ${nsfw.score.toFixed(3)} — no jam_flags table yet, logged only`,
    );
  }
  return { coverStatus: status, score: nsfw?.score ?? null };
}

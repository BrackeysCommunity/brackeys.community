import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  type EntryFlagKind,
  entryFlags,
  itchEntryScans,
  itchJamEntries,
  type ScanCoverStatus,
} from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { withJamLock } from "../jobs/locks.ts";
import { fetchCover, hashCover } from "./cover.ts";
import { type HashedEntry, nearMatches } from "./dhash.ts";
import { encodeEmbedding } from "./embedding.ts";
import { fetchGameData, type GameData, matchNsfwTags } from "./game-tags.ts";
import { coverCandidates, scanMode } from "./mode.ts";
import { NSFW_MODEL, type NsfwResult, nsfwScore } from "./nsfw.ts";
import { PROBE_VERSION } from "./probe.ts";

/**
 * One jam entry's cover — the automated first pass of jam-entry moderation
 * (docs/plans/22): fetch the cover and the game's public data.json, then
 * fingerprint and score what they hold into `social.entry_flags` rows for
 * the /admin queue. Nothing here acts on an entry — every flag ends at a
 * person.
 *
 * Three detectors ride the two fetches:
 *   - dHash into `itch.entry_scans` — the bookkeeping that makes every other
 *     pass incremental, and the corpus the theft matcher joins against.
 *   - internal theft: an entry whose cover matches another author's earlier
 *     entry (exact hash across the whole corpus, near hash within the jam)
 *     flags the newer entry as `stolen_internal`.
 *   - NSFW, from both sides: the embedding probe's sexual-content score
 *     (gore alone never flags — the policy only gates nudity, Steam-style),
 *     and the creator's own adult tags from data.json. Either flags as `nsfw`.
 *
 * Flags are idempotent per (entry, kind): a re-scan refreshes the open
 * flag's evidence instead of stacking duplicates, and an entry a human has
 * already ruled on (confirmed or dismissed) is never re-flagged.
 *
 * Runs under the jam's lock: the near matcher's comparison pool must hold a
 * jam's predecessors, so a jam's entries are scanned one at a time however
 * many workers or instances are consuming the queue.
 */

/** Bump to force a global re-scan (hash algorithm, model, or threshold-shape changes). */
// v2: alpha-flattened + information-gated dHash, SigLIP category classifier.
// v3: horror-aesthetic safe anchors, stale-flag auto-close, version-scoped matching.
// v4: SigLIP2 (reads text covers; SigLIP1's contrast rode noise on minimal
//     art), themed-iconography anchors (chalk outline, cartoon heart, censor bar).
// v6: sexual-only flagging — gore stays in the contrast as an absorber but
//     never flags; the stored score is now the sexual category, not the max.
//     creator-tag signal — each scan also reads the game's public data.json,
//     and self-set adult tags flag as nsfw on their own.
// v7: photographic/painterly safe anchors (face close-ups, product shots,
//     even a grayscale door drawing were topping 90% — the only "photo of…"
//     hypotheses were the flag prompts). First version to persist cover
//     embeddings, so later prompt/threshold changes rescore from the DB.
// (unbumped) the verdict moved from prompt contrast to an embedding probe
//     (scan/probe.ts). Stored embeddings are unchanged, so new weights are
//     applied with `bun run rescore`, never by forcing a cover re-fetch.
// (unbumped) cover identity by image id, cover_status, data.json-first on a
//     replaced cover, revisit mode (plan 24) — none of it changes a stored
//     hash or score, so nothing becomes due from the move to the queue.
export const DETECTOR_VERSION = 7;

/**
 * Bits of dHash drift tolerated by the within-jam near matcher. 128-bit
 * dHashes of unrelated covers differ by ~64 bits and structural twins
 * (same layout, different art) measure ≥ ~29; recompressed/resized copies
 * of the same art measure ≤ ~12.
 */
const NEAR_HAMMING_MAX = 16;

export type EntryScanOutcome = {
  mode: "full" | "revisit";
  flagged: number;
  coverStatus: ScanCoverStatus;
};

export type ScanContext = { nsfwEnabled: boolean };

type EntryRow = {
  entryId: number;
  jamId: number;
  gameCoverUrl: string | null;
  gameUrl: string;
  gameTitle: string;
  rateUrl: string;
  authorId: number | null;
  authorName: string | null;
  submittedAt: Date | null;
  missingSince: Date | null;
};

const entryColumns = {
  entryId: itchJamEntries.entryId,
  jamId: itchJamEntries.jamId,
  gameCoverUrl: itchJamEntries.gameCoverUrl,
  gameUrl: itchJamEntries.gameUrl,
  gameTitle: itchJamEntries.gameTitle,
  rateUrl: itchJamEntries.rateUrl,
  authorId: itchJamEntries.authorId,
  authorName: itchJamEntries.authorName,
  submittedAt: itchJamEntries.submittedAt,
  missingSince: itchJamEntries.missingSince,
};

/** The queue's entry point: load, lock the jam, scan. */
export async function scanEntryById(
  entryId: number,
  ctx: ScanContext,
): Promise<EntryScanOutcome | "missing"> {
  const [entry] = await db
    .select(entryColumns)
    .from(itchJamEntries)
    .where(eq(itchJamEntries.entryId, entryId))
    .limit(1);
  if (!entry || entry.missingSince) return "missing";
  return withJamLock(entry.jamId, () => scanEntry(entry, ctx));
}

async function scanEntry(entry: EntryRow, ctx: ScanContext): Promise<EntryScanOutcome> {
  const [stored] = await db
    .select({
      detectorVersion: itchEntryScans.detectorVersion,
      coverStatus: itchEntryScans.coverStatus,
      coverUrl: itchEntryScans.coverUrl,
      hasEmbedding: sql<boolean>`${itchEntryScans.coverEmbedding} IS NOT NULL`,
      embeddingModel: itchEntryScans.embeddingModel,
      nsfwScore: itchEntryScans.nsfwScore,
    })
    .from(itchEntryScans)
    .where(eq(itchEntryScans.entryId, entry.entryId))
    .limit(1);

  // The game's public data.json: the creator's own tag list — the
  // self-reported half of the NSFW verdict (see game-tags.ts; null means it
  // couldn't be checked, which blocks clearing but never firing) — and the
  // game's current cover URL.
  const game = await fetchGameData(entry.gameUrl);

  const mode = ctx.nsfwEnabled
    ? scanMode(entry, stored ?? null, { detectorVersion: DETECTOR_VERSION, model: NSFW_MODEL })
    : "full";
  if (mode === "revisit" && stored) {
    const candidates = coverCandidates(entry.gameCoverUrl, game?.coverImage ?? null);
    if (!candidates.replaced) {
      return revisitEntry(entry, game, stored.nsfwScore);
    }
    // The cover changed since the last look: itself the mild signal plan 22
    // named. Fall through to the full path with the fresh URL preferred.
  }
  return fullScan(entry, game, ctx);
}

/**
 * The one-request revisit: re-run the tag half of the NSFW verdict against
 * the stored classifier score (creators do add adult tags after
 * submission), and touch `scanned_at`. `stolen_internal` is not re-judged
 * and not cleared — the stale-flag sweep covers only kinds this visit
 * actually judged.
 */
async function revisitEntry(
  entry: EntryRow,
  game: GameData | null,
  storedScore: number | null,
): Promise<EntryScanOutcome> {
  if (game == null) {
    // data.json 404: the game is gone. The cover row becomes `gone` so the
    // embedding-presence clause never re-fetches it; `missing_since` on the
    // entry stays the results drain's call.
    await db
      .update(itchEntryScans)
      .set({ coverStatus: "gone", scannedAt: sql`now()` })
      .where(eq(itchEntryScans.entryId, entry.entryId));
    return { mode: "revisit", flagged: 0, coverStatus: "gone" };
  }
  const nsfwTags = matchNsfwTags(game.tags);
  const fired = new Set<EntryFlagKind>();
  const verdict = await flagNsfw(
    entry,
    storedScore == null ? null : { score: storedScore },
    nsfwTags,
  );
  if (verdict.fired) fired.add("nsfw");
  await clearStaleAutoFlags(entry.entryId, fired, ["nsfw"]);
  await db
    .update(itchEntryScans)
    .set({ scannedAt: sql`now()` })
    .where(eq(itchEntryScans.entryId, entry.entryId));
  return { mode: "revisit", flagged: verdict.flagged, coverStatus: "fetched" };
}

async function fullScan(
  entry: EntryRow,
  game: GameData | null,
  ctx: ScanContext,
): Promise<EntryScanOutcome> {
  // Kinds this scan re-confirmed on THIS entry. Whatever didn't re-fire has
  // its open auto flag cleared at the end — otherwise flags written by an
  // older detector (or against a cover that has since changed) sit in the
  // queue forever, since nothing else ever closes an open flag.
  const fired = new Set<EntryFlagKind>();
  const nsfwTags = game == null ? null : matchNsfwTags(game.tags);

  // Which derivative to fetch first (mode.ts): a replaced cover prefers
  // data.json's live one; otherwise the stored URL, with data.json's as the
  // fallback when the stored one is gone — the jam's entry list freezes
  // once a jam is terminal, so replaced covers rot and deleted games take
  // their covers with them. `live` carries whichever URL the bytes came from.
  const candidates = coverCandidates(entry.gameCoverUrl, game?.coverImage ?? null);
  let live = entry;
  let bytes = candidates.first ? await fetchCover(candidates.first) : null;
  if (bytes && candidates.first !== entry.gameCoverUrl) {
    live = { ...entry, gameCoverUrl: candidates.first };
  }
  if (!bytes && candidates.fallback) {
    bytes = await fetchCover(candidates.fallback);
    if (bytes) live = { ...entry, gameCoverUrl: candidates.fallback };
  }

  if (live !== entry) {
    // Adopt the live URL on the entry itself — the frozen one is the art
    // the creator has since replaced, and this scan is the only process
    // that ever learns the replacement. Before the scan row: if the job
    // dies between the two writes, the entry stays due and the next pass
    // takes the same path again.
    await db
      .update(itchJamEntries)
      .set({ gameCoverUrl: live.gameCoverUrl })
      .where(eq(itchJamEntries.entryId, entry.entryId));
  }

  if (!bytes) {
    // Record the URL (dead or null) so the entry isn't re-fetched every
    // hour; a future cover change makes it due again.
    const coverStatus: ScanCoverStatus = entry.gameCoverUrl ? "gone" : "none";
    await upsertScan(entry.entryId, {
      coverUrl: entry.gameCoverUrl,
      coverStatus,
      coverPhash: null,
      nsfwScore: null,
      coverEmbedding: null,
      embeddingModel: null,
    });
    const flagged = await flagCoverlessNsfw(entry, nsfwTags, fired);
    return { mode: "full", flagged, coverStatus };
  }

  const phash = await hashCover(bytes);
  const nsfw = ctx.nsfwEnabled ? await nsfwScore(bytes) : null;
  // Matches the entry row (updated above on fallback) — due-ness compares
  // the two by image id, so they must agree or the entry stays due forever.
  await upsertScan(entry.entryId, {
    coverUrl: live.gameCoverUrl,
    coverStatus: "fetched",
    coverPhash: phash,
    nsfwScore: nsfw?.score ?? null,
    coverEmbedding: nsfw?.embedding ? encodeEmbedding(nsfw.embedding) : null,
    embeddingModel: nsfw?.embedding ? NSFW_MODEL : null,
  });

  const nsfwFlag = await flagNsfw(live, nsfw, nsfwTags);
  if (nsfwFlag.fired) fired.add("nsfw");
  let flagged = nsfwFlag.flagged;

  if (phash) {
    const matches = await flagInternalMatches(live, phash);
    flagged += matches.flagged;
    if (matches.firedOnScanned) fired.add("stolen_internal");
  }

  // Both NSFW signals must have produced a verdict before an nsfw flag is
  // clearable — a classifier that didn't run (disabled or down) or a
  // data.json that couldn't be read might be the very signal that fired the
  // standing flag, and absence of a verdict is not evidence.
  await clearStaleAutoFlags(
    entry.entryId,
    fired,
    nsfw != null && nsfwTags != null ? ["nsfw", "stolen_internal"] : ["stolen_internal"],
  );
  return { mode: "full", flagged, coverStatus: "fetched" };
}

/**
 * The tag-only NSFW pass for entries whose cover can't be scored (none set,
 * or the URL is dead). The classifier verdict is vacuous here — there is no
 * cover for a flag to be about — so tags alone decide, and a checked tag
 * list (even an empty one) is enough to clear a stale flag.
 */
async function flagCoverlessNsfw(
  entry: EntryRow,
  nsfwTags: string[] | null,
  fired: Set<EntryFlagKind>,
): Promise<number> {
  const nsfwFlag = await flagNsfw(entry, null, nsfwTags);
  if (nsfwFlag.fired) fired.add("nsfw");
  await clearStaleAutoFlags(
    entry.entryId,
    fired,
    nsfwTags != null ? ["nsfw", "stolen_internal"] : ["stolen_internal"],
  );
  return nsfwFlag.flagged;
}

/**
 * The NSFW verdict, from both signals: the probe's sexual score over the
 * cover, and the creator's own adult tags. Either alone flags — and the
 * self-set tag is the surer of the two, so a tag hit pins the score to 1
 * regardless of what the classifier saw.
 */
async function flagNsfw(
  entry: EntryRow,
  nsfw: Pick<NsfwResult, "score"> | null,
  nsfwTags: string[] | null,
): Promise<{ fired: boolean; flagged: number }> {
  const scored = nsfw != null && nsfw.score >= config.NSFW_THRESHOLD;
  const tagged = nsfwTags != null && nsfwTags.length > 0;
  if (!scored && !tagged) return { fired: false, flagged: 0 };

  const flagged = await upsertOpenFlag({
    entryId: entry.entryId,
    jamId: entry.jamId,
    kind: "nsfw",
    score: tagged ? 1 : (nsfw?.score ?? 0),
    evidence: {
      detectorVersion: DETECTOR_VERSION,
      model: nsfw ? NSFW_MODEL : undefined,
      scorer: nsfw ? PROBE_VERSION : undefined,
      nsfwScore: nsfw?.score,
      nsfwReason: scored ? "sexual" : undefined,
      nsfwTags: tagged ? nsfwTags : undefined,
      coverUrl: entry.gameCoverUrl,
      gameTitle: entry.gameTitle,
      rateUrl: entry.rateUrl,
    },
  });
  return { fired: true, flagged };
}

/**
 * Deletes open auto flags of detector-owned kinds this scan didn't
 * re-confirm. Human-resolved flags are never touched — they're the "we
 * already looked" memory — and flags this entry earned as the newer side of
 * someone else's scan get re-created by that entry's own re-scan if still
 * real.
 */
async function clearStaleAutoFlags(
  entryId: number,
  fired: ReadonlySet<EntryFlagKind>,
  clearable: EntryFlagKind[],
): Promise<void> {
  const stale = clearable.filter((kind) => !fired.has(kind));
  if (stale.length === 0) return;
  await db
    .delete(entryFlags)
    .where(
      and(
        eq(entryFlags.entryId, entryId),
        eq(entryFlags.status, "open"),
        eq(entryFlags.source, "auto"),
        inArray(entryFlags.kind, stale),
      ),
    );
}

function upsertScan(
  entryId: number,
  values: {
    coverUrl: string | null;
    coverStatus: ScanCoverStatus;
    coverPhash: string | null;
    nsfwScore: number | null;
    coverEmbedding: Buffer | null;
    embeddingModel: string | null;
  },
) {
  return db
    .insert(itchEntryScans)
    .values({ entryId, detectorVersion: DETECTOR_VERSION, scannedAt: sql`now()`, ...values })
    .onConflictDoUpdate({
      target: itchEntryScans.entryId,
      set: { ...values, detectorVersion: DETECTOR_VERSION, scannedAt: sql`now()` },
    });
}

type InternalMatch = HashedEntry & {
  distance: number;
  jamId: number;
  gameTitle: string;
  gameUrl: string;
  rateUrl: string;
  gameCoverUrl: string | null;
  authorName: string | null;
  submittedAt: Date | null;
};

/**
 * The internal cross-corpus matcher. Exact-hash matches come from an indexed
 * join over the whole scanned corpus; near-hash comparison is brute force
 * over this jam's entries only (thousands of comparisons, not millions).
 * Whichever entry of a matched pair is newer gets the flag, with the older
 * one as evidence — resubmitting your own game across jams is normal, the
 * same cover under a different author is what the queue should see.
 *
 * Both pools are scoped to hashes from THIS detector version: hashes from
 * different algorithms aren't comparable, and matching against a stale
 * corpus mid-re-scan is how v1's degenerate zero-hashes once flagged three
 * unrelated covers against one newly scanned black square.
 */
async function flagInternalMatches(
  entry: EntryRow,
  phash: string,
): Promise<{ flagged: number; firedOnScanned: boolean }> {
  const exact = await db
    .select({
      entryId: itchEntryScans.entryId,
      authorId: itchJamEntries.authorId,
      coverPhash: itchEntryScans.coverPhash,
      jamId: itchJamEntries.jamId,
      gameTitle: itchJamEntries.gameTitle,
      gameUrl: itchJamEntries.gameUrl,
      rateUrl: itchJamEntries.rateUrl,
      gameCoverUrl: itchJamEntries.gameCoverUrl,
      authorName: itchJamEntries.authorName,
      submittedAt: itchJamEntries.submittedAt,
    })
    .from(itchEntryScans)
    .innerJoin(itchJamEntries, eq(itchJamEntries.entryId, itchEntryScans.entryId))
    .where(
      and(
        eq(itchEntryScans.coverPhash, phash),
        eq(itchEntryScans.detectorVersion, DETECTOR_VERSION),
        ne(itchEntryScans.entryId, entry.entryId),
        isNull(itchJamEntries.missingSince),
        // Same author is not theft, however many jams the cover spans.
        entry.authorId == null
          ? undefined
          : sql`${itchJamEntries.authorId} IS DISTINCT FROM ${entry.authorId}`,
      ),
    );

  const jamPool = await jamHashPool(entry.jamId, entry.entryId);
  const seen = new Set(exact.map((m) => m.entryId));
  const near = nearMatches(phash, entry.entryId, entry.authorId, jamPool, NEAR_HAMMING_MAX).filter(
    (m) => m.distance > 0 && !seen.has(m.entryId),
  );

  const matches: InternalMatch[] = [
    ...exact.map((m) => ({ ...m, coverPhash: m.coverPhash ?? phash, distance: 0 })),
    ...(await hydrateMatches(near)),
  ];

  let flagged = 0;
  let firedOnScanned = false;
  for (const match of matches) {
    const matchIsOlder = isOlder(
      { submittedAt: match.submittedAt, entryId: match.entryId },
      { submittedAt: entry.submittedAt, entryId: entry.entryId },
    );
    const scanned = {
      entryId: entry.entryId,
      jamId: entry.jamId,
      gameTitle: entry.gameTitle,
      gameUrl: entry.gameUrl,
      rateUrl: entry.rateUrl,
      coverUrl: entry.gameCoverUrl,
      authorName: entry.authorName,
      submittedAt: entry.submittedAt,
    };
    const matched = {
      entryId: match.entryId,
      jamId: match.jamId,
      gameTitle: match.gameTitle,
      gameUrl: match.gameUrl,
      rateUrl: match.rateUrl,
      coverUrl: match.gameCoverUrl,
      authorName: match.authorName,
      submittedAt: match.submittedAt,
    };
    const target = matchIsOlder ? scanned : matched;
    const original = matchIsOlder ? matched : scanned;
    if (target.entryId === entry.entryId) firedOnScanned = true;

    flagged += await upsertOpenFlag({
      entryId: target.entryId,
      jamId: target.jamId,
      kind: "stolen_internal",
      score: (128 - match.distance) / 128,
      evidence: {
        detectorVersion: DETECTOR_VERSION,
        hashDistance: match.distance,
        gameTitle: target.gameTitle,
        rateUrl: target.rateUrl,
        coverUrl: target.coverUrl,
        matchedEntry: original,
      },
    });
  }
  return { flagged, firedOnScanned };
}

/** Older wins by submission time; entries without one fall back to id order. */
export function isOlder(
  a: { submittedAt: Date | null; entryId: number },
  b: { submittedAt: Date | null; entryId: number },
): boolean {
  if (a.submittedAt && b.submittedAt && a.submittedAt.getTime() !== b.submittedAt.getTime()) {
    return a.submittedAt.getTime() < b.submittedAt.getTime();
  }
  return a.entryId < b.entryId;
}

/**
 * The jam's scanned hashes, read fresh per entry: under the jam lock the
 * pool is exactly the predecessors, whichever process scanned them.
 */
async function jamHashPool(jamId: number, exceptEntryId: number): Promise<HashedEntry[]> {
  return db
    .select({
      entryId: itchEntryScans.entryId,
      authorId: itchJamEntries.authorId,
      coverPhash: sql<string>`${itchEntryScans.coverPhash}`,
    })
    .from(itchEntryScans)
    .innerJoin(itchJamEntries, eq(itchJamEntries.entryId, itchEntryScans.entryId))
    .where(
      and(
        eq(itchJamEntries.jamId, jamId),
        ne(itchEntryScans.entryId, exceptEntryId),
        isNull(itchJamEntries.missingSince),
        sql`${itchEntryScans.coverPhash} IS NOT NULL`,
        eq(itchEntryScans.detectorVersion, DETECTOR_VERSION),
      ),
    );
}

/** Near matches carry their hash and distance; fill in the entry facts. */
async function hydrateMatches(
  near: Array<HashedEntry & { distance: number }>,
): Promise<InternalMatch[]> {
  if (near.length === 0) return [];
  const byId = new Map(near.map((m) => [m.entryId, m]));
  const rows = await db
    .select({
      entryId: itchJamEntries.entryId,
      jamId: itchJamEntries.jamId,
      gameTitle: itchJamEntries.gameTitle,
      gameUrl: itchJamEntries.gameUrl,
      rateUrl: itchJamEntries.rateUrl,
      gameCoverUrl: itchJamEntries.gameCoverUrl,
      authorName: itchJamEntries.authorName,
      submittedAt: itchJamEntries.submittedAt,
    })
    .from(itchJamEntries)
    .where(inArray(itchJamEntries.entryId, [...byId.keys()]));
  return rows.flatMap((r) => {
    const m = byId.get(r.entryId);
    return m
      ? [{ ...r, authorId: m.authorId, coverPhash: m.coverPhash, distance: m.distance }]
      : [];
  });
}

/**
 * Opens (or refreshes) a flag, unless a human already ruled: any resolved
 * flag of this kind on this entry — confirmed or dismissed — makes the
 * detector stand down. Resolved rows are the "we already looked" memory.
 * Returns 1 when a flag was written.
 */
async function upsertOpenFlag(flag: {
  entryId: number;
  jamId: number;
  kind: EntryFlagKind;
  score: number;
  evidence: Record<string, unknown>;
}): Promise<number> {
  const [ruled] = await db
    .select({ id: entryFlags.id })
    .from(entryFlags)
    .where(
      and(
        eq(entryFlags.entryId, flag.entryId),
        eq(entryFlags.kind, flag.kind),
        ne(entryFlags.status, "open"),
      ),
    )
    .limit(1);
  if (ruled) return 0;

  await db
    .insert(entryFlags)
    .values({
      entryId: flag.entryId,
      jamId: flag.jamId,
      kind: flag.kind,
      source: "auto",
      score: flag.score,
      evidence: flag.evidence,
    })
    .onConflictDoUpdate({
      target: [entryFlags.entryId, entryFlags.kind],
      targetWhere: sql`status = 'open'`,
      set: { score: flag.score, evidence: flag.evidence },
    });
  return 1;
}

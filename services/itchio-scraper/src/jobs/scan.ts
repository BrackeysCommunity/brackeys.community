import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  type EntryFlagKind,
  entryFlags,
  itchEntryScans,
  itchJamEntries,
} from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { describeError } from "../http.ts";
import { fetchCover, hashCover } from "../scan/cover.ts";
import { type HashedEntry, nearMatches } from "../scan/dhash.ts";
import { fetchGameTags, matchNsfwTags } from "../scan/game-tags.ts";
import { initNsfw, NSFW_MODEL, type NsfwResult, nsfwScore } from "../scan/nsfw.ts";
import { createStopGate, runTier, sleep, type StopGate } from "./runner.ts";
import { type DueScanEntry, dueScanEntries } from "./selectors.ts";

/**
 * SCAN tier — hourly. The automated first pass of jam-entry moderation
 * (docs/plans/22): fetch each entry's cover and its game's public data.json
 * once, fingerprint and score what they hold, and turn that into
 * `social.entry_flags` rows for the /admin queue. Nothing here acts on an
 * entry — every flag ends at a person.
 *
 * Three detectors ride the two fetches:
 *   - dHash into `itch.entry_scans` — the bookkeeping that makes every other
 *     pass incremental, and the corpus the theft matcher joins against.
 *   - internal theft: an entry whose cover matches another author's earlier
 *     entry (exact hash across the whole corpus, near hash within the jam)
 *     flags the newer entry as `stolen_internal`.
 *   - NSFW, from both sides: an in-process classifier whose sexual-content
 *     score clears the threshold (gore alone never flags — the policy only
 *     gates nudity, Steam-style), and the creator's own adult tags from
 *     data.json (see scan/game-tags.ts). Either flags as `nsfw`.
 *
 * Flags are idempotent per (entry, kind): a re-scan refreshes the open
 * flag's evidence instead of stacking duplicates, and an entry a human has
 * already ruled on (confirmed or dismissed) is never re-flagged.
 *
 *   bun run scan
 *
 * Env knobs (all optional): SCAN_DELAY_MS, SCAN_DEADLINE_MINS, SCAN_BATCH,
 * NSFW_THRESHOLD, NSFW_ENABLED.
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
export const DETECTOR_VERSION = 6;

/**
 * Bits of dHash drift tolerated by the within-jam near matcher. 128-bit
 * dHashes of unrelated covers differ by ~64 bits and structural twins
 * (same layout, different art) measure ≥ ~29; recompressed/resized copies
 * of the same art measure ≤ ~12.
 */
const NEAR_HAMMING_MAX = 16;

type ScanOutcome = { flagged: number };

export async function runScan(gate?: StopGate): Promise<number> {
  const stopGate = gate ?? createStopGate("scan", config.SCAN_DEADLINE_MINS);

  const nsfwEnabled = config.NSFW_ENABLED && (await initNsfw());
  if (config.NSFW_ENABLED && !nsfwEnabled) {
    console.warn("[scan] NSFW scoring unavailable this tick — hashing and matching continue");
  }

  const due = await dueScanEntries(DETECTOR_VERSION, config.SCAN_BATCH);
  console.log(`[scan] ${due.length} entries due (batch cap ${config.SCAN_BATCH})`);
  if (due.length === 0) return 0;

  // Per-jam hash lists for the near matcher, loaded once per jam and kept
  // current as the tick hashes new covers. The due list is jam-ordered, so
  // in practice this holds one or two jams at a time.
  const jamHashes = new Map<number, HashedEntry[]>();

  let done = 0;
  let failed = 0;
  let flagged = 0;
  let stopped: string | null = null;

  for (const entry of due) {
    stopped = stopGate.reason();
    if (stopped) break;
    try {
      const outcome = await scanEntry(entry, { nsfwEnabled, jamHashes });
      flagged += outcome.flagged;
      done++;
    } catch (err) {
      failed++;
      console.error(
        `[scan] FAIL entry ${entry.entryId} (${entry.gameTitle}): ${describeError(err)}`,
      );
    }
    await sleep(config.SCAN_DELAY_MS);
  }

  console.log(
    `[scan] scanned ${done}/${due.length} entries, flagged=${flagged}, failed=${failed}${
      stopped ? ` (stopped early: ${stopped} — next tick resumes)` : ""
    }`,
  );
  return failed;
}

type ScanContext = {
  nsfwEnabled: boolean;
  jamHashes: Map<number, HashedEntry[]>;
};

async function scanEntry(entry: DueScanEntry, ctx: ScanContext): Promise<ScanOutcome> {
  // Kinds this scan re-confirmed on THIS entry. Whatever didn't re-fire has
  // its open auto flag cleared at the end — otherwise flags written by an
  // older detector (or against a cover that has since changed) sit in the
  // queue forever, since nothing else ever closes an open flag.
  const fired = new Set<EntryFlagKind>();

  // The creator's own tag list, from the game's public data.json — the
  // self-reported half of the NSFW verdict (see scan/game-tags.ts). Null
  // means it couldn't be checked, which blocks clearing but never firing.
  const tags = await fetchGameTags(entry.gameUrl);
  const nsfwTags = tags == null ? null : matchNsfwTags(tags);

  if (!entry.gameCoverUrl) {
    await upsertScan(entry.entryId, { coverUrl: null, coverPhash: null, nsfwScore: null });
    const flagged = await flagCoverlessNsfw(entry, nsfwTags, fired);
    return { flagged };
  }

  const bytes = await fetchCover(entry.gameCoverUrl);
  if (!bytes) {
    // Cover URL 404s: record the URL so the entry isn't re-fetched every
    // tick; a future cover change makes it due again.
    await upsertScan(entry.entryId, {
      coverUrl: entry.gameCoverUrl,
      coverPhash: null,
      nsfwScore: null,
    });
    const flagged = await flagCoverlessNsfw(entry, nsfwTags, fired);
    return { flagged };
  }

  const phash = await hashCover(bytes);
  const nsfw = ctx.nsfwEnabled ? await nsfwScore(bytes) : null;
  await upsertScan(entry.entryId, {
    coverUrl: entry.gameCoverUrl,
    coverPhash: phash,
    nsfwScore: nsfw?.score ?? null,
  });

  const nsfwFlag = await flagNsfw(entry, nsfw, nsfwTags);
  if (nsfwFlag.fired) fired.add("nsfw");
  let flagged = nsfwFlag.flagged;

  if (phash) {
    const matches = await flagInternalMatches(entry, phash, ctx);
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
  return { flagged };
}

/**
 * The tag-only NSFW pass for entries whose cover can't be scored (none set,
 * or the URL 404s). The classifier verdict is vacuous here — there is no
 * cover for a flag to be about — so tags alone decide, and a checked tag
 * list (even an empty one) is enough to clear a stale flag.
 */
async function flagCoverlessNsfw(
  entry: DueScanEntry,
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
 * The NSFW verdict, from both signals: the classifier's sexual score over
 * the cover, and the creator's own adult tags. Either alone flags — and the
 * self-set tag is the surer of the two, so a tag hit pins the score to 1
 * regardless of what the classifier saw.
 */
async function flagNsfw(
  entry: DueScanEntry,
  nsfw: NsfwResult | null,
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
      nsfwScore: nsfw?.score,
      nsfwReason: scored ? "sexual" : undefined,
      nsfwCategories: nsfw?.categories,
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
  clearable: EntryFlagKind[] = ["nsfw", "stolen_internal"],
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
  values: { coverUrl: string | null; coverPhash: string | null; nsfwScore: number | null },
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
  entry: DueScanEntry,
  phash: string,
  ctx: ScanContext,
): Promise<{ flagged: number; firedOnScanned: boolean }> {
  const exact = await db
    .select({
      entryId: itchEntryScans.entryId,
      authorId: itchJamEntries.authorId,
      coverPhash: itchEntryScans.coverPhash,
      jamId: itchJamEntries.jamId,
      gameTitle: itchJamEntries.gameTitle,
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

  const jamPool = await jamHashPool(entry.jamId, ctx);
  const seen = new Set(exact.map((m) => m.entryId));
  const near = nearMatches(phash, entry.entryId, entry.authorId, jamPool, NEAR_HAMMING_MAX).filter(
    (m) => m.distance > 0 && !seen.has(m.entryId),
  );

  const matches: InternalMatch[] = [
    ...exact.map((m) => ({ ...m, coverPhash: m.coverPhash ?? phash, distance: 0 })),
    ...(await hydrateMatches(near)),
  ];

  // This entry now belongs to the jam's comparison pool.
  jamPool.push({ entryId: entry.entryId, authorId: entry.authorId, coverPhash: phash });

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
      rateUrl: entry.rateUrl,
      coverUrl: entry.gameCoverUrl,
      authorName: entry.authorName,
      submittedAt: entry.submittedAt,
    };
    const matched = {
      entryId: match.entryId,
      jamId: match.jamId,
      gameTitle: match.gameTitle,
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

async function jamHashPool(jamId: number, ctx: ScanContext): Promise<HashedEntry[]> {
  const cached = ctx.jamHashes.get(jamId);
  if (cached) return cached;
  const rows = await db
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
        isNull(itchJamEntries.missingSince),
        sql`${itchEntryScans.coverPhash} IS NOT NULL`,
        eq(itchEntryScans.detectorVersion, DETECTOR_VERSION),
      ),
    );
  ctx.jamHashes.set(jamId, rows);
  return rows;
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

if (import.meta.main) {
  await runTier("scan", () => runScan());
}

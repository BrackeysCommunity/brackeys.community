import { createServiceTelemetry } from "../../../../src/lib/service-telemetry.ts";
import { config } from "../config.ts";
import { pool } from "../db/client.ts";
import { describeError } from "../http.ts";
import { decodeEmbedding } from "../scan/embedding.ts";
import { DETECTOR_VERSION } from "../scan/entry.ts";
import { NSFW_MODEL } from "../scan/nsfw.ts";
import { PROBE_VERSION, probeScore } from "../scan/probe.ts";

/**
 * DB-only NSFW re-score. Applies the current probe (scan/probe.ts) to every
 * stored cover embedding, rewrites `itch.entry_scans.nsfw_score`, and brings
 * the open `nsfw` flags in line with the new scores — no cover is fetched
 * and no model is loaded. This is the path for a weights change; bumping
 * DETECTOR_VERSION instead would re-fetch the whole corpus at the scan
 * tier's pace (~1,500 covers an hour).
 *
 * Flag reconciliation mirrors the scan tier's rules:
 *   - score ≥ NSFW_THRESHOLD opens (or refreshes) the entry's auto flag.
 *     A creator-tag flag is left pinned at 1 and keeps its tag evidence.
 *   - below threshold, an open classifier-only auto flag is deleted; a
 *     tag flag stays, since the tag verdict didn't change.
 *   - an entry a human has already ruled on (confirmed/dismissed) is never
 *     re-flagged, and resolved rows are never touched.
 *
 * Idempotent and interruptible: progress is the written score, SIGINT or
 * SIGTERM finish the current batch and exit, and a re-run redoes nothing
 * harmful. Vectors from a different encoder than the probe's are skipped —
 * they can't be scored, and the scan tier owes them a fresh look anyway.
 *
 *   bun run rescore
 *
 * Env knobs (all optional):
 *   RESCORE_BATCH     entries per round trip (default 2000)
 *   RESCORE_DRY_RUN   "true" reports what would change and writes nothing
 */

type ScanRow = {
  entry_id: string;
  cover_embedding: Buffer;
  cover_url: string | null;
  jam_id: number;
  game_title: string;
  rate_url: string;
};

type Scored = {
  entryId: number;
  jamId: number;
  score: number;
  coverUrl: string | null;
  gameTitle: string;
  rateUrl: string;
};

type Tally = {
  scored: number;
  skipped: number;
  above: number;
  flagsUpserted: number;
  flagsDeleted: number;
};

export async function runRescore(): Promise<number> {
  const dryRun = config.RESCORE_DRY_RUN;
  const threshold = config.NSFW_THRESHOLD;
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      console.log(`[rescore] ${signal} — finishing the current batch`);
      stopping = true;
    });
  }

  console.log(
    `[rescore] probe=${PROBE_VERSION} threshold=${threshold} batch=${config.RESCORE_BATCH}${dryRun ? " DRY RUN" : ""}`,
  );

  const tally: Tally = { scored: 0, skipped: 0, above: 0, flagsUpserted: 0, flagsDeleted: 0 };
  let cursor = 0;
  const started = Date.now();

  while (!stopping) {
    const { rows } = await pool.query<ScanRow>(
      `select s.entry_id, s.cover_embedding, s.cover_url, e.jam_id, e.game_title, e.rate_url
         from itch.entry_scans s
         join itch.jam_entries e on e.entry_id = s.entry_id
        where s.entry_id > $1
          and s.cover_embedding is not null
          and s.embedding_model = $2
        order by s.entry_id
        limit $3`,
      [cursor, NSFW_MODEL, config.RESCORE_BATCH],
    );
    if (rows.length === 0) break;
    cursor = Number(rows[rows.length - 1]?.entry_id);

    const scored: Scored[] = [];
    for (const row of rows) {
      const score = probeScore(decodeEmbedding(row.cover_embedding));
      if (score == null) {
        tally.skipped++;
        continue;
      }
      scored.push({
        entryId: Number(row.entry_id),
        jamId: row.jam_id,
        score,
        coverUrl: row.cover_url,
        gameTitle: row.game_title,
        rateUrl: row.rate_url,
      });
    }
    tally.scored += scored.length;

    const above = scored.filter((s) => s.score >= threshold);
    const below = scored.filter((s) => s.score < threshold);
    tally.above += above.length;

    if (dryRun) {
      tally.flagsUpserted += await countWouldOpen(above);
      tally.flagsDeleted += await countWouldClose(below);
    } else {
      await writeScores(scored);
      tally.flagsUpserted += await upsertFlags(above);
      tally.flagsDeleted += await closeFlags(below);
    }

    if (tally.scored % 20_000 < config.RESCORE_BATCH) {
      const mins = ((Date.now() - started) / 60_000).toFixed(1);
      console.log(
        `[rescore] ${tally.scored} scored, ${tally.above} above threshold, ` +
          `flags ${dryRun ? "would open/refresh" : "upserted"}=${tally.flagsUpserted} ` +
          `${dryRun ? "would close" : "closed"}=${tally.flagsDeleted} (${mins}m)`,
      );
    }
  }

  console.log(
    `[rescore] done${stopping ? " (stopped early)" : ""}: scored=${tally.scored} skipped=${tally.skipped} ` +
      `above=${tally.above} flags ${dryRun ? "would open/refresh" : "upserted"}=${tally.flagsUpserted} ` +
      `${dryRun ? "would close" : "closed"}=${tally.flagsDeleted}`,
  );
  return 0;
}

async function writeScores(scored: Scored[]): Promise<void> {
  if (scored.length === 0) return;
  await pool.query(
    `update itch.entry_scans s
        set nsfw_score = v.score
       from unnest($1::bigint[], $2::real[]) as v(entry_id, score)
      where s.entry_id = v.entry_id`,
    [scored.map((s) => s.entryId), scored.map((s) => s.score)],
  );
}

/**
 * Opens or refreshes the auto flag for each above-threshold entry. On an
 * existing open flag the score only ever rises (`greatest`) and evidence is
 * merged, so a creator-tag flag keeps its pinned 1 and its `nsfwTags`; the
 * zero-shot `nsfwCategories` are dropped, since the admin card would show
 * them beside a score they no longer explain. Entries with a human-ruled
 * nsfw flag are skipped, like the scan tier.
 */
async function upsertFlags(above: Scored[]): Promise<number> {
  if (above.length === 0) return 0;
  const evidence = above.map((s) =>
    JSON.stringify({
      detectorVersion: DETECTOR_VERSION,
      model: NSFW_MODEL,
      scorer: PROBE_VERSION,
      nsfwScore: s.score,
      nsfwReason: "sexual",
      coverUrl: s.coverUrl,
      gameTitle: s.gameTitle,
      rateUrl: s.rateUrl,
    }),
  );
  const { rowCount } = await pool.query(
    `insert into social.entry_flags (entry_id, jam_id, kind, source, score, evidence)
     select v.entry_id, v.jam_id, 'nsfw', 'auto', v.score, v.evidence
       from unnest($1::bigint[], $2::int[], $3::real[], $4::jsonb[]) as v(entry_id, jam_id, score, evidence)
      where not exists (
              select 1 from social.entry_flags r
               where r.entry_id = v.entry_id and r.kind = 'nsfw' and r.status <> 'open')
     on conflict (entry_id, kind) where status = 'open'
     do update set score = greatest(social.entry_flags.score, excluded.score),
                   evidence = (social.entry_flags.evidence - 'nsfwCategories') || excluded.evidence`,
    [above.map((s) => s.entryId), above.map((s) => s.jamId), above.map((s) => s.score), evidence],
  );
  return rowCount ?? 0;
}

/** Deletes open classifier-only auto flags for entries now below threshold. */
async function closeFlags(below: Scored[]): Promise<number> {
  if (below.length === 0) return 0;
  const { rowCount } = await pool.query(
    `delete from social.entry_flags
      where entry_id = any($1::bigint[])
        and kind = 'nsfw' and source = 'auto' and status = 'open'
        and not (evidence ? 'nsfwTags')`,
    [below.map((s) => s.entryId)],
  );
  return rowCount ?? 0;
}

async function countWouldOpen(above: Scored[]): Promise<number> {
  if (above.length === 0) return 0;
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n
       from unnest($1::bigint[]) as v(entry_id)
      where not exists (
              select 1 from social.entry_flags r
               where r.entry_id = v.entry_id and r.kind = 'nsfw')`,
    [above.map((s) => s.entryId)],
  );
  return Number(rows[0]?.n ?? 0);
}

async function countWouldClose(below: Scored[]): Promise<number> {
  if (below.length === 0) return 0;
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n
       from social.entry_flags
      where entry_id = any($1::bigint[])
        and kind = 'nsfw' and source = 'auto' and status = 'open'
        and not (evidence ? 'nsfwTags')`,
    [below.map((s) => s.entryId)],
  );
  return Number(rows[0]?.n ?? 0);
}

if (import.meta.main) {
  const telemetry = createServiceTelemetry("media-scan");
  const started = Date.now();
  try {
    await runRescore();
    console.log(`[rescore] finished in ${((Date.now() - started) / 60_000).toFixed(1)}m`);
  } catch (err) {
    console.error(`[rescore] fatal: ${describeError(err)}`);
    telemetry.captureException(err, { job: "rescore" });
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    const { pacerRedis, queueRedis } = await import("../redis.ts");
    pacerRedis.disconnect();
    queueRedis.disconnect();
    await telemetry.shutdown();
  }
}

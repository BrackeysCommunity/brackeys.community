import { eq, sql } from "drizzle-orm";

import { itchJams, itchScrapeCursors } from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { describeError } from "../http.ts";
import { fetchJamEntries, type ItchEntry } from "../scrape/entries.ts";
import { createStopGate, runTier, type StopGate } from "./runner.ts";
import { ingestJam } from "./sync-jam.ts";

/**
 * ID SWEEP — the walk that finds jams itch.io never lists.
 *
 * Discovery and the historical backfill both read itch's own listings, and
 * those listings are not a complete index. `/jams/past/sort-date` bottoms out
 * around page 420 (September 2013) having shown ~21k jams, and jams plainly
 * missing from it are easy to find: Candy Jam (`jam_id` 1), the rest of the
 * 2014 cohort, and ordinary 2016/2021 jams whose pages scrape fine.
 *
 * So this walks the id space directly. `/jam/{id}/entries.json` needs no slug
 * and answers in one request whether an id is a jam — and when it is, the
 * payload carries both the entry list and, in each entry's rate URL, the slug
 * needed to scrape the jam page. Hits are handed to `ingestJam` with those
 * entries already in hand, so a hit costs two requests, not three.
 *
 *   bun run sweep
 *
 * Sampling (August 2026) put the hit rate at 12/60 unheld ids below 20k and
 * 4/120 between 240k and the frontier — on the order of 8k jams we don't hold,
 * against ~178k probes. At the shared 350ms pacer that is ~20 hours of
 * requests, which is why this is a cursor-driven cron phase rather than one
 * long run: each tick sweeps until `SWEEP_DEADLINE_MINS` and the next resumes
 * at the cursor.
 *
 * What it cannot find: a jam with no entries at all. The probe's answer is
 * empty either way, and with no entry there is no rate URL, so no slug, so no
 * page to scrape — an id-addressed jam page (`/jam/1`) 404s. Those stay the
 * listings' job.
 */

const CURSOR_NAME = "jam_id_sweep";

/** The slug in an entry's rate URL — `/jam/candyjam/rate/1287`. It is the only
 * place a swept jam's slug appears, since the probe is keyed by id. */
export function slugFromRateUrl(rateUrl: string): string | null {
  return rateUrl.match(/\/jam\/([^/]+)\/rate\//)?.[1] ?? null;
}

export type SweepRange = { from: number; to: number; gapStart: number; gapEnd: number };

/**
 * The next id worth spending a request on: skips ids we already hold (free)
 * and jumps the barren middle of the id space in one step.
 *
 * That middle band is real, not an artifact of our own coverage — jam ids
 * cluster below 20k and above 240k, and 60 random probes between them found
 * nothing while we hold just 3 rows across 220k ids. Sweeping it anyway would
 * cost ~21 hours of requests for a handful of jams, so it is skipped by
 * default and the skip is logged rather than silent. `SWEEP_GAP_START` /
 * `SWEEP_GAP_END` open it back up.
 */
export function nextSweepId(from: number, held: Set<number>, range: SweepRange): number | null {
  let id = Math.max(from, range.from);
  for (;;) {
    if (id >= range.gapStart && id < range.gapEnd) id = range.gapEnd;
    if (id > range.to) return null;
    if (!held.has(id)) return id;
    id++;
  }
}

async function readCursor(): Promise<number> {
  const [row] = await db
    .select({ position: itchScrapeCursors.position })
    .from(itchScrapeCursors)
    .where(eq(itchScrapeCursors.name, CURSOR_NAME));
  return row?.position ?? 0;
}

async function writeCursor(position: number): Promise<void> {
  await db
    .insert(itchScrapeCursors)
    .values({ name: CURSOR_NAME, position })
    .onConflictDoUpdate({
      target: itchScrapeCursors.name,
      set: { position, updatedAt: new Date() },
    });
}

/**
 * One probe. Transient failures get a single retry — `entries.json` has no
 * retry of its own, and a 429 anywhere in a 178k-request walk would otherwise
 * lose that id for good (the cursor only moves forward).
 */
async function probeJamId(jamId: number): Promise<ItchEntry[] | null> {
  try {
    return await fetchJamEntries(jamId);
  } catch (err) {
    console.warn(`[sweep] id=${jamId} probe failed (${describeError(err)}) — retrying once`);
    return await fetchJamEntries(jamId);
  }
}

export async function runIdSweep(gate?: StopGate): Promise<number> {
  const stopGate = gate ?? createStopGate("sweep", config.SWEEP_DEADLINE_MINS);

  // The frontier is whatever the corpus reaches today; new jams above it
  // arrive through the listings, and the cursor trails up behind them.
  const [bounds] = await db
    .select({ maxId: sql<number | null>`max(${itchJams.jamId})` })
    .from(itchJams);
  const heldRows = await db.select({ jamId: itchJams.jamId }).from(itchJams);
  const held = new Set(heldRows.map((r) => r.jamId));

  const range: SweepRange = {
    from: config.SWEEP_FROM,
    to: bounds?.maxId ?? 0,
    gapStart: config.SWEEP_GAP_START,
    gapEnd: config.SWEEP_GAP_END,
  };
  if (range.to <= 0) {
    console.log("[sweep] no jams persisted yet — nothing to sweep against");
    return 0;
  }

  const startAt = Math.max(await readCursor(), range.from);
  if (range.gapEnd > range.gapStart) {
    console.log(
      `[sweep] skipping ids ${range.gapStart}–${range.gapEnd} (barren band; set SWEEP_GAP_END=${range.gapStart} to sweep it)`,
    );
  }
  console.log(
    `[sweep] resuming at id=${startAt}, frontier=${range.to}, ${held.size} jams held, deadline ${config.SWEEP_DEADLINE_MINS}m`,
  );

  let probed = 0;
  let found = 0;
  let gone = 0;
  let failed = 0;
  let cursor = startAt;
  let stopped: string | null = null;

  for (;;) {
    const id = nextSweepId(cursor, held, range);
    if (id == null) {
      cursor = range.to + 1;
      break;
    }
    stopped = stopGate.reason();
    if (stopped) {
      cursor = id;
      break;
    }

    let entries: ItchEntry[] | null;
    try {
      entries = await probeJamId(id);
    } catch (err) {
      // Two failures on the same id: log it loudly and move on. Re-running with
      // SWEEP_FROM is how a bad stretch gets another pass.
      console.error(`[sweep] FAIL id=${id} ${describeError(err)}`);
      failed++;
      cursor = id + 1;
      continue;
    }
    probed++;
    cursor = id + 1;

    const slug = entries?.length ? slugFromRateUrl(entries[0]!.rateUrl) : null;
    if (slug && entries) {
      try {
        const outcome = await ingestJam(slug, { label: "sweep", entries });
        if (outcome === "gone") gone++;
        else {
          found++;
          held.add(id);
        }
      } catch (err) {
        console.error(`[sweep] FAIL ingest id=${id} slug=${slug} ${describeError(err)}`);
        failed++;
      }
    }

    // Cheap relative to the requests either side of it, and it bounds how much
    // a killed process re-probes on the next tick.
    if (probed % 100 === 0) await writeCursor(cursor);
  }

  await writeCursor(cursor);
  const done = cursor > range.to;
  console.log(
    `[sweep] probed=${probed} found=${found} gone=${gone} failed=${failed}, cursor=${cursor}${
      stopped ? ` (stopped: ${stopped})` : ""
    }${done ? " — sweep complete through the frontier" : ""}`,
  );
  return failed;
}

if (import.meta.main) {
  await runTier("sweep", () => runIdSweep());
}

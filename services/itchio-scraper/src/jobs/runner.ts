import { createServiceTelemetry } from "../../../../src/lib/service-telemetry.ts";
import { pool } from "../db/client.ts";
import { describeError } from "../http.ts";
import { syncJam } from "./sync-jam.ts";

/**
 * Shared scaffolding for the cron tiers (live / discovery / results).
 *
 * Every tier wants the same three things and used to hand-roll all of them:
 * finish the jam in flight when the platform sends SIGTERM, stop before the
 * next tick would overlap this one, and tear the pool down exactly once so a
 * finished run actually exits.
 */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type StopGate = {
  /** The reason to stop now, or null to keep going. */
  reason(): string | null;
};

type StopGateOptions = {
  // Injectable for tests; default to real time and real signals.
  now?: () => number;
  watchSignals?: boolean;
};

/**
 * Signal- and deadline-aware stop condition.
 *
 * The deadline is what keeps tiers from colliding. Railway skips a cron tick
 * while the previous run of *that service* is still going, so a slow tier
 * starves only itself — but three services now share one itch.io rate budget,
 * and a live run that overruns its hour lands on top of the next discovery
 * tick. Bounding each run keeps the stagger in the cron schedules meaningful.
 *
 * Work is never lost by stopping early: every tier's progress is persisted
 * (`scraped_at`, `results_fetched_at`), so the next tick resumes from it.
 */
export function createStopGate(
  label: string,
  deadlineMins: number,
  opts: StopGateOptions = {},
): StopGate {
  const now = opts.now ?? Date.now;
  let signalled = false;
  const deadlineAt = now() + deadlineMins * 60_000;

  if (opts.watchSignals ?? true) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        // A second signal means someone wants it dead now, not politely.
        if (signalled) process.exit(130);
        signalled = true;
        console.log(`[${label}] ${signal} — finishing current jam, then exiting`);
      });
    }
  }

  return {
    reason() {
      if (signalled) return "interrupted";
      if (now() > deadlineAt) return `deadline (${deadlineMins}m)`;
      return null;
    },
  };
}

export type SyncOutcome = {
  done: number;
  failed: number;
  /** Empty while the whole list was worked; otherwise why it stopped short. */
  stoppedEarly: string;
};

type SyncSlugsOptions = {
  delayMs: number;
  gate: StopGate;
  // Injectable for tests; defaults to the real per-jam sync.
  sync?: (slug: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Syncs a list of slugs in order, with a politeness gap between jams, counting
 * failures rather than aborting on the first one. A single jam that 500s or
 * whose HTML changed shape must not cost the rest of the tick.
 *
 * Whatever failed gets one more attempt once the list is worked. Nearly every
 * failure is itch rate-limiting a jam that would have gone through fine a
 * minute later, and by the end of the list the pacer has long since cooled
 * down — so the retry costs one extra request per failure and usually clears
 * the whole set. Anything still failing after it is left for the next tick.
 */
export async function syncSlugs(
  label: string,
  slugs: readonly string[],
  opts: SyncSlugsOptions,
): Promise<SyncOutcome> {
  const sync = opts.sync ?? syncJam;
  const doSleep = opts.sleep ?? sleep;

  const pass = async (list: readonly string[]) => {
    let done = 0;
    const failed: string[] = [];
    let stoppedEarly = "";

    for (const slug of list) {
      const stop = opts.gate.reason();
      if (stop) {
        stoppedEarly = stop;
        break;
      }
      try {
        await sync(slug);
        done += 1;
      } catch (err) {
        failed.push(slug);
        console.error(`[${label}] FAIL ${slug}: ${describeError(err)}`);
      }
      if (opts.delayMs > 0) await doSleep(opts.delayMs);
    }

    return { done, failed, stoppedEarly };
  };

  const first = await pass(slugs);
  // No retry once the gate has tripped: there is no budget left to spend, and
  // the next tick resumes from the same persisted progress anyway.
  if (first.failed.length === 0 || first.stoppedEarly) {
    return { done: first.done, failed: first.failed.length, stoppedEarly: first.stoppedEarly };
  }

  console.log(`[${label}] retrying ${first.failed.length} failed jam(s)`);
  const retry = await pass(first.failed);

  return {
    done: first.done + retry.done,
    // Everything that failed the first time, minus what the retry recovered —
    // correct even when the gate cuts the retry pass short.
    failed: first.failed.length - retry.done,
    stoppedEarly: retry.stoppedEarly,
  };
}

/**
 * Runs a tier's main function as a one-shot cron process: times it and closes
 * the pool.
 *
 * `main` returns the number of failures (0 for a clean run), which is reported
 * but deliberately does *not* fail the process. A handful of jams itch refused
 * — after the retry pass has already had a go at them — is the normal steady
 * state, not a broken tick: the work is resumable, so the next tick picks them
 * up. Exiting non-zero for it only made every Railway run red, which is worse
 * than no signal at all. A thrown error still exits 1: that means the tick
 * couldn't run, which is a real alert.
 */
export async function runTier(label: string, main: () => Promise<number>): Promise<void> {
  const telemetry = createServiceTelemetry("itchio-scraper");
  const started = Date.now();
  try {
    const failures = await main();
    const mins = ((Date.now() - started) / 60_000).toFixed(1);
    console.log(`[${label}] tick finished in ${mins}m — failures=${failures}`);
  } catch (err) {
    console.error(`[${label}] fatal: ${describeError(err)}`);
    telemetry.captureException(err, { tier: label });
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    // `process.exitCode` (not `exit()`) above, so the runtime drains this
    // before leaving — but only because the await is inside the finally.
    await telemetry.shutdown();
  }
}

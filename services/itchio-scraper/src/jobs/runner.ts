import { createServiceTelemetry } from "../../../../src/lib/service-telemetry.ts";
import { pool } from "../db/client.ts";
import { describeError, sleep } from "../http.ts";
import { closeQueue } from "../queue.ts";
import { disconnectRedis } from "../redis.ts";
import { syncJam } from "./sync-jam.ts";
import type { TierOutcome } from "./tier-loop.ts";

/**
 * Shared scaffolding for the tiers (live / discovery / results / library /
 * sweep). Every tier wants the same things and used to hand-roll them:
 * finish the jam in flight when the platform sends SIGTERM, stop at a
 * deadline so work is chunked, and — for the one-shot dev entrypoints —
 * tear the pool down exactly once so a finished run actually exits.
 *
 * In production the tiers run inside the crawler's loop (tier-loop.ts),
 * which hands each one a gate; `runTier` is the local `bun run live` path.
 */

export { sleep };
export type { TierOutcome };

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
 * The deadline is what chunks a tier's work: inside the crawler loop it is
 * one turn, and a tier that stops at it resumes on a later turn unless
 * something more urgent is due. Work is never lost by stopping early: every
 * tier's progress is persisted (`scraped_at`, `results_fetched_at`, the
 * sweep cursor), so the next turn resumes from it.
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
 * Runs a tier's main function as a one-shot process — the local dev
 * entrypoint (`bun run live`): times it and closes the pool.
 *
 * `main` reports its failures (0 for a clean run), which is logged but
 * deliberately does *not* fail the process. A handful of jams itch refused
 * — after the retry pass has already had a go at them — is the normal steady
 * state, not a broken run: the work is resumable, so the next run picks them
 * up. A thrown error still exits 1: that means the run couldn't happen,
 * which is a real alert.
 */
export async function runTier(
  label: string,
  main: () => Promise<number | TierOutcome>,
): Promise<void> {
  const telemetry = createServiceTelemetry("itchio-scraper");
  const started = Date.now();
  try {
    const out = await main();
    const outcome: TierOutcome = typeof out === "number" ? { failed: out, complete: true } : out;
    const mins = ((Date.now() - started) / 60_000).toFixed(1);
    console.log(
      `[${label}] run finished in ${mins}m — failures=${outcome.failed}${outcome.complete ? "" : " (stopped early)"}`,
    );
  } catch (err) {
    console.error(`[${label}] fatal: ${describeError(err)}`);
    telemetry.captureException(err, { tier: label });
    process.exitCode = 1;
  } finally {
    await closeQueue();
    disconnectRedis();
    await pool.end().catch(() => {});
    // `process.exitCode` (not `exit()`) above, so the runtime drains this
    // before leaving — but only because the await is inside the finally.
    await telemetry.shutdown();
  }
}

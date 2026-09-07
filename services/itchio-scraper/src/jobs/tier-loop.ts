import type { StopGate } from "./runner.ts";

/**
 * The crawler's scheduler (plan 27 phase 4): every scrape tier as an entry
 * in one priority loop, in one resident process, instead of one cron
 * service each coordinated by minute offsets.
 *
 * Each tier has a priority, an interval, and a persisted `nextRunAt`. The
 * loop picks the highest-priority tier that is due and runs it under a
 * gate whose deadline is a *chunk* rather than a slot; on return the tier
 * is either re-armed (it finished its list: `nextRunAt = now + interval`)
 * or left due (it stopped at the chunk: it continues next turn, unless
 * something higher-priority is due first). Chunking is what makes live's
 * short interval honest: results can hold a four-hour backlog and never
 * delay live by more than one chunk.
 *
 * Pure — clock, sleep, and persistence are injected — so the preemption
 * and re-arm rules are tested without a tier that does anything.
 */

export type TierOutcome = {
  failed: number;
  /** True when the tier worked its whole list; false when the gate cut it. */
  complete: boolean;
};

export type Tier = {
  name: string;
  /** Lower runs first among due tiers. */
  priority: number;
  intervalMs: number;
  run(gate: StopGate): Promise<TierOutcome>;
};

export type TierStatus = {
  nextRunAt: Date | null;
  lastStartedAt?: Date;
  lastOkAt?: Date;
  lastError?: string | null;
};

export type TierLoopOptions = {
  tiers: readonly Tier[];
  /** The deadline each turn runs under; a tier that outlives it stays due. */
  chunkMs: number;
  /** Trips on SIGTERM; the loop exits after the tier in flight returns. */
  stop: StopGate;
  /** Persisted schedule from the last run; missing tiers are due now. */
  load(): Promise<Map<string, TierStatus>>;
  save(name: string, status: TierStatus): Promise<void>;
  /** A tier that threw is retried after this long, not immediately. */
  errorBackoffMs?: number;
  /** Idle sleep between turns is capped here so a signal is noticed. */
  maxIdleMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Builds the per-turn deadline gate; combined with `stop` by the loop. */
  chunkGate: (ms: number) => StopGate;
};

/** The reason a turn's gate trips: the signal first, then the chunk deadline. */
export function combineGates(...gates: readonly StopGate[]): StopGate {
  return {
    reason() {
      for (const gate of gates) {
        const reason = gate.reason();
        if (reason) return reason;
      }
      return null;
    },
  };
}

/** Among due tiers, the one to run: lowest priority number wins. */
export function pickDueTier(
  tiers: readonly Tier[],
  nextRunAt: ReadonlyMap<string, number>,
  now: number,
): Tier | null {
  let best: Tier | null = null;
  for (const tier of tiers) {
    const due = nextRunAt.get(tier.name) ?? 0;
    if (due > now) continue;
    if (!best || tier.priority < best.priority) best = tier;
  }
  return best;
}

export async function runTierLoop(opts: TierLoopOptions): Promise<void> {
  const now = opts.now ?? Date.now;
  const doSleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const errorBackoffMs = opts.errorBackoffMs ?? 5 * 60_000;
  const maxIdleMs = opts.maxIdleMs ?? 30_000;

  const persisted = await opts.load();
  const nextRunAt = new Map<string, number>();
  for (const tier of opts.tiers) {
    nextRunAt.set(tier.name, persisted.get(tier.name)?.nextRunAt?.getTime() ?? 0);
  }

  while (!opts.stop.reason()) {
    const t = now();
    const tier = pickDueTier(opts.tiers, nextRunAt, t);
    if (!tier) {
      const soonest = Math.min(...[...nextRunAt.values()]);
      await doSleep(Math.max(0, Math.min(soonest - t, maxIdleMs)));
      continue;
    }

    const startedAt = new Date(t);
    const gate = combineGates(opts.stop, opts.chunkGate(opts.chunkMs));
    let outcome: TierOutcome | null = null;
    let error: string | null = null;
    try {
      outcome = await tier.run(gate);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const finishedAt = now();
    let next: number;
    if (error != null) {
      next = finishedAt + errorBackoffMs;
      console.error(`[loop] ${tier.name} threw: ${error} — retrying in ${errorBackoffMs / 1000}s`);
    } else if (outcome?.complete) {
      next = finishedAt + tier.intervalMs;
    } else {
      // Stopped at the chunk (or the signal): still due. A higher-priority
      // tier that became due meanwhile runs first; otherwise this one
      // continues on the very next turn.
      next = finishedAt;
    }
    nextRunAt.set(tier.name, next);
    await opts.save(tier.name, {
      nextRunAt: new Date(next),
      lastStartedAt: startedAt,
      ...(error == null
        ? { lastOkAt: new Date(finishedAt), lastError: null }
        : { lastError: error }),
    });
  }
}

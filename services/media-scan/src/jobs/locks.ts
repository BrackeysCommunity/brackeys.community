import type { PoolClient } from "pg";

import { pool } from "../db/client.ts";
import { sleep } from "../http.ts";

/**
 * Per-jam exclusion for entry scans. The near matcher's comparison pool
 * must hold a jam's predecessors, so a jam's entries are scanned one at a
 * time — across this process's concurrent jobs (an in-memory mutex) and
 * across processes (a Postgres advisory lock on the shared DB, the same
 * namespace the multi-instance backfill used, released with the session if
 * the process dies).
 */

/** Advisory-lock namespace for jam claims ("SCAN" in ASCII). */
const JAM_LOCK_NS = 0x53_43_41_4e;

const LOCK_POLL_MS = 2_000;
const LOCK_WAIT_MS = 120_000;

// One dedicated session owns every advisory lock this process takes.
// Session-scoped locks must not hop pool connections between queries.
let lockSession: Promise<PoolClient> | null = null;

function session(): Promise<PoolClient> {
  lockSession ??= pool.connect();
  return lockSession;
}

const inProcess = new Map<number, Promise<void>>();

export class JamBusyError extends Error {
  constructor(jamId: number) {
    super(`jam ${jamId} is being scanned by another instance`);
    this.name = "JamBusyError";
  }
}

async function tryClaimJam(jamId: number): Promise<boolean> {
  const res = await (
    await session()
  ).query<{ locked: boolean }>("select pg_try_advisory_lock($1, $2) as locked", [
    JAM_LOCK_NS,
    jamId,
  ]);
  return res.rows[0]?.locked === true;
}

async function releaseJam(jamId: number): Promise<void> {
  await (await session()).query("select pg_advisory_unlock($1, $2)", [JAM_LOCK_NS, jamId]);
}

/**
 * Runs `fn` holding the jam. Waits a bounded time for another instance to
 * finish with it, then throws `JamBusyError` so bullmq retries the job
 * later rather than blocking a worker slot indefinitely.
 */
export async function withJamLock<T>(jamId: number, fn: () => Promise<T>): Promise<T> {
  // Serialize within the process first: a second job for the same jam
  // would otherwise take the session-level advisory lock re-entrantly.
  while (inProcess.has(jamId)) await inProcess.get(jamId);
  let release!: () => void;
  inProcess.set(
    jamId,
    new Promise<void>((r) => {
      release = r;
    }),
  );
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (!(await tryClaimJam(jamId))) {
      if (Date.now() > deadline) throw new JamBusyError(jamId);
      await sleep(LOCK_POLL_MS);
    }
    try {
      return await fn();
    } finally {
      await releaseJam(jamId).catch(() => {});
    }
  } finally {
    inProcess.delete(jamId);
    release();
  }
}

export async function closeLocks(): Promise<void> {
  if (!lockSession) return;
  const client = await lockSession.catch(() => null);
  client?.release();
  lockSession = null;
}

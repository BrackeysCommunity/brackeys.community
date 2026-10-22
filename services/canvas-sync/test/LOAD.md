# canvas-sync load runs

`bun run test/load.ts` (needs `CANVAS_SYNC_TEST_DATABASE_URL`; `N` peers, default 50,
`SECS` window, default 15). One 2,000-card canvas; every peer but one sends pointer
awareness at 25 Hz and drags its own card at 5 Hz; a probe write every 100ms measures
edit latency to the last peer. The service runs in its own process
(`test/load-server.ts`) and reports its metrics for the window over HTTP.

Budgets from the plan: event-loop lag p99 under 20ms; build the snapshot worker only
if store CPU (the merge) goes over 15ms on real canvases.

## 2026-10-22, MacBook Pro (Apple silicon), scratch Postgres 16 on the same machine

**Caveat:** both runs were on a heavily shared machine (load average 31–42 from
other test suites running in parallel), so they bound the worst case rather than
measure the service. Re-run on an idle machine or against staging before deciding
on the worker.

| Run | Peers | Window | Messages/s | Edit latency p50 / p99 | Lag p99 | Merge p99 | Snapshot p99 | Store p99 (incl. DB) | Stored bytes |
| --- | ----- | ------ | ---------- | ---------------------- | ------- | --------- | ------------ | -------------------- | ------------ |
| A   | 50    | 25s    | 1,373      | 3.4ms / 60ms           | 13.9ms  | 42ms      | (none due)   | 104ms                | 530 KB       |
| B   | 50    | 45s    | 694        | 18ms / 1,118ms         | 118ms   | 297ms     | 319ms        | 1,093ms              | 531 KB       |

In run B the load generator itself fell behind (half the expected message rate), so
the box was saturated; run A is closer to what the service does on its own.

What changed after the first measurement: the store originally decoded the stored
state and the live state into a scratch doc (two full decodes of ~530 KB per store);
it now folds only what's stored and missing (`Y.diffUpdate` against the live doc's
state vector) into the live doc and encodes it once. On the same machine that cut
merge time from 100–350ms to ~13ms p50 in a micro-benchmark.

**Reading:** relay lag is inside budget when the machine isn't saturated (A). The
merge and the 30s snapshot of a 2,000-card, 530 KB canvas are both above the 15ms
worker trigger on this hardware under contention. The worker (plan's
`snapshot-worker.ts`) is out of scope for this slice; decide after a clean
measurement.

import type { ServiceTelemetry } from "../../../src/lib/service-telemetry.ts";
import type { RefusalReason } from "./limits.ts";

const MAX_SAMPLES = 5_000;

function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

const round = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

/**
 * Counters for one reporting window, reset on each report. Store and
 * snapshot timings are what decides whether the merge ever needs to move
 * off the relay loop into a worker; event-loop lag is what members feel.
 */
export class SyncMetrics {
  messages = 0;
  stores = 0;
  storeFailures = 0;
  storesRefused = 0;
  revocations = 0;
  applies = 0;
  storeMs: number[] = [];
  mergeMs: number[] = [];
  snapshotMs: number[] = [];
  mergeBytes: number[] = [];
  lagMs: number[] = [];
  refusals: Record<RefusalReason, number> = { auth: 0, size: 0, rate: 0, caps: 0 };

  private push(list: number[], value: number) {
    list.push(value);
    if (list.length > MAX_SAMPLES) list.shift();
  }

  store(ms: number, mergeMs: number, bytes: number) {
    this.stores++;
    this.push(this.storeMs, ms);
    this.push(this.mergeMs, mergeMs);
    this.push(this.mergeBytes, bytes);
  }

  snapshot(ms: number) {
    this.push(this.snapshotMs, ms);
  }

  lag(ms: number) {
    this.push(this.lagMs, ms);
  }

  refused(reason: RefusalReason) {
    this.refusals[reason]++;
  }

  /** The window as event properties, then a fresh window. */
  drain(windowMs: number, gauges: { documents: number; connections: number }) {
    const out = {
      ...gauges,
      messages_per_s: Math.round((this.messages / windowMs) * 1000 * 10) / 10,
      stores: this.stores,
      store_failures: this.storeFailures,
      stores_refused: this.storesRefused,
      store_p50_ms: round(percentile(this.storeMs, 0.5)),
      store_p99_ms: round(percentile(this.storeMs, 0.99)),
      merge_p99_ms: round(percentile(this.mergeMs, 0.99)),
      snapshot_p99_ms: round(percentile(this.snapshotMs, 0.99)),
      merge_bytes_max: this.mergeBytes.length ? Math.max(...this.mergeBytes) : null,
      revocations: this.revocations,
      applies: this.applies,
      refused_auth: this.refusals.auth,
      refused_size: this.refusals.size,
      refused_rate: this.refusals.rate,
      refused_caps: this.refusals.caps,
      event_loop_lag_p99_ms: round(percentile(this.lagMs, 0.99)),
      rss_mb: Math.round(process.memoryUsage().rss / 1e6),
    };
    Object.assign(this, new SyncMetrics());
    return out;
  }
}

/** Samples event-loop lag: how late a short timer fires. */
export function sampleEventLoopLag(metrics: SyncMetrics, intervalMs = 50): () => void {
  let expected = performance.now() + intervalMs;
  const timer = setInterval(() => {
    const now = performance.now();
    metrics.lag(Math.max(0, now - expected));
    expected = now + intervalMs;
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Once a minute: one `canvas_sync_metrics` event and one log line. */
export function reportMetrics(
  metrics: SyncMetrics,
  telemetry: ServiceTelemetry,
  gauges: () => { documents: number; connections: number },
  windowMs = 60_000,
): () => void {
  const timer = setInterval(() => {
    const properties = metrics.drain(windowMs, gauges());
    telemetry.capture("canvas_sync_metrics", properties);
    console.log(`[metrics] ${JSON.stringify(properties)}`);
  }, windowMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

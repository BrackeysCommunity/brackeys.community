import { PostHog } from "posthog-node";

/**
 * Error reporting for the standalone Bun services (`services/*`).
 *
 * Lives at the repo root rather than in each service because they already
 * share code this way (`../../../src/lib/…`), and because the import
 * resolves `posthog-node` from the root's `node_modules` — so none of the
 * four services needs the dependency, or a lockfile change, of its own.
 *
 * Separate from `@/lib/posthog-server` on purpose. That one is the web
 * app's: it hardcodes a distinct id, and its process handlers `exit(1)` on
 * an unhandled rejection, which is right for a long-lived HTTP server and
 * wrong for a cron job that is legitimately about to exit anyway.
 *
 * ## The one rule
 *
 * **`await shutdown()` before the process exits.** posthog-node batches, so
 * a cron-style service that exits without draining sends nothing at all —
 * and reports no error while doing it. That failure is invisible: the
 * integration looks installed and is silently inert. Every call site below
 * puts the `shutdown()` in a `finally`.
 */

/**
 * Reads `POSTHOG_KEY` first so a service's own variables can be named
 * without a `VITE_` prefix it has no use for, and falls back to
 * `VITE_POSTHOG_KEY` so a Railway shared variable can cover the web app and
 * the services under one name. Same for the host.
 */
const KEY = process.env.POSTHOG_KEY ?? process.env.VITE_POSTHOG_KEY;
const HOST =
  process.env.POSTHOG_HOST ?? process.env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export interface ServiceTelemetry {
  /** Report a failure. Never throws — reporting must not break the job. */
  captureException(error: unknown, properties?: Record<string, unknown>): void;
  /** Drain the queue. Safe to call when unconfigured, and safe to call twice. */
  shutdown(): Promise<void>;
}

/**
 * @param service the Railway service name — becomes the distinct id. These
 *   events belong to a process, not a person, so they are deliberately not
 *   user-attributed even when a job is acting on one user's data.
 */
export function createServiceTelemetry(service: string): ServiceTelemetry {
  if (!KEY) {
    // Unconfigured: hand back no-ops so call sites stay unconditional and a
    // key-less deploy behaves exactly as it did before this existed.
    return { captureException: () => {}, shutdown: async () => {} };
  }

  const client = new PostHog(KEY, { host: HOST });

  return {
    captureException(error, properties) {
      try {
        client.captureException(error, service, { service, ...properties });
      } catch (reportingError) {
        console.error(`[telemetry] failed to report from ${service}:`, reportingError);
      }
    },
    async shutdown() {
      // Bounded: a hung flush must not hold a finished cron job open past
      // its schedule, and the events are best-effort by nature.
      await client.shutdown(5000).catch((error: unknown) => {
        console.error(`[telemetry] shutdown failed for ${service}:`, error);
      });
    },
  };
}

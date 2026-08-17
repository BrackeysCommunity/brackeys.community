import { PostHog } from "posthog-node";

import type { AnalyticsEvent } from "@/lib/analytics-events";

/**
 * Server-side PostHog — lifecycle events and unhandled error reporting.
 *
 * **Server only.** Importing this from anything that reaches the browser
 * bundle drags posthog-node in with it; the client counterpart is
 * `@/lib/posthog`.
 *
 * Reads the same public project key as the browser (`VITE_POSTHOG_KEY`) via
 * `process.env` rather than `@/env`, because the client-block accessor is
 * typed for browser use. With no key, every export here is an explicit
 * no-op and the process handlers are never installed — so a key-less
 * deployment behaves exactly as it did before PostHog existed.
 */

const HOST = process.env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com";

/**
 * Distinct id for events that belong to the server rather than to a person.
 * Server captures are deliberately not user-attributed: the handler-level
 * interceptors only see the pre-middleware context, so a user id would mean
 * a session lookup on the error path.
 */
const SERVER_DISTINCT_ID = "brackeys-web";

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;

  const key = process.env.VITE_POSTHOG_KEY;
  if (!key) {
    client = null;
    return null;
  }

  client = new PostHog(key, { host: HOST });
  installProcessHandlers(client);
  return client;
}

let handlersInstalled = false;

/**
 * Replaces what `instrument.server.mjs` used to do. Both handlers preserve
 * Node's default outcome — the process still dies with a non-zero code —
 * they just get the report out first. Registering them at all suppresses
 * that default, so the stderr print is done by hand.
 */
function installProcessHandlers(posthog: PostHog) {
  if (handlersInstalled || typeof process === "undefined") return;
  handlersInstalled = true;

  const die = async (error: unknown, kind: string) => {
    console.error(`[posthog] ${kind}:`, error);
    try {
      posthog.captureException(error, SERVER_DISTINCT_ID, { source: kind });
      // Short timeout: the process is going down either way, and a hung
      // flush would hold it open past any supervisor's patience.
      await posthog.shutdown(2000);
    } catch (flushError) {
      console.error("[posthog] failed to report fatal error:", flushError);
    }
    process.exit(1);
  };

  process.on("uncaughtException", (error) => void die(error, "uncaughtException"));
  process.on("unhandledRejection", (reason) => void die(reason, "unhandledRejection"));
}

/**
 * Fire-and-forget; batched and flushed by posthog-node. Restricted to the
 * taxonomy in `@/lib/analytics-events` for the same reason as its browser
 * counterpart.
 *
 * `distinctId` must be the user id — the same value the browser passes to
 * `identify()` — or the event won't join the client-side half of a funnel.
 */
export function captureServerEvent(
  event: AnalyticsEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
) {
  getClient()?.capture({ distinctId, event, properties });
}

export function captureServerException(error: unknown, properties?: Record<string, unknown>) {
  getClient()?.captureException(error, SERVER_DISTINCT_ID, properties);
}

/**
 * Wrap a server route handler so an unhandled throw is reported before it
 * becomes an opaque 500. For the routes that sit outside oRPC — the
 * better-auth mount, image streaming, the unsubscribe link — where nothing
 * else is watching.
 *
 * Rethrows: this observes, it does not swallow. Note it can only see throws
 * that happen before the response is returned, so a stream that fails
 * mid-flight (the notification SSE route) is still outside its reach.
 */
export function withErrorReporting<TArgs extends { request: Request }, TResult>(
  route: string,
  handler: (args: TArgs) => TResult | Promise<TResult>,
) {
  return async (args: TArgs): Promise<TResult> => {
    try {
      return await handler(args);
    } catch (error) {
      captureServerException(error, { route, method: args.request.method });
      throw error;
    }
  };
}

/**
 * Drain the queue. The Nitro server is long-lived so this rarely matters
 * there, but anything short-lived that imports this module must await it or
 * lose its events.
 */
export async function shutdownServerAnalytics() {
  await client?.shutdown();
}

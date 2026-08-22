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
 * Common properties on every server capture, mirroring the browser's
 * `posthog.register({ app_version })`: without them a server error can't be
 * bisected across a deploy, and staging noise is indistinguishable from prod.
 * `__APP_VERSION__` is a Vite define, so it exists in the built server bundle
 * but not under a bare runtime — hence the `typeof` guard. The environment
 * name is Railway's own (`production` / `staging`); absent means local dev.
 */
const COMMON_PROPS: Record<string, unknown> = {
  app_version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? "development",
};

/**
 * Distinct id for events that belong to the server rather than to a person.
 * Exception captures stay under this id — attribution, where a caller has it,
 * is a `user_id` *property* (filterable, answers "one user or everyone?")
 * rather than the distinct id, so server errors never mint person profiles.
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
      posthog.captureException(error, SERVER_DISTINCT_ID, { ...COMMON_PROPS, source: kind });
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
  getClient()?.capture({ distinctId, event, properties: { ...COMMON_PROPS, ...properties } });
}

export function captureServerException(error: unknown, properties?: Record<string, unknown>) {
  getClient()?.captureException(error, SERVER_DISTINCT_ID, { ...COMMON_PROPS, ...properties });
}

/**
 * Run a side-effect that must not fail its caller — a notification fan-out
 * after a write landed, an audit-log line, storage cleanup — and report the
 * failure instead of only `console.warn`ing it. This replaces the
 * fire-and-forget `.catch(console.warn)` pattern that left ~25 server legs
 * dark: protected, but invisible when they broke.
 *
 * Resolves `undefined` on failure so callers that need the result can
 * `?? fallback` it; fire-and-forget callers just `void bestEffort(...)`.
 * `scope` follows the same `area.action` convention as the client's
 * `reportMutationError`; `ctx` carries the entity ids that make the report
 * actionable.
 */
export async function bestEffort<T>(
  scope: string,
  ctx: Record<string, unknown>,
  fn: () => T | Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[${scope}] best-effort step failed`, { ...ctx, err });
    captureServerException(err, { scope, ...ctx });
    return undefined;
  }
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
 *
 * `route` is the route pattern (`/og/$`); the resolved pathname rides along
 * so the report says *which* card or image failed. The session read is on
 * the error path only — errors are rare, one DB hit is fine — and lazy
 * because `@/lib/auth` imports this module.
 */
export function withErrorReporting<TArgs extends { request: Request }, TResult>(
  route: string,
  handler: (args: TArgs) => TResult | Promise<TResult>,
) {
  return async (args: TArgs): Promise<TResult> => {
    try {
      return await handler(args);
    } catch (error) {
      let path: string | undefined;
      try {
        path = new URL(args.request.url).pathname;
      } catch {
        // Unparseable URL — the route pattern still identifies the surface.
      }
      let userId: string | undefined;
      try {
        const { auth } = await import("@/lib/auth");
        const session = await auth.api.getSession({ headers: args.request.headers });
        userId = session?.user.id;
      } catch {
        // Session unreadable (or the failure *is* the auth mount) — report anonymously.
      }
      captureServerException(error, {
        route,
        path,
        method: args.request.method,
        user_id: userId,
      });
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

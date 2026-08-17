import posthog from "posthog-js";

import { env } from "@/env";
import type { AnalyticsEvent } from "@/lib/analytics-events";

/**
 * Browser-side PostHog: product analytics, feature flags, and error tracking.
 *
 * Runs **cookieless** (`cookieless_mode: "always"`) — nothing is written to
 * cookies, localStorage, or sessionStorage, and visitor identity is a
 * privacy-preserving hash PostHog computes server-side and rotates daily.
 * That is what lets the app ship without a consent banner; it also means an
 * anonymous visitor looks like a new one every 24h, so treat unique-visitor
 * counts as approximate.
 *
 * ⚠️ Cookieless mode must **also** be switched on in the PostHog project
 * settings. Until it is, every event this sends is dropped at ingestion.
 *
 * The posthog-js singleton no-ops on every method until `init` runs, so with
 * no key configured (local dev, forks) nothing here needs a second guard:
 * captures are dropped and `useFlag` falls back to `src/lib/flags.ts`.
 *
 * ## On bundle size — measured, don't re-litigate
 *
 * This lands as a ~236 KB (81 KB gzipped) chunk on the critical path, which
 * invites the obvious idea: posthog-js publishes a `dist/module.slim` entry
 * that registers none of its 18 extensions and takes only the ones you name
 * via `__extensionClasses`. It was tried at 1.417.2 and came out **worse**
 * (248 KB), because the classes are only reachable through
 * `dist/extension-bundles`, a 136 KB prebuilt module with every extension
 * inlined — and posthog-js declares no `sideEffects: false`, so a bundler
 * must keep all of it. Slim core plus that bundle exceeds the default entry.
 *
 * The default entry is already the middle tier: the genuinely heavy pieces
 * (the replay recorder, survey UI) are lazy-loaded from the CDN at runtime
 * rather than bundled. Revisit only if posthog-js ships per-extension entry
 * points or marks itself side-effect-free.
 */

/**
 * Our own opt-out record. PostHog normally persists this itself, but
 * cookieless mode leaves it with memory-only persistence, so the choice has
 * to survive a reload somewhere.
 *
 * Both states are written, not just the off one: an absent key has to mean
 * "this visitor has not chosen", so that Global Privacy Control can supply
 * the default and an explicit opt-in can override it. A pre-existing `off`
 * still reads as opted out, so nobody's earlier choice is lost.
 */
const OPT_OUT_KEY = "brackeys-analytics";

function storedChoice(): "on" | "off" | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(OPT_OUT_KEY);
    return stored === "on" || stored === "off" ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Whether the browser is sending Global Privacy Control. We treat it as an
 * opt-out the visitor has already made elsewhere, which is what the spec
 * asks for; an explicit choice in Settings still wins over it in either
 * direction, since that is the more specific signal from the same person.
 */
export function globalPrivacyControlEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

/**
 * `off-gpc` is kept distinct from `off` so the settings toggle can say *why*
 * it is off without asking a second question — and because the distinction
 * is real: a browser signal is a default we honour, an explicit `off` is a
 * decision that outlives the signal being switched off again.
 */
export type AnalyticsPreference = "on" | "off" | "off-gpc";

export function analyticsPreference(): AnalyticsPreference {
  const choice = storedChoice();
  if (choice !== null) return choice;
  return globalPrivacyControlEnabled() ? "off-gpc" : "on";
}

/**
 * What the server must assume, and therefore what hydration starts from:
 * the preference lives in device storage and in a browser API, neither of
 * which the server can see. Opted in is the default state, so this is the
 * honest guess — a visitor who is actually opted out sees the switch
 * correct itself on hydration rather than a hydration mismatch. Removing
 * the flicker would mean putting the preference in a cookie, which is the
 * one thing the cookie-free posture will not spend.
 */
export function analyticsPreferenceServerSnapshot(): AnalyticsPreference {
  return "on";
}

export function analyticsOptedOut(): boolean {
  return analyticsPreference() !== "on";
}

const preferenceListeners = new Set<() => void>();

/**
 * Subscription for `useSyncExternalStore`. Covers both this tab (via
 * `setAnalyticsEnabled`) and any other tab the visitor has open, since the
 * `storage` event is how the choice travels between them.
 */
export function subscribeAnalyticsPreference(onChange: () => void): () => void {
  preferenceListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    preferenceListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Flip capture on or off and remember the choice.
 *
 * Deliberately not `opt_in_capturing()` / `opt_out_capturing()`: those read
 * and write PostHog's own consent flags, and under cookieless mode those
 * flags are pinned (`has_opted_out_capturing()` answers `true` from startup
 * and neither call moves it), so they are not a switch we can steer. A
 * `before_send` returning `null` drops every event at the last hop, which
 * is documented behaviour and works the same in either mode.
 */
export function setAnalyticsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(OPT_OUT_KEY, enabled ? "on" : "off");
  } catch {
    // storage full or unavailable — the in-memory switch below still applies
  }
  for (const listener of preferenceListeners) listener();

  if (!enabled) {
    posthog.set_config({ before_send: () => null });
    return;
  }
  // An identity function rather than clearing the key: `set_config` merges,
  // so `undefined` is not reliably a removal.
  if (started) posthog.set_config({ before_send: (event) => event });
  else initAnalytics();
}

let started = false;

/**
 * Idempotent, browser-only. Called from `getRouter()` so it runs before the
 * first `onResolved` pageview rather than after the first paint.
 */
export function initAnalytics() {
  if (started || typeof window === "undefined" || !env.VITE_POSTHOG_KEY) return;
  // An opted-out browser doesn't load PostHog at all — no events, and no
  // flag request either, so `useFlag` serves the declared defaults. Stopping
  // short of any network call is the point of the switch; flags riding along
  // on it is the accepted cost.
  if (analyticsOptedOut()) return;
  started = true;

  posthog.init(env.VITE_POSTHOG_KEY, {
    api_host: env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    // Required as soon as `api_host` stops being a posthog.com domain — i.e.
    // the moment `VITE_POSTHOG_HOST` points at the reverse proxy
    // (`workers/posthog-proxy`). Without it the toolbar tries to reach the
    // PostHog UI through the ingestion path and breaks. Harmless when the
    // host is direct, so it is set unconditionally rather than left as a
    // step someone has to remember during the proxy cutover.
    ui_host: "https://eu.posthog.com",
    // Pinned rather than left to drift: it is the snapshot of every
    // default-behaviour breaking change, so bumping it is a decision.
    defaults: "2026-06-25",
    cookieless_mode: "always",
    // Anonymous traffic stays profile-less (and ~4x cheaper to ingest);
    // `identifyUser` upgrades a signed-in visitor for the tab's lifetime.
    person_profiles: "identified_only",
    // The router owns pageviews — autocapture's history heuristics don't
    // line up with view transitions and the custom scroll root. See
    // `src/router.tsx`. Pageleave is unconditional because its default
    // ("if_capture_pageview") would switch itself off alongside.
    capture_pageview: false,
    capture_pageleave: true,
    capture_exceptions: true,
    // Replay needs persistent storage to stitch a session together, so it
    // cannot work cookieless — say so rather than ship a recorder that
    // silently collects nothing.
    disable_session_recording: true,
  });

  // Ties events and error reports to a release. `__APP_VERSION__` is
  // `pkg.version+sha`, defined in vite.config.ts.
  posthog.register({ app_version: __APP_VERSION__ });
}

/**
 * Attach the signed-in user to subsequent events. Idempotent — PostHog
 * ignores a repeat `identify` for the same id, so calling it on every
 * session resolution is fine. Cookieless identity lives in memory only, so
 * this has to run again on each page load.
 */
export function identifyUser(user: { id: string; email?: string | null; name?: string | null }) {
  posthog.identify(user.id, {
    email: user.email ?? undefined,
    name: user.name ?? undefined,
  });
}

/**
 * Drop the identity on explicit sign-out, so the next person on a shared
 * device isn't attributed to the last one. Deliberately *not* called when a
 * session merely resolves as absent.
 */
export function resetIdentity() {
  posthog.reset();
}

/**
 * Capture a product event. Restricted to the taxonomy in
 * `@/lib/analytics-events` — a name invented at the call site is a type
 * error, which is what keeps the event list in PostHog browsable instead of
 * accumulating three spellings of the same thing.
 *
 * `$pageview` is admitted separately: it is PostHog's own reserved name, not
 * ours to rename.
 */
export function captureEvent(
  event: AnalyticsEvent | "$pageview",
  properties?: Record<string, unknown>,
) {
  posthog.capture(event, properties);
}

export function captureError(error: unknown, properties?: Record<string, unknown>) {
  posthog.captureException(error, properties);
}

export { posthog };

import { useEffect, useState, useSyncExternalStore } from "react";

import { FEATURE_FLAGS, type FeatureFlagKey } from "@/lib/flags";
import {
  getPostHogClientSnapshot,
  type PostHogClient,
  subscribePostHogClient,
} from "@/lib/product-insights";

/**
 * Not `@posthog/react`'s hooks: that package imports `posthog-js` at module
 * scope (`setDefaultPostHogInstance(posthogJs)` runs on import), so pulling
 * in its hooks would statically drag posthog-js back into the entry graph —
 * the exact cost `@/lib/product-insights` defers. This reads the same lazily-loaded
 * client through `@/lib/product-insights`'s module-level store instead of React
 * context, and tolerates the client being `null` (not yet loaded, or never
 * going to load) the way `@posthog/react` never has to.
 */
function usePostHogClient() {
  return useSyncExternalStore(subscribePostHogClient, getPostHogClientSnapshot, () => null);
}

/**
 * Read a boolean feature flag:
 *
 * ```tsx
 * if (useFlag("flag-smoke-test")) return <NewThing />;
 * ```
 *
 * Always a `boolean`, never a loading state — until PostHog answers (or
 * forever, when no key is configured, or before the client has even loaded)
 * the flag reads as its declared default in `@/lib/flags`, and the
 * component re-renders if the real value differs. So a flag defaulting to
 * `false` renders the old path first: gate on it, don't build a layout that
 * depends on the first render being correct.
 */
export function useFlag(flag: FeatureFlagKey): boolean {
  const client = usePostHogClient();
  const [enabled, setEnabled] = useState(() => client?.isFeatureEnabled(flag));

  // `onFeatureFlags` fires synchronously on subscribe when flags are already
  // loaded, so this alone covers both a client that resolved before this
  // effect ran and one that resolves later — no separate sync-on-mount call.
  useEffect(() => {
    if (!client) return;
    return client.onFeatureFlags(() => setEnabled(client.isFeatureEnabled(flag)));
  }, [client, flag]);

  return enabled ?? FEATURE_FLAGS[flag];
}

/**
 * The variant key of a multivariate flag, or `undefined` while it is
 * unresolved (including before the client has loaded). `true`/`false` come
 * back for a flag PostHog is serving as a plain boolean — use `useFlag` for
 * those.
 */
export function useFlagVariant(flag: FeatureFlagKey): string | boolean | undefined {
  const client = usePostHogClient();
  const [variant, setVariant] = useState(() => client?.getFeatureFlag(flag));

  useEffect(() => {
    if (!client) return;
    return client.onFeatureFlags(() => setVariant(client.getFeatureFlag(flag)));
  }, [client, flag]);

  return variant;
}

/**
 * Whether a flag is *affirmatively off*, as distinct from unresolved.
 *
 * `useFlag` collapses "PostHog said no" and "PostHog never answered" into
 * the same `false`, which is right for a flag that gates an enhancement and
 * wrong for one that gates access to a page. PostHog fails to answer far
 * more often than it looks: an ad blocker blocks `i.posthog.com` outright,
 * an analytics opt-out skips the flag request by design, Global Privacy
 * Control counts as an opt-out and Brave and DuckDuckGo send it by default,
 * and a dev machine with no `VITE_POSTHOG_KEY` never loads the client at
 * all. A page gated on `useFlag` is therefore permanently unreachable for a
 * large group of visitors, with nothing they can do about it.
 *
 * So: gate *discovery* on `useFlag`, which is conservative and only
 * advertises what has actually been switched on, and gate *access* on this,
 * which shuts a door only when someone deliberately shut it.
 *
 * The trade is that turning a flag off does not lock out a visitor whose
 * browser blocks PostHog. A flag is a rollout tool, not a permission — if
 * something must be unreachable, it needs a server-side check.
 */
export function useFlagBlocks(flag: FeatureFlagKey): boolean {
  return useFlagVariant(flag) === false;
}

/**
 * The JSON payload attached to a flag's matched variant, `undefined` when it
 * is unresolved or carries no payload. Payloads are author-controlled in the
 * PostHog UI and arrive unvalidated — parse before trusting the shape.
 */
function flagPayload(client: PostHogClient, flag: FeatureFlagKey) {
  return client.getFeatureFlagResult(flag, { send_event: false })?.payload;
}

export function useFlagPayload(flag: FeatureFlagKey): unknown {
  const client = usePostHogClient();
  // `client ? … : undefined`, not `client && …`: the latter yields `null`
  // before the client loads, and this hook's contract (and the
  // `@posthog/react` hook it replaced) is `undefined` for unresolved.
  const [payload, setPayload] = useState(() => (client ? flagPayload(client, flag) : undefined));

  useEffect(() => {
    if (!client) return;
    return client.onFeatureFlags(() => setPayload(flagPayload(client, flag)));
  }, [client, flag]);

  return payload;
}

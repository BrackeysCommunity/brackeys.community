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

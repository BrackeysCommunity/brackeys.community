import {
  useFeatureFlagEnabled,
  useFeatureFlagPayload,
  useFeatureFlagVariantKey,
} from "@posthog/react";

import { FEATURE_FLAGS, type FeatureFlagKey } from "@/lib/flags";

/**
 * Read a boolean feature flag:
 *
 * ```tsx
 * if (useFlag("flag-smoke-test")) return <NewThing />;
 * ```
 *
 * Always a `boolean`, never a loading state — until PostHog answers (or
 * forever, when no key is configured) the flag reads as its declared default
 * in `@/lib/flags`, and the component re-renders if the real value differs.
 * So a flag defaulting to `false` renders the old path first: gate on it,
 * don't build a layout that depends on the first render being correct.
 */
export function useFlag(flag: FeatureFlagKey): boolean {
  return useFeatureFlagEnabled(flag, FEATURE_FLAGS[flag]);
}

/**
 * The variant key of a multivariate flag, or `undefined` while it is
 * unresolved. `true`/`false` come back for a flag PostHog is serving as a
 * plain boolean — use `useFlag` for those.
 */
export function useFlagVariant(flag: FeatureFlagKey): string | boolean | undefined {
  return useFeatureFlagVariantKey(flag);
}

/**
 * The JSON payload attached to a flag's matched variant, `undefined` when it
 * is unresolved or carries no payload. Payloads are author-controlled in the
 * PostHog UI and arrive unvalidated — parse before trusting the shape.
 */
export function useFlagPayload(flag: FeatureFlagKey): unknown {
  return useFeatureFlagPayload(flag);
}

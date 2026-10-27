import { useSyncExternalStore } from "react";

import {
  type AnalyticsPreference,
  analyticsPreference,
  analyticsPreferenceServerSnapshot,
  subscribeAnalyticsPreference,
} from "@/lib/product-insights";

/**
 * The visitor's analytics choice. It lives in device storage and in a browser
 * API the server can't see, so hydration renders the server snapshot and then
 * swaps in the real value rather than mismatching for every opted-out
 * visitor. Also follows a change made in another tab.
 */
export function useAnalyticsPreference(): AnalyticsPreference {
  return useSyncExternalStore(
    subscribeAnalyticsPreference,
    analyticsPreference,
    analyticsPreferenceServerSnapshot,
  );
}

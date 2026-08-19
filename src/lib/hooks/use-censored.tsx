import { useCallback } from "react";

import { useOptionalAppSettings } from "@/lib/hooks/use-app-settings";
import { useIsHydrated } from "@/lib/hooks/use-is-hydrated";
import { censorText } from "@/lib/profanity";

/**
 * Whether prose should render censored for this viewer.
 *
 * The preference lives in `localStorage`, which the server can't read, and
 * censoring changes the text — so an opted-out viewer would hydrate into a
 * mismatch if the first client render trusted the stored value. It ships
 * on, so the server render and the first client render both censor, and
 * the opt-out swaps in on mount. That way the safe answer is the one in
 * the SSR payload and nobody sees uncensored text they asked not to.
 *
 * Outside the settings provider it falls back to the shipped default
 * rather than throwing: prose renders in subtrees the provider doesn't
 * reach, and a cosmetic preference is no reason to take one down.
 */
export function useCensorProfanity(): boolean {
  const settings = useOptionalAppSettings();
  const hydrated = useIsHydrated();
  return hydrated ? (settings?.censorProfanity ?? true) : true;
}

/** One string, censored for viewers who asked for it. Identity when they
 * didn't, or when the text is clean — safe to pass straight into a memo. */
export function useCensored<T extends string | null | undefined>(text: T): T {
  const active = useCensorProfanity();
  return active ? censorText(text) : text;
}

/**
 * The censor as a function, for the callers that need it inside a `map`
 * or a `useMemo` where `useCensored` can't be called per item.
 * Referentially stable while the preference is.
 */
export function useCensorFn(): (text: string) => string {
  const active = useCensorProfanity();
  return useCallback((text: string) => (active ? censorText(text) : text), [active]);
}

/**
 * Prose inside a list, where a hook per row isn't available. Renders the
 * string and nothing else, so it drops into any `Text` or heading.
 */
export function Censored({ children }: { children: string | null | undefined }) {
  const text = useCensored(children);
  return <>{text ?? null}</>;
}

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a media query.
 *
 * Reach for this only where the two layouts differ in more than
 * visibility — where one side mounts components the other must not, or
 * answers to keys the other doesn't. Anything that is purely a matter of
 * what's shown belongs in `md:`/`lg:` classes, which don't cost a render.
 *
 * Renders `false` on the server and for the first client paint, so the
 * narrow layout is the one that has to survive being wrong for a frame.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

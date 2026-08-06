import { useEffect, useState } from "react";

/**
 * The value, but only after it has stopped changing for `delayMs`.
 *
 * Every server-backed search box on the site needs this — the jams
 * section's toolbar and the jam page's submissions grid both query tables
 * far too large to hit per keystroke. It lived privately in each of them
 * until the second one appeared.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

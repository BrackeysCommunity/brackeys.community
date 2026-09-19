import { APP_LOCALE } from "@/lib/format-date";

/**
 * Stat-number rendering ("1,234"), locale pinned.
 *
 * A bare `toLocaleString()` renders with the server's locale on SSR and
 * the visitor's on hydration — a hydration mismatch for any visitor whose
 * locale groups digits differently (1.234, 1 234). See `APP_LOCALE`.
 */
export function formatCount(n: number): string {
  return n.toLocaleString(APP_LOCALE);
}

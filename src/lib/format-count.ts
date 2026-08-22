/**
 * Stat-number rendering ("1,234"), locale pinned.
 *
 * A bare `toLocaleString()` renders with the server's locale on SSR and
 * the visitor's on hydration — a hydration mismatch for any visitor whose
 * locale groups digits differently (1.234, 1 234). The app's copy is
 * English throughout, so the digits pin to the same convention.
 */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

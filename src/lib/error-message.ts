/**
 * The one way to turn a caught `unknown` into copy a person can read.
 * Replaces the `err instanceof Error ? err.message : "…"` extraction that
 * had been hand-rolled at ~25 call sites (three of them as local helpers).
 *
 * An `Error` with an empty message falls through to the fallback — a blank
 * toast is worse than a generic one.
 */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

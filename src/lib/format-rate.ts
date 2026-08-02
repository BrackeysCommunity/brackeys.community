/**
 * One rendering for compensation, wherever it appears.
 *
 * There used to be three: the collab create wizard, the collab user card,
 * and the profile availability row each had their own — so the *same
 * person's* rate rendered as `$25 - $50 /hr` on their collab card and
 * `$25–$50 hourly` on their profile. The `$K`-abbreviated form below is
 * the canonical one (it was already what users saw most).
 */

export type RateType = "hourly" | "fixed" | "rev_share" | "negotiable";

interface FormatRateOptions {
  /**
   * What to render for a `negotiable` rate. Callers that draw their own
   * "NEGOTIABLE" badge want the default (empty string, so nothing renders
   * twice); callers using this as the whole value pass a label.
   */
  negotiableLabel?: string;
}

/** `$1.5K`, `$750` — thousands collapse, and only to one decimal. */
function money(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n}`;
}

export function formatRate(
  type: RateType | string | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  options: FormatRateOptions = {},
): string {
  if (!type) return "";
  if (type === "negotiable") return options.negotiableLabel ?? "";
  if (min == null) return "";

  // Revenue share is a percentage of the project, not an amount.
  if (type === "rev_share") {
    return max == null ? `${min}%+` : `${min}% - ${max}%`;
  }

  const suffix = type === "hourly" ? " /hr" : "";
  return max == null ? `${money(min)}+${suffix}` : `${money(min)} - ${money(max)}${suffix}`;
}

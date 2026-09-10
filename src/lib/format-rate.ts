/**
 * One rendering for compensation, wherever it appears.
 *
 * There used to be three: the collab create wizard, the collab user card,
 * and the profile availability row each had their own — so the *same
 * person's* rate rendered as `$25 - $50 /hr` on their collab card and
 * `$25–$50 hourly` on their profile. The `$K`-abbreviated form below is
 * the canonical one (it was already what users saw most).
 */

import type { CollabCompensationType } from "@/lib/collab-vocabulary";
import { currencySymbol } from "@/lib/currency";

export type RateType = CollabCompensationType;

interface FormatRateOptions {
  /**
   * What to render for a `negotiable` rate. Callers that draw their own
   * "NEGOTIABLE" badge want the default (empty string, so nothing renders
   * twice); callers using this as the whole value pass a label.
   */
  negotiableLabel?: string;
  /**
   * ISO-4217 code the amounts are stored in. Display only — nothing here
   * converts, and nothing anywhere else should. Rows written before the
   * column existed read as USD, which is what they were rendered as.
   */
  currency?: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** `$1.5M`, `€1.5K`, `SEK 750` — each tier collapses, and only to one decimal. */
function money(n: number, symbol: string): string {
  if (n < 1000) return `${symbol}${n}`;
  const thousands = round1(n / 1000);
  // Ten million used to render `$10000K`. A four-digit thousands figure is
  // the bug, so anything that reaches one — including `999_950`, which
  // rounds *up* into it — is a million instead.
  if (n < 1_000_000 && thousands < 1000) return `${symbol}${trim(thousands)}K`;
  return `${symbol}${trim(round1(n / 1_000_000))}M`;
}

/** Every caller reads the type out of a row, so the parameter is a plain
 *  string — `RateType` names the values it's matched against. */
export function formatRate(
  type: string | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  options: FormatRateOptions = {},
): string {
  if (!type) return "";
  if (type === "negotiable") return options.negotiableLabel ?? "";
  if (min == null) return "";

  // Revenue share is a percentage of the project, not an amount.
  if (type === "rev_share") {
    if (max == null) return `${min}%+`;
    return max < min ? `${min}%` : `${min}% - ${max}%`;
  }

  const symbol = currencySymbol(options.currency);
  const suffix = type === "hourly" ? " /hr" : "";
  if (max == null) return `${money(min, symbol)}+${suffix}`;
  // Nothing validated the pair until `updateProfile` grew a `superRefine`,
  // so rows where max < min already exist. `$10000K - $150K` reads as a
  // range nobody offered; the higher figure alone is at least true.
  if (max < min) return `${money(min, symbol)}${suffix}`;
  return `${money(min, symbol)} - ${money(max, symbol)}${suffix}`;
}

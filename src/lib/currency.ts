/**
 * What a rate is denominated in.
 *
 * Every rate in the system used to be an unlabelled integer rendered with a
 * hardcoded `$`, which reads as a claim rather than a default: a member in
 * Lisbon posting 40/hr was published as offering $40/hr.
 *
 * **Display only, and it must stay that way.** No conversion happens here
 * or anywhere else — storing a rate in EUR and rendering it in USD at some
 * day's rate is worse than the silence it replaced. A rate is stored in the
 * currency the member picked and shown in that currency, full stop.
 *
 * The list is deliberately short: the handful the guild actually posts in,
 * not all of ISO 4217. Adding one is a line here — the columns are plain
 * text, so nothing else has to move.
 */

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "SEK",
  "DKK",
  "NOK",
  "PLN",
  "BRL",
  "INR",
  "JPY",
] as const;

export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "USD";

/**
 * The prefix `formatRate` puts in front of an amount. Codes without a
 * distinct single glyph keep the code plus a space — "SEK 400" is
 * unambiguous where "kr 400" is shared with two of its neighbours.
 */
const SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  SEK: "SEK ",
  DKK: "DKK ",
  NOK: "NOK ",
  PLN: "PLN ",
  BRL: "R$",
  INR: "₹",
  JPY: "¥",
};

/** Rows written before the column existed, and anything unrecognised, read as USD. */
export function normalizeCurrency(value: string | null | undefined): Currency {
  const code = value?.trim().toUpperCase();
  return (CURRENCIES as readonly string[]).includes(code ?? "")
    ? (code as Currency)
    : DEFAULT_CURRENCY;
}

export function currencySymbol(value: string | null | undefined): string {
  return SYMBOL[normalizeCurrency(value)];
}

/** `USD — $` etc., for a picker where the glyph alone is ambiguous. */
export function currencyOptionLabel(currency: Currency): string {
  const symbol = SYMBOL[currency].trim();
  return symbol === currency ? currency : `${currency} — ${symbol}`;
}

export const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({
  value,
  label: currencyOptionLabel(value),
}));

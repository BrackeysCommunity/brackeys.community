/**
 * Every number a card shows goes through here, so none goes out without
 * its unit (GDD 2). Thousands take a comma; a change is "70 to 64 of 90
 * durability"; time in ticks names the minutes on first mention.
 */

export const MINUTES_PER_TICK = 10;
export const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;

export function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function amount(n: number, unit: string): string {
  return `${num(n)} ${unit}`;
}

/** A count with its unit in the singular or plural: "1 tile", "3 tiles". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return amount(n, n === 1 ? one : many);
}

/** A value that changed, shown as the change. */
export function change(from: number, to: number, unit: string, of?: number): string {
  const tail = of === undefined ? unit : `of ${num(of)} ${unit}`;
  return from === to ? `${num(to)} ${tail}` : `${num(from)} to ${num(to)} ${tail}`;
}

/** "14 of 30 load". */
export function outOf(n: number, of: number, unit: string): string {
  return `${num(n)} of ${num(of)} ${unit}`;
}

/** "2 ticks (20 min)". */
export function ticks(n: number): string {
  return `${plural(n, "tick")} (${num(n * MINUTES_PER_TICK)} min)`;
}

/** Ticks as whole hours, for a table column whose header names the unit. */
export function hours(n: number): string {
  return num(n / TICKS_PER_HOUR);
}

export function percent(n: number): string {
  return `${num(n)}%`;
}

/** A signed percentage, "+12%" or "−8%". */
export function signedPercent(n: number): string {
  return `${n >= 0 ? "+" : "−"}${num(Math.abs(n))}%`;
}

/** A signed change, "+38 xp". */
export function signed(n: number, unit: string): string {
  return `${n >= 0 ? "+" : "−"}${amount(Math.abs(n), unit)}`;
}

/** The odds bands as players read them (GDD 2.3). */
const BANDS: Record<string, string> = {
  certain: "Certain",
  "near-certain": "Near certain (about 9 in 10)",
  likely: "Likely (about 3 in 4)",
  even: "Even (about 1 in 2)",
  "long-shot": "Long shot (about 1 in 4)",
  desperate: "Desperate (about 1 in 10)",
};

export function band(id: string): string {
  return BANDS[id] ?? id;
}

/** A band's short name, for a button label. */
export function bandShort(id: string): string {
  return (BANDS[id] ?? id).replace(/ \(.*\)$/, "");
}

/** Every band's short name. */
export const BAND_LABELS = Object.keys(BANDS).map(bandShort);

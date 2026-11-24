/**
 * Every number the game shows a player goes through here, in chat and in
 * the Activity, so none goes out without its unit (GDD 2). Thousands take
 * a comma; a change is "70 to 64 of 90 durability"; time in ticks names
 * the minutes on first mention.
 */

export const MINUTES_PER_TICK = 10;
export const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;

/** An id as words: "iron-ore" reads "iron ore". */
export function idWords(id: string): string {
  return id.replace(/[-_]/g, " ");
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** An id as words, capitalised: "Iron ore". */
export function readable(id: string): string {
  return capital(idWords(id));
}

export function num(n: number): string {
  const whole = Math.round(n);
  const digits = Math.abs(whole).toLocaleString("en-US");
  return whole < 0 ? `−${digits}` : digits;
}

export function amount(n: number, unit: string): string {
  return `${num(n)} ${unit}`;
}

/** A count with its unit in the singular or plural: "1 tile", "3 tiles". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return amount(n, n === 1 ? one : many);
}

const SMALL = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** A count in words, "two styles", for things the bare-number rule knows no unit for. */
export function countWords(n: number, one: string, many = `${one}s`): string {
  const word = SMALL[n] ?? n.toLocaleString("en-US");
  if (n === 1) return `${/^[aeiou]/.test(one) ? "an" : "a"} ${one}`;
  return `${word} ${many}`;
}

/** A value that changed, shown as the change. */
export function change(from: number, to: number, unit: string, of?: number): string {
  const tail = of === undefined ? unit : `of ${num(of)} ${unit}`;
  return from === to ? `${num(to)} ${tail}` : `${num(from)} to ${num(to)} ${tail}`;
}

/** "a, b and c". */
export function list(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** "14 of 30 load". */
export function outOf(n: number, of: number, unit: string): string {
  return `${num(n)} of ${num(of)} ${unit}`;
}

/** "2 ticks (20 min)". */
export function ticks(n: number): string {
  return `${plural(n, "tick")} (${amount(n * MINUTES_PER_TICK, "min")})`;
}

/** Milliseconds as whole seconds, rounded up so a running clock never reads early: "12 s". */
export function seconds(ms: number): string {
  return amount(Math.ceil(Math.max(0, ms) / 1000), "s");
}

/** Ticks as whole hours, for a table column whose header names the unit. */
export function hours(n: number): string {
  return num(n / TICKS_PER_HOUR);
}

export function percent(n: number): string {
  return `${num(n)}%`;
}

/** The sign a change is written with. */
export function sign(n: number): string {
  return n >= 0 ? "+" : "−";
}

/** A signed percentage, "+12%" or "−8%". */
export function signedPercent(n: number): string {
  return `${sign(n)}${percent(Math.abs(n))}`;
}

/** A signed change, "+38 xp". */
export function signed(n: number, unit: string): string {
  return `${sign(n)}${amount(Math.abs(n), unit)}`;
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

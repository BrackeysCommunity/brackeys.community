/**
 * Every number the Activity shows is written here, so none goes out
 * without its unit (GDD 2). Nothing else turns a number into text.
 */

export const MINUTES_PER_TICK = 10;
const MS_PER_SECOND = 1000;

// Thousands take a comma (GDD 2.4).
function num(n: number): string {
  const whole = Math.round(n);
  const digits = Math.abs(whole).toLocaleString("en-US");
  return whole < 0 ? `−${digits}` : digits;
}

/** "14 coin". */
export function amount(n: number, unit: string): string {
  return `${num(n)} ${unit}`;
}

/** A count with its unit in the singular or the plural: "1 use", "3 uses". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return amount(n, n === 1 ? one : many);
}

/** "14 of 30 load". */
export function outOf(n: number, of: number, unit: string): string {
  return `${num(n)} of ${num(of)} ${unit}`;
}

/** "30 to 38 pts". */
export function range(from: number, to: number, unit: string): string {
  return from === to ? amount(from, unit) : `${num(from)} to ${num(to)} ${unit}`;
}

/** A value that changed, written as the change: "70 to 64 of 90 durability". */
export function change(from: number, to: number, unit: string, of?: number): string {
  const tail = of === undefined ? unit : `of ${num(of)} ${unit}`;
  return from === to ? `${num(to)} ${tail}` : `${num(from)} to ${num(to)} ${tail}`;
}

/** "12%". */
export function percent(n: number): string {
  return `${num(n)}%`;
}

/** A share of something: "3% of each fill". */
export function share(n: number, of: string): string {
  return `${percent(n)} of ${of}`;
}

function sign(n: number): string {
  return n >= 0 ? "+" : "−";
}

/** A signed change: "+38 xp". */
export function signed(n: number, unit: string): string {
  return `${sign(n)}${amount(Math.abs(n), unit)}`;
}

/** "+12%" or "−8%". */
export function signedPercent(n: number): string {
  return `${sign(n)}${percent(Math.abs(n))}`;
}

/** "level 3". */
export function level(n: number): string {
  return `level ${num(n)}`;
}

/** Milliseconds as whole seconds, rounded up so a running clock never reads early: "40 s". */
export function seconds(ms: number): string {
  return amount(Math.ceil(Math.max(0, ms) / MS_PER_SECOND), "s");
}

/** A solve's time to a tenth of a second: "9.2 s". */
export function stopwatch(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  return `${num(Math.trunc(tenths / 10))}.${tenths % 10} s`;
}

/** World time with its real time: "2 ticks (20 min)". */
export function ticks(n: number): string {
  return `${plural(n, "tick")} (${amount(n * MINUTES_PER_TICK, "min")})`;
}

/** A practice bar: "12 of 60 uses". */
export function uses(n: number, of: number): string {
  return outOf(n, of, "uses");
}

/**
 * A number in a unit the world service names: the units of a why's parts
 * and of a haywire row. `noun` is what a bare count counts.
 */
export function quantity(value: number, unit: string, noun = "times"): string {
  switch (unit) {
    case "s":
    case "seconds":
      return amount(value, "s");
    case "percent":
      return percent(value);
    case "count":
      return noun === "times" ? plural(value, "time") : plural(value, noun);
    case "days":
      return plural(value, "world day");
    case "level":
      return level(value);
    default:
      return amount(value, unit);
  }
}

/** A why's part as what it adds: "+8 s", "−15%", "+34 pts". */
export function adds(value: number, unit: string): string {
  if (unit === "percent") return signedPercent(value);
  return `${sign(value)}${quantity(Math.abs(value), unit)}`;
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

/** A band's name without its odds, for a narrow place. */
export function bandShort(id: string): string {
  return band(id).replace(/ \(.*\)$/, "");
}

const UNITS = new Set([
  "coin",
  "pts",
  "durability",
  "xp",
  "load",
  "health",
  "defence",
  "threat",
  "standing",
  "s",
  "min",
  "use",
  "uses",
  "lesson",
  "lessons",
  "tick",
  "ticks",
  "time",
  "times",
  "beat",
  "beats",
  "world",
  "wire",
  "wires",
  "pouch",
  "pouches",
  "here",
  "goods",
  "hint",
  "hints",
  "family",
  "families",
  "character",
  "characters",
]);
const UNIT_FIRST = new Set(["level", "tier", "beat", "practice"]);
const CONNECTORS = new Set(["to", "of", "and", "or"]);

/**
 * The numbers in a text that stand without a unit: what a view must never
 * show. A number is fine when the next word (past "to", "of" and further
 * numbers) is a unit or one of `names` (a good's name), when the word
 * before it puts the unit first ("level 10"), when it is a percentage, or
 * inside a band's "about 1 in 2".
 */
export function bareNumbers(text: string, names: Set<string> = new Set()): string[] {
  const tokens = text
    .replace(/about \d+ in \d+/g, " ")
    .replace(/[()[\]:;,!?]|\.(?!\d)/g, (c) => (c === "," ? "" : " "))
    .split(/\s+/)
    .filter(Boolean);
  const isNum = (t: string) => /^[+−-]?\d+(\.\d+)?%?$/.test(t);
  const out: string[] = [];
  for (const [i, t] of tokens.entries()) {
    if (!isNum(t) || t.endsWith("%")) continue;
    const before = tokens[i - 1]?.toLowerCase();
    if (before && UNIT_FIRST.has(before)) continue;
    let j = i + 1;
    while (j < tokens.length && (CONNECTORS.has(tokens[j]!) || isNum(tokens[j]!))) j++;
    const word = (tokens[j] ?? "").toLowerCase();
    const rest = tokens
      .slice(j, j + 3)
      .join(" ")
      .toLowerCase();
    if (UNITS.has(word) || [...names].some((n) => rest.startsWith(n))) continue;
    out.push(t);
  }
  return out;
}

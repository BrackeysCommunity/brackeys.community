/**
 * Every number the Activity shows is written here or in the words it
 * shares with chat, so none goes out without its unit (GDD 2). Nothing
 * else turns a number into text.
 */
import {
  amount,
  num,
  outOf,
  percent,
  plural,
  sign,
  signedPercent,
} from "../../../packages/mmo-words/src/units.ts";

export { bareNumbers } from "../../../packages/mmo-words/src/bare-numbers.ts";
export * from "../../../packages/mmo-words/src/units.ts";

/** "30 to 38 pts". */
export function range(from: number, to: number, unit: string): string {
  return from === to ? amount(from, unit) : `${num(from)} to ${num(to)} ${unit}`;
}

/** A share of something: "3% of each fill". */
export function share(n: number, of: string): string {
  return `${percent(n)} of ${of}`;
}

/** "level 3". */
export function level(n: number): string {
  return `level ${num(n)}`;
}

/** A solve's time to a tenth of a second: "9.2 s". */
export function stopwatch(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  return `${num(Math.trunc(tenths / 10))}.${tenths % 10} s`;
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

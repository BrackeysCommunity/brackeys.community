import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vite-plus/test";

/**
 * BC-207. A formatter that resolves its locale from the runtime renders
 * one way on the server and another in a visitor's browser, and React
 * answers the difference by discarding the hydrated tree. The production
 * mismatches clustered almost entirely on visitors reporting en-GB,
 * fr-FR, he-IL or cs.
 *
 * Nothing in the type system says so — `toLocaleDateString()` with no
 * argument is perfectly valid — which is why three of these drifted back
 * in after `formatCount` had already written the rule down. The locale
 * argument has to be there and it has to be a literal: pass `APP_LOCALE`
 * from `@/lib/format-date`, or go through `formatDate` / `jamDate`.
 *
 * The time zone is the same bug wearing the other half of the costume,
 * and the locale check alone does not catch it: the server runs in UTC
 * and the visitor does not, so a formatter that pins `APP_LOCALE` and
 * stops there still renders a different day on each side of midnight.
 * The second test below closes that, and only for formatters that
 * actually render a date — `formatCount` pins a locale on a *number*,
 * where a time zone would mean nothing.
 */

const ROOT = process.cwd();
const RENDERED_DIRS = ["src/components", "src/lib", "src/routes"];

/** Every file that legitimately resolves a locale at runtime. */
const EXEMPT = new Set([
  // Formats a *chosen* timezone's own offset label; not rendered content.
  "src/lib/timezones.ts",
  // react-day-picker's own `locale` prop, threaded through to its formatters.
  "src/components/ui/calendar.tsx",
]);

/**
 * `toLocaleX(` followed by `)` or `undefined` — the two spellings that
 * defer to the runtime. A string literal or an identifier is fine.
 */
const UNPINNED = [
  /\.toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b)/,
  /new Intl\.(?:DateTime|Number|RelativeTime|List|PluralRules)Format\(\s*(?:\)|undefined\b)/,
];

/** Option keys that make a formatter render a date or a time. */
const DATE_FIELDS =
  /\b(?:year|month|day|weekday|era|hour|minute|second|dateStyle|timeStyle|fractionalSecondDigits)\b/;

/**
 * The argument text of the call starting at `open`, paren-balanced so a
 * nested object or a multi-line options bag comes back whole.
 */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open);
}

/** Every date/time formatter call in `source`, with its arguments. */
function dateFormatterCalls(source: string): { args: string; line: number }[] {
  const starts = /\.toLocale(?:Date|Time)?String\s*\(|new Intl\.DateTimeFormat\s*\(/g;
  const found: { args: string; line: number }[] = [];
  for (let m = starts.exec(source); m !== null; m = starts.exec(source)) {
    const open = source.indexOf("(", m.index + m[0].length - 1);
    if (open === -1) continue;
    found.push({
      args: callArgs(source, open),
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "__tests__"
        ? []
        : sourceFiles(join(dir, entry.name));
    }
    return /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [];
  });
}

describe("locale pinning", () => {
  it("no rendered formatter resolves its locale from the runtime", () => {
    const offenders = RENDERED_DIRS.flatMap(sourceFiles)
      .filter((file) => !EXEMPT.has(file))
      .flatMap((file) => {
        const source = readFileSync(join(ROOT, file), "utf8");
        return source
          .split("\n")
          .map((line, i) => ({ line: line.trim(), n: i + 1 }))
          .filter(({ line }) => UNPINNED.some((re) => re.test(line)))
          .map(({ line, n }) => `${relative(".", file)}:${n} — ${line}`);
      });

    expect(
      offenders,
      "pass APP_LOCALE, or use formatDate / jamDate from @/lib/format-date and @/lib/jam-links",
    ).toEqual([]);
  });

  it("no rendered date formatter leaves its time zone to the runtime", () => {
    const offenders = RENDERED_DIRS.flatMap(sourceFiles)
      .filter((file) => !EXEMPT.has(file))
      .flatMap((file) => {
        const source = readFileSync(join(ROOT, file), "utf8");
        return dateFormatterCalls(source)
          .filter(({ args }) => DATE_FIELDS.test(args) && !/\btimeZone\b/.test(args))
          .map(({ line }) => `${relative(".", file)}:${line}`);
      });

    expect(
      offenders,
      'add timeZone: "UTC", or use formatDate / jamDate, which pin it for you',
    ).toEqual([]);
  });
});

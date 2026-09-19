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
});

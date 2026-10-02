import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vite-plus/test";

/**
 * The site's domain lives in `SITE` (`src/lib/legal-meta.ts`) and nowhere
 * else, so moving domains is a one-line change. This fails on any other
 * literal of the current or former hosts in shipped source.
 *
 * `git.brackeys.dev` is a separate GitLab instance, not the site, and is
 * never matched.
 */

const ROOT = process.cwd();
const SITE_HOST = /(?<!git\.)\bbrackeys\.(community|dev)\b/i;

/** Files allowed to name the host, and why. */
const ALLOWED: Record<string, string> = {
  "src/lib/legal-meta.ts": "the single source of truth",
  "src/lib/site-meta.ts": "FEED_ID_ORIGIN: Atom ids are permanent and must not follow the domain",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function shippedSource(): string[] {
  const services = readdirSync(join(ROOT, "services"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return sourceFiles(join(ROOT, "services", entry.name, "src"));
      } catch {
        return [];
      }
    });
  return [...sourceFiles(join(ROOT, "src")), ...services];
}

describe("site domain literals", () => {
  it("appear only where SITE is defined", () => {
    const offenders = shippedSource()
      .map((file) => relative(ROOT, file))
      .filter((file) => !(file in ALLOWED))
      .flatMap((file) =>
        readFileSync(join(ROOT, file), "utf8")
          .split("\n")
          .flatMap((line, i) => (SITE_HOST.test(line) ? [`${file}:${i + 1}`] : [])),
      );
    expect(offenders).toEqual([]);
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

/**
 * Each service image copies the shared `src/` files it needs one `COPY`
 * line at a time, so a new import of a shared module boots locally and
 * dies in the container with "Cannot find module". Nothing in the build
 * catches it — the Dockerfile is not type-checked. This walks every
 * service's imports, follows the shared files' own relative imports, and
 * fails on the first one the Dockerfile doesn't carry.
 */

const ROOT = process.cwd();
const SERVICES_DIR = join(ROOT, "services");
const SRC_DIR = join(ROOT, "src");

const IMPORT_RE = /(?:from|import)\s*["']([^"']+)["']/g;
/** `import type … from "x"` is erased at runtime, so the module need not ship. */
const TYPE_IMPORT_RE = /import\s+type\s[^;]*?from\s*["'][^"']+["']/g;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function copiedPaths(dockerfile: string): string[] {
  return readFileSync(dockerfile, "utf8")
    .split("\n")
    .map((line) => /^COPY\s+(src\/\S+)\s+/.exec(line)?.[1])
    .filter((path): path is string => Boolean(path))
    .map((path) => resolve(ROOT, path));
}

function isCovered(file: string, copied: string[]): boolean {
  return copied.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

/** Every shared `src/` file the service reaches, directly or through
 *  another shared file's relative imports. */
function sharedClosure(serviceSrc: string): Map<string, string> {
  const reachedFrom = new Map<string, string>();
  const queue = sourceFiles(serviceSrc);
  const seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift()!;
    const text = readFileSync(file, "utf8").replace(TYPE_IMPORT_RE, "");
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, match[1]!);
      if (!target || !target.startsWith(`${SRC_DIR}/`) || seen.has(target)) continue;
      seen.add(target);
      reachedFrom.set(target, file);
      queue.push(target);
    }
  }
  return reachedFrom;
}

const services = existsSync(SERVICES_DIR)
  ? readdirSync(SERVICES_DIR).filter((name) => existsSync(join(SERVICES_DIR, name, "Dockerfile")))
  : [];

describe.each(services)("services/%s image", (name) => {
  const dir = join(SERVICES_DIR, name);
  const copied = copiedPaths(join(dir, "Dockerfile"));

  it("copies every shared src/ file its code imports", () => {
    const missing = [...sharedClosure(join(dir, "src"))]
      .filter(([file]) => !isCovered(file, copied))
      .map(([file, from]) => `${relative(ROOT, file)} (imported from ${relative(ROOT, from)})`);
    expect(missing, `add a COPY line to services/${name}/Dockerfile for:`).toEqual([]);
  });
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * The engine lives in `packages/engine/`. A path that still names its old
 * home (`src/engine`, or a relative `../engine` that lands there) is a
 * config, script, service or test that silently reads nothing, so this
 * fails on any in a file git tracks. The engine's
 * CHANGELOG keeps its history, and plans are gitignored.
 */

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const OLD_HOME = join(REPO, "src", "engine");
const SELF = "src/lib/__tests__/engine-path.test.ts";
const EXCEPTED = (path: string) =>
  path === SELF || path === "packages/engine/CHANGELOG.md" || path.startsWith("docs/plans/");

/** `src/engine` as a path from the repo root, not the tail of a longer one (`services/x/src/engine`). */
const ROOTED = /(?<![\w./-])(?:\.\/)?src\/engine(?![\w-])/;
/** A relative path whose `../` steps may land in the old home. */
const RELATIVE = /((?:\.\.\/)+)((?:src\/)?engine)(?![\w-])/g;

/** Each `line: text` in `text` (the contents of repo file `path`) that names the old home. */
function oldEnginePaths(path: string, text: string): string[] {
  const from = dirname(join(REPO, path));
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    const relative = [...line.matchAll(RELATIVE)].some(
      (m) => resolve(from, `${m[1]}${m[2]}`) === OLD_HOME,
    );
    if (relative || ROOTED.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  return hits;
}

function repoFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "-z"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split("\0").filter((p) => p !== ""))].sort();
}

function textOf(path: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(REPO, path));
  } catch (error) {
    // Deleted from the working tree but still in the index, or a directory (a submodule).
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw error;
  }
  return bytes.includes(0) ? null : bytes.toString("utf8");
}

describe("oldEnginePaths", () => {
  it("finds the old home from the root and through ../ steps", () => {
    expect(oldEnginePaths("package.json", '"cd src/engine && vp pack"')).toHaveLength(1);
    expect(oldEnginePaths("vite.config.ts", 'new URL("./src/engine/x", u)')).toHaveLength(1);
    expect(oldEnginePaths("src/lib/scene/ids.ts", 'from "../../engine/scene"')).toHaveLength(1);
    expect(oldEnginePaths("scripts/a/b.ts", 'new URL("../../src/engine/scenes", u)')).toHaveLength(
      1,
    );
  });

  it("leaves the new home and other directories named engine alone", () => {
    expect(oldEnginePaths("package.json", '"cd packages/engine && vp pack"')).toEqual([]);
    expect(
      oldEnginePaths("services/canvas-sync/test/a.ts", 'from "../src/engine/doc-store.ts"'),
    ).toEqual([]);
    expect(
      oldEnginePaths("services/canvas-sync/README.md", "`services/canvas-sync/src/engine/`"),
    ).toEqual([]);
    expect(oldEnginePaths("src/lib/scene/ids.ts", 'from "../engine/bundle"')).toEqual([]);
    expect(oldEnginePaths("src/a.ts", 'import "./src/engines"')).toEqual([]);
  });
});

describe("the engine's old path", () => {
  it("is named by no tracked file outside the CHANGELOG and the plans", () => {
    const found = repoFiles()
      .filter((path) => !EXCEPTED(path))
      .flatMap((path) => {
        const text = textOf(path);
        return text === null ? [] : oldEnginePaths(path, text).map((hit) => `${path}:${hit}`);
      });
    expect(found, "point these at packages/engine").toEqual([]);
  }, 60_000);
});

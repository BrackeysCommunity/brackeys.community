import { byCodeUnit } from "../project/kinds/define";
import { INDEX_HTML_FILE, RELEASE_FILE } from "../project/release";
import { jsonPointer, makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";

/**
 * itch.io's limits on an HTML5 upload, as https://itch.io/docs/creators/html5
 * ("ZIP file requirements") states them, read 2026-11-11: at most 1,000
 * files after extraction, 500MB extracted in all, 200MB for any one file,
 * 240 characters for a file's name including its path. The page says "MB"
 * without a base, so the byte counts take the smaller, decimal reading.
 */
export const ITCH_LIMITS: {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxPathLength: number;
} = {
  maxFiles: 1000,
  maxTotalBytes: 500 * 1000 * 1000,
  maxFileBytes: 200 * 1000 * 1000,
  maxPathLength: 240,
};

/** Decimal megabytes, the unit itch.io's limits are stated in. */
const mb = (bytes: number) => `${Math.round(bytes / 100_000) / 10} MB`;

/** Where a file's issue points: its row in `release.json`'s `build.files`, which lists every file but the manifest. */
function rowPointers(paths: readonly string[]): Map<string, string> {
  const rows = paths.filter((p) => p !== RELEASE_FILE).sort(byCodeUnit);
  const out = new Map<string, string>();
  rows.forEach((p, i) => out.set(p, jsonPointer(["build", "files", i, "path"])));
  out.set(RELEASE_FILE, "");
  return out;
}

/** Why `path` would land outside the zip's root folder, or null when it stays inside. */
function escapesRoot(path: string): string | null {
  if (path.length === 0) return "is empty";
  if (path.includes("\\")) return "uses a backslash";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "is absolute";
  const segments = path.split("/");
  if (segments.includes("..")) return 'climbs out with ".."';
  if (segments.some((s) => s === "" || s === ".")) return "has an empty or '.' segment";
  return null;
}

/**
 * itch.io's HTML5 layout over a build's files: the counts and sizes in
 * `ITCH_LIMITS`, `index.html` at the root, nothing outside the root folder,
 * no `__MACOSX` or dotfiles. Each failure is `export-itch-layout`.
 */
export function checkItchLayout(files: readonly { path: string; bytes: number }[]): SceneIssue[] {
  const sorted = [...files].sort((a, b) => byCodeUnit(a.path, b.path));
  const pointers = rowPointers(sorted.map((f) => f.path));
  const whole = jsonPointer(["build", "files"]);
  const issues: SceneIssue[] = [];
  const issue = (message: string, path: string, got: string, expected: string) =>
    issues.push(makeIssue("export-itch-layout", { message, path, got, expected }));

  if (sorted.length > ITCH_LIMITS.maxFiles)
    issue(
      `the build has ${sorted.length} files; itch.io takes at most ${ITCH_LIMITS.maxFiles}`,
      whole,
      String(sorted.length),
      `at most ${ITCH_LIMITS.maxFiles} files`,
    );
  const total = sorted.reduce((n, f) => n + f.bytes, 0);
  if (total > ITCH_LIMITS.maxTotalBytes)
    issue(
      `the build is ${mb(total)} in all; itch.io takes at most ${mb(ITCH_LIMITS.maxTotalBytes)}`,
      whole,
      String(total),
      `at most ${ITCH_LIMITS.maxTotalBytes} bytes`,
    );

  if (!sorted.some((f) => f.path === INDEX_HTML_FILE)) {
    const nested = sorted.find((f) => f.path.endsWith(`/${INDEX_HTML_FILE}`));
    issue(
      nested
        ? `index.html is at "${nested.path}"; itch.io needs it at the zip's root, not in a folder`
        : "the build has no index.html; itch.io needs one at the zip's root",
      whole,
      nested?.path ?? "",
      INDEX_HTML_FILE,
    );
  }

  for (const f of sorted) {
    const at = pointers.get(f.path) ?? whole;
    const escape = escapesRoot(f.path);
    if (escape)
      issue(
        `"${f.path}" ${escape}; every file must sit inside the zip's root folder`,
        at,
        f.path,
        "a relative path inside the root",
      );
    const hidden = f.path
      .split("/")
      .find((s) => s === "__MACOSX" || (s.startsWith(".") && s !== "." && s !== ".."));
    if (hidden !== undefined)
      issue(
        `"${f.path}" is ${hidden === "__MACOSX" ? "in a __MACOSX folder" : "a dotfile or in a dot folder"}; itch.io builds ship neither`,
        at,
        f.path,
        "no __MACOSX folder or dotfile",
      );
    if (f.bytes > ITCH_LIMITS.maxFileBytes)
      issue(
        `"${f.path}" is ${mb(f.bytes)}; itch.io takes at most ${mb(ITCH_LIMITS.maxFileBytes)} per file`,
        at,
        String(f.bytes),
        `at most ${ITCH_LIMITS.maxFileBytes} bytes`,
      );
    const length = [...f.path].length;
    if (length > ITCH_LIMITS.maxPathLength)
      issue(
        `"${f.path.slice(0, 40)}…" is ${length} characters long; itch.io takes at most ${ITCH_LIMITS.maxPathLength} with its path`,
        at,
        String(length),
        `at most ${ITCH_LIMITS.maxPathLength} characters`,
      );
  }
  return issues;
}

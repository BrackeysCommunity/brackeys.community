/**
 * The engine's API report: every public entry's exports and the declarations
 * behind them, read from the packed `.d.mts` files and normalised so the
 * report doesn't depend on chunk hashes, chunk boundaries, comments or
 * declaration order. CI fails when it differs from the checked-in copy.
 *
 *   vp run engine:pack && bun scripts/engine-api-report.ts           # --check (the default)
 *   vp run engine:pack && bun scripts/engine-api-report.ts --write   # after a reviewed API change
 *
 * `--root <dir>` reads another package (its `package.json` exports and the
 * files they name) and `--report <file>` another report, for tests.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cmp,
  createWalk,
  type Decl,
  entryTitle,
  normaliseText,
  readPackage,
  reportDiff,
} from "./engine-api/walk";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(REPO, "packages/engine");
const REPORT = join(ENGINE, "__tests__/api-report.txt");

/**
 * The report for a package whose `.d.mts` files `read` returns by path
 * relative to the package root (`null` for a missing file); `entries` maps
 * each public subpath to its declaration file.
 */
export function apiReport(
  pkgName: string,
  entries: Readonly<Record<string, string>>,
  read: (file: string) => string | null,
): string {
  const walk = createWalk(read);

  const out: string[] = [
    `# ${pkgName} API report`,
    "# Generated from the packed .d.mts files by scripts/engine-api-report.ts; regenerate with --write.",
  ];
  for (const [subpath, file] of Object.entries(entries).sort(([a], [b]) => cmp(a, b))) {
    out.push("", `## ${entryTitle(pkgName, subpath)}`);
    for (const name of walk.entryNames(file)) {
      if (name.startsWith("* from")) {
        out.push(name);
        continue;
      }
      const target = walk.resolveExport(file, name);
      if (!target) out.push(`${name} (unresolved)`);
      else if ("external" in target) out.push(`${name} = "${target.external}".${target.name}`);
      else {
        const local = normaliseText(target.local);
        out.push(local === name ? name : `${name} = ${local}`);
      }
    }
  }

  const unique = new Map<string, Decl>();
  for (const mod of walk.mods.values()) {
    for (const list of mod.decls.values())
      for (const d of list) unique.set(`${d.region}\0${d.name}\0${d.text}`, d);
  }
  const decls = [...unique.values()].sort(
    (a, b) => cmp(a.region, b.region) || cmp(a.name, b.name) || cmp(a.text, b.text),
  );
  let region: string | undefined;
  for (const d of decls) {
    if (d.region !== region) out.push("", `## ${(region = d.region)}`);
    out.push(d.text);
  }
  return `${out.join("\n")}\n`;
}

/** The report for the package at `root`, from its `package.json` exports' `types` files. */
export function packageReport(root: string): string {
  const pkg = readPackage(root);
  return apiReport(pkg.name, pkg.entries, pkg.read);
}

function main(argv: string[]): number {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = resolve(flag("--root") ?? ENGINE);
  const reportFile = resolve(flag("--report") ?? REPORT);
  let actual: string;
  try {
    actual = packageReport(root);
  } catch (e) {
    console.error(`engine-api-report: ${(e as Error).message}. Run \`vp run engine:pack\` first.`);
    return 1;
  }
  if (argv.includes("--write")) {
    writeFileSync(reportFile, actual);
    console.log(`engine-api-report: wrote ${reportFile}`);
    return 0;
  }
  const expected = existsSync(reportFile) ? readFileSync(reportFile, "utf8") : "";
  if (expected === actual) {
    console.log("engine-api-report: the API matches the report");
    return 0;
  }
  console.error(
    [
      `engine-api-report: the packed API differs from ${reportFile}:`,
      reportDiff(expected, actual),
      "",
      "If the change is intended, run `vp run engine:pack && bun scripts/engine-api-report.ts --write` and commit the report.",
    ].join("\n"),
  );
  return 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));

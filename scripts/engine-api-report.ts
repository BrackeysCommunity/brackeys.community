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

import ts from "typescript";

import { lcsPairs } from "../src/engine/scene/diff";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(REPO, "src/engine");
const REPORT = join(ENGINE, "__tests__/api-report.txt");

type Binding =
  | { kind: "local"; name: string }
  | { kind: "import"; spec: string; name: string }
  | { kind: "external"; spec: string; name: string };

type Decl = { region: string; name: string; text: string };

type Module = {
  decls: Map<string, Decl[]>;
  /** Local names bound by imports. */
  imports: Map<string, Binding>;
  /** Exported name to what it stands for. */
  exports: Map<string, Binding>;
  stars: string[];
};

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** Bundler artefacts: `$1` suffixes on renamed locals and hashes in chunk file names. */
export function normaliseText(text: string): string {
  return text
    .replace(/\b([A-Za-z_][\w]*)\$\d+\b/g, "$1")
    .replace(/(["'/])([\w.-]+?)-[\w-]{8}\.(d\.)?m[jt]s\b/g, "$1$2.mjs")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n");
}

/**
 * The statement with every union's members and every inferred object
 * type's properties in a fixed order: the compiler emits both in its
 * internal type order, which differs between builds.
 */
function sortUnions(stmt: ts.Statement, sf: ts.SourceFile): ts.Statement {
  const key = (t: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, t, sf);
  const sorted = <T extends ts.Node>(list: readonly T[]) =>
    ts.factory.createNodeArray([...list].sort((a, b) => cmp(key(a), key(b))));
  const sorter: ts.TransformerFactory<ts.Statement> = (ctx) => {
    const visit = (node: ts.Node): ts.Node => {
      const next = ts.visitEachChild(node, visit, ctx);
      if (ts.isUnionTypeNode(next)) return ts.factory.updateUnionTypeNode(next, sorted(next.types));
      if (ts.isTypeLiteralNode(next))
        return ts.factory.updateTypeLiteralNode(next, sorted(next.members));
      return next;
    };
    return (root) => ts.visitNode(root, visit) as ts.Statement;
  };
  const result = ts.transform(stmt, [sorter]);
  const out = result.transformed[0]!;
  result.dispose();
  return out;
}

const isRelative = (spec: string) => spec.startsWith("./") || spec.startsWith("../");
const declFile = (spec: string) => spec.replace(/\.m?js$/, ".d.mts");

function declaredNames(stmt: ts.Statement): string[] {
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [],
    );
  }
  if (
    ts.isFunctionDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt) ||
    ts.isModuleDeclaration(stmt)
  ) {
    return stmt.name && ts.isIdentifier(stmt.name) ? [stmt.name.text] : [];
  }
  return [];
}

const hasExport = (stmt: ts.Statement) =>
  ts.canHaveModifiers(stmt) &&
  (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The source file each line belongs to, from the bundler's `//#region` markers. */
function regionsByLine(text: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  for (const line of text.split("\n")) {
    const start = /^\/\/#region (.+?)(\.d)?\.m?ts$/.exec(line.trim());
    if (start) open.push(`${start[1]}.ts`);
    out.push(open[open.length - 1] ?? "(no region)");
    if (line.trim() === "//#endregion") open.pop();
  }
  return out;
}

/** Imports, exports and top-level declarations of one `.d.mts` file's text. */
export function parseModule(text: string, fileName = "entry.d.mts"): Module {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const regions = regionsByLine(text);
  const mod: Module = { decls: new Map(), imports: new Map(), exports: new Map(), stars: [] };
  const bind = (spec: string, name: string): Binding =>
    isRelative(spec) ? { kind: "import", spec, name } : { kind: "external", spec, name };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) mod.imports.set(clause.name.text, bind(spec, "default"));
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) mod.imports.set(named.name.text, bind(spec, "*"));
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements)
          mod.imports.set(el.name.text, bind(spec, (el.propertyName ?? el.name).text));
      }
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier && (stmt.moduleSpecifier as ts.StringLiteral).text;
      const clause = stmt.exportClause;
      if (!clause) {
        if (spec) mod.stars.push(spec);
        continue;
      }
      if (ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          const inner = (el.propertyName ?? el.name).text;
          mod.exports.set(el.name.text, spec ? bind(spec, inner) : { kind: "local", name: inner });
        }
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      if (ts.isIdentifier(stmt.expression))
        mod.exports.set("default", { kind: "local", name: stmt.expression.text });
      continue;
    }
    const names = declaredNames(stmt);
    if (names.length === 0) continue;
    const printed = normaliseText(
      printer.printNode(ts.EmitHint.Unspecified, sortUnions(stmt, sf), sf),
    );
    const region = regions[sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line]!;
    for (const name of names) {
      const list = mod.decls.get(name) ?? [];
      list.push({ region, name: normaliseText(name), text: printed });
      mod.decls.set(name, list);
      if (hasExport(stmt)) mod.exports.set(name, { kind: "local", name });
    }
  }
  return mod;
}

/** What an exported name ends at: a declaration in some file, or another package's export. */
type Target = { file: string; local: string } | { external: string; name: string };

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
  const mods = new Map<string, Module>();
  const load = (file: string): Module => {
    let mod = mods.get(file);
    if (!mod) {
      const text = read(file);
      if (text === null) throw new Error(`missing declaration file: ${file}`);
      mods.set(file, (mod = parseModule(text, file)));
    }
    return mod;
  };
  const near = (from: string, spec: string) =>
    join(dirname(from), declFile(spec)).replace(/\\/g, "/");

  const resolveBinding = (file: string, b: Binding, seen: Set<string>): Target | null => {
    if (b.kind === "external") return { external: b.spec, name: b.name };
    if (b.kind === "import") return resolveExport(near(file, b.spec), b.name, seen);
    const mod = load(file);
    if (mod.decls.has(b.name)) return { file, local: b.name };
    const imported = mod.imports.get(b.name);
    return imported ? resolveBinding(file, imported, seen) : null;
  };
  const resolveExport = (file: string, name: string, seen: Set<string>): Target | null => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const mod = load(file);
    const b = mod.exports.get(name);
    if (b) return resolveBinding(file, b, seen);
    for (const spec of mod.stars) {
      if (!isRelative(spec)) continue;
      const hit = resolveExport(near(file, spec), name, seen);
      if (hit) return hit;
    }
    return null;
  };

  const out: string[] = [
    `# ${pkgName} API report`,
    "# Generated from the packed .d.mts files by scripts/engine-api-report.ts; regenerate with --write.",
  ];
  for (const [subpath, file] of Object.entries(entries).sort(([a], [b]) => cmp(a, b))) {
    const mod = load(file);
    const names = [...mod.exports.keys()];
    for (const spec of mod.stars) {
      if (isRelative(spec)) names.push(...load(near(file, spec)).exports.keys());
      else names.push(`* from "${spec}"`);
    }
    out.push("", `## ${subpath === "." ? pkgName : `${pkgName}/${subpath.replace(/^\.\//, "")}`}`);
    for (const name of [...new Set(names)].sort(cmp)) {
      if (name.startsWith("* from")) {
        out.push(name);
        continue;
      }
      const target = resolveExport(file, name, new Set());
      if (!target) out.push(`${name} (unresolved)`);
      else if ("external" in target) out.push(`${name} = "${target.external}".${target.name}`);
      else {
        const local = normaliseText(target.local);
        out.push(local === name ? name : `${name} = ${local}`);
      }
    }
  }

  const unique = new Map<string, Decl>();
  for (const mod of mods.values()) {
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

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The changed lines between two reports, `-` for the checked-in copy and `+` for the new one. */
export function reportDiff(expected: string, actual: string, maxLines = 200): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const pairs = lcsPairs(a.length, b.length, (i, j) => a[i] === b[j]);
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    for (; i < pi; i++) lines.push(`- ${i + 1}: ${a[i]}`);
    for (; j < pj; j++) lines.push(`+ ${j + 1}: ${b[j]}`);
    i = pi + 1;
    j = pj + 1;
  }
  if (lines.length > maxLines)
    return [...lines.slice(0, maxLines), `… and ${lines.length - maxLines} more`].join("\n");
  return lines.join("\n");
}

/** The report for the package at `root`, from its `package.json` exports' `types` files. */
export function packageReport(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, string | { types?: string }>;
  };
  const entries: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === "object" && target.types)
      entries[subpath] = target.types.replace(/^\.\//, "");
  }
  return apiReport(pkg.name, entries, (file) => {
    const path = join(root, file);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  });
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

// @vitest-environment node
// The play page's browser bundle must never carry the database layer: a
// value import of `@/db`, `@/db/schema` or `drizzle-orm` anywhere under the
// play page's client modules pulls them in. Type-only imports are erased, and
// an import used only inside a server branch (`createIsomorphicFn().server`,
// `createServerFn().handler`, `createServerOnlyFn`) is dropped by TanStack
// Start's transform, so neither counts.
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const ROOT = resolve(import.meta.dirname, "../../../..");

const CLIENT_ENTRIES = [
  "src/lib/engine/save-store.ts",
  "src/lib/engine/local-saves.ts",
  "src/lib/engine/host-server.ts",
  "src/components/games/SaveNotice.tsx",
  "src/components/games/PlayChrome.tsx",
  "src/components/games/PlayFrame.tsx",
];

const isServerOnly = (specifier: string): boolean =>
  specifier === "@/db" ||
  specifier.startsWith("@/db/") ||
  specifier === "drizzle-orm" ||
  specifier.startsWith("drizzle-orm/");

const ALIASES: ReadonlyArray<readonly [prefix: string, target: string]> = [
  ["@/", "src/"],
  ["@jams/engine-testing", "packages/engine/__tests__/testing"],
  ["@jams/engine/", "packages/engine/"],
  ["@jams/engine", "packages/engine/index"],
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveSource(from: string, specifier: string): string | undefined {
  const bare = specifier.split("?")[0]!;
  let base: string | undefined;
  if (bare.startsWith(".")) base = resolve(dirname(from), bare);
  else {
    const alias = ALIASES.find(([prefix]) => bare === prefix || bare.startsWith(prefix));
    if (alias) base = resolve(ROOT, alias[1] + bare.slice(alias[0].length));
  }
  if (!base) return undefined;
  if (/\.(tsx?)$/.test(base) && existsSync(base)) return base;
  for (const ext of SOURCE_EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return undefined;
}

/** Whether an import or export declaration carries a value at runtime. */
function carriesValue(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return false;
    const clause = node.exportClause;
    if (clause && ts.isNamedExports(clause))
      return clause.elements.length === 0 || clause.elements.some((e) => !e.isTypeOnly);
    return true;
  }
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.length === 0 || bindings.elements.some((e) => !e.isTypeOnly);
}

const SERVER_ROOTS = new Set(["createIsomorphicFn", "createServerFn", "createMiddleware"]);
const SERVER_METHODS = new Set(["server", "handler"]);

function chainRoot(node: ts.Expression): string | undefined {
  let at: ts.Expression = node;
  while (ts.isCallExpression(at) || ts.isPropertyAccessExpression(at)) at = at.expression;
  return ts.isIdentifier(at) ? at.text : undefined;
}

/** A callback TanStack Start drops from the browser build, with the imports only it uses. */
function isServerBranch(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "createServerOnlyFn";
  return (
    ts.isPropertyAccessExpression(callee) &&
    SERVER_METHODS.has(callee.name.text) &&
    SERVER_ROOTS.has(chainRoot(callee.expression) ?? "")
  );
}

function localNames(node: ts.ImportDeclaration): string[] {
  const clause = node.importClause;
  if (!clause) return [];
  const names = clause.name ? [clause.name.text] : [];
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
  else if (bindings) for (const e of bindings.elements) if (!e.isTypeOnly) names.push(e.name.text);
  return names;
}

function valueSpecifiers(file: string, text = readFileSync(file, "utf8")): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const found: string[] = [];
  const browserNames = new Set<string>();
  const imports: Array<{ specifier: string; names: string[] }> = [];
  const visit = (node: ts.Node, stripped: boolean): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!carriesValue(node)) return;
      const specifier = node.moduleSpecifier.text;
      const names = ts.isImportDeclaration(node) ? localNames(node) : [];
      if (names.length > 0) imports.push({ specifier, names });
      else found.push(specifier);
      return;
    }
    if (
      !stripped &&
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      found.push(node.arguments[0].text);
    if (!stripped && ts.isIdentifier(node)) browserNames.add(node.text);
    if (isServerBranch(node)) {
      const call = node as ts.CallExpression;
      visit(call.expression, stripped);
      for (const arg of call.arguments) visit(arg, true);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, stripped));
  };
  visit(source, false);
  for (const { specifier, names } of imports)
    if (names.some((name) => browserNames.has(name))) found.push(specifier);
  return found;
}

/** Each file's value specifiers, parsed once for every walk that reaches it. */
const parsed = new Map<string, string[]>();

function fileSpecifiers(file: string): string[] {
  let specifiers = parsed.get(file);
  if (!specifiers) parsed.set(file, (specifiers = valueSpecifiers(file)));
  return specifiers;
}

/** Every value-import chain from `entries` that ends in a server-only module. */
function serverOnlyChains(entries: readonly string[]): string[] {
  const parent = new Map<string, string | undefined>();
  const queue: string[] = [];
  for (const entry of entries) {
    const file = resolve(ROOT, entry);
    parent.set(file, undefined);
    queue.push(file);
  }
  const chains: string[] = [];
  const chainOf = (file: string): string[] => {
    const path: string[] = [];
    for (let at: string | undefined = file; at; at = parent.get(at))
      path.unshift(relative(ROOT, at));
    return path;
  };
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of fileSpecifiers(file)) {
      if (isServerOnly(specifier)) {
        chains.push([...chainOf(file), specifier].join(" -> "));
        continue;
      }
      const next = resolveSource(file, specifier);
      if (!next || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return chains;
}

describe("the play page's client imports", () => {
  it("reach no database or drizzle module", () => {
    expect(serverOnlyChains(CLIENT_ENTRIES)).toEqual([]);
  });

  it("would catch a value import of the schema", () => {
    expect(serverOnlyChains(["src/lib/engine/save-api.ts"]).length).toBeGreaterThan(0);
  });

  it("follows value imports and skips type-only and server-branch ones", () => {
    const text = [
      'import type { A } from "./a";',
      'import { type B } from "./b";',
      'import { c } from "./c";',
      'import router from "./router";',
      'import { report } from "./report";',
      'export type { D } from "./d";',
      'export { e } from "./e";',
      "const fn = createIsomorphicFn()",
      "  .server(() => report(router))",
      "  .client(() => c);",
      'const lazy = () => import("./f");',
    ].join("\n");
    expect(valueSpecifiers("x.ts", text).sort()).toEqual(["./c", "./e", "./f"]);
    const leaky = text.replace(".client(() => c)", ".client(() => router)");
    expect(valueSpecifiers("x.ts", leaky)).toContain("./router");
  });
});

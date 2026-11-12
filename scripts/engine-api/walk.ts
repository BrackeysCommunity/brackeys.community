/**
 * The compiler-API walk over a packed package's `.d.mts` files, shared by the
 * API report (`scripts/engine-api-report.ts`) and the API reference
 * (`scripts/engine-api-docs.ts`): each file's imports, exports and top-level
 * declarations, and what every public export resolves to.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import ts from "typescript";

import { lcsPairs } from "../../packages/engine/scene/diff";

export type Binding =
  | { kind: "local"; name: string }
  | { kind: "import"; spec: string; name: string }
  | { kind: "external"; spec: string; name: string };

export type Decl = {
  /** The source file the declaration came from, from the bundler's `//#region` markers. */
  region: string;
  name: string;
  /** The declaration printed without comments, unions sorted and bundler artefacts removed. */
  text: string;
  stmt: ts.Statement;
  sf: ts.SourceFile;
};

export type Module = {
  decls: Map<string, Decl[]>;
  /** Local names bound by imports. */
  imports: Map<string, Binding>;
  /** Exported name to what it stands for. */
  exports: Map<string, Binding>;
  stars: string[];
};

/** What an exported name ends at: a declaration in some file, or another package's export. */
export type Target = { file: string; local: string } | { external: string; name: string };

const bare = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const commented = ts.createPrinter({ removeComments: false, newLine: ts.NewLineKind.LineFeed });

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

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
  const key = (t: ts.Node) => bare.printNode(ts.EmitHint.Unspecified, t, sf);
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

const printed = new WeakMap<Decl, string>();

/** Where a doc comment goes on a line of its own, in front of the member it documents. */
const BODIES = new Set([
  ts.SyntaxKind.TypeLiteral,
  ts.SyntaxKind.MappedType,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EnumDeclaration,
]);

/**
 * The declaration as the reference shows it: sorted like the report, with the
 * doc comments of its members, union members and parameters kept. The
 * declaration emitter writes a member's doc at the end of the line before it,
 * so each doc is read from the text between the previous sibling and the node
 * and printed again in front of the node it belongs to.
 */
export function printDeclaration(decl: Decl): string {
  const hit = printed.get(decl);
  if (hit !== undefined) return hit;
  const { sf, stmt } = decl;
  const docs = new Map<ts.Node, string[]>();
  const collect = (node: ts.Node) => {
    ts.forEachChild(node, collect, (list) => {
      // A list at its parent's start (modifiers, a union's first member) shares the parent's doc.
      if (list.pos === node.pos) {
        list.forEach(collect);
        return undefined;
      }
      let from = list.pos;
      for (const child of list) {
        const found = [...sf.text.slice(from, child.getStart(sf)).matchAll(/\/\*\*[\s\S]*?\*\//g)];
        if (found.length > 0)
          docs.set(
            child,
            found.map((m) => m[0]),
          );
        from = child.end;
        collect(child);
      }
      return undefined;
    });
  };
  collect(stmt);

  const node = sortUnions(stmt, sf);
  const mark = (n: ts.Node) => {
    ts.setEmitFlags(n, ts.EmitFlags.NoComments);
    const original = ts.getOriginalNode(n);
    const own = docs.get(original);
    if (own) {
      const member = original.parent !== undefined && BODIES.has(original.parent.kind);
      ts.setSyntheticLeadingComments(
        n,
        own.map((raw) => {
          const lines = raw
            .slice(3, -2)
            .split("\n")
            .map((l) => l.replace(/^\s*\* ?/, "").trimEnd());
          while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
          while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
          const text =
            member && lines.length > 1
              ? `*\n${lines.map((l) => ` *${l ? ` ${l}` : ""}`).join("\n")}\n `
              : `* ${lines.map((l) => l.trim()).join(" ")} `;
          return {
            kind: ts.SyntaxKind.MultiLineCommentTrivia,
            text,
            hasTrailingNewLine: member,
            pos: -1,
            end: -1,
          };
        }),
      );
    }
    ts.forEachChild(n, mark);
  };
  mark(node);
  const out = normaliseText(commented.printNode(ts.EmitHint.Unspecified, node, sf));
  printed.set(decl, out);
  return out;
}

/** The statement's own doc comment (the last `/** … *\/` before it), without its delimiters. */
export function docComment(decl: Decl): string | null {
  const text = decl.sf.text;
  const ranges = ts.getLeadingCommentRanges(text, decl.stmt.pos) ?? [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!;
    const raw = text.slice(r.pos, r.end);
    if (r.kind !== ts.SyntaxKind.MultiLineCommentTrivia || !raw.startsWith("/**")) continue;
    const lines = raw
      .slice(3, -2)
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, "").replace(/\s+$/, ""));
    while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    const out = lines.join("\n").trim();
    return out === "" ? null : out;
  }
  return null;
}

/**
 * The names a declaration refers to in type positions, heritage clauses and
 * `typeof` queries (the leftmost identifier of a qualified name), in first-seen order.
 */
export function referencedNames(decl: Decl): string[] {
  const seen = new Set<string>();
  const leftmost = (n: ts.Node): ts.Identifier | null => {
    if (ts.isIdentifier(n)) return n;
    if (ts.isQualifiedName(n)) return leftmost(n.left);
    if (ts.isPropertyAccessExpression(n)) return leftmost(n.expression);
    return null;
  };
  const visit = (node: ts.Node) => {
    let id: ts.Identifier | null = null;
    if (ts.isTypeReferenceNode(node)) id = leftmost(node.typeName);
    else if (ts.isExpressionWithTypeArguments(node)) id = leftmost(node.expression);
    else if (ts.isTypeQueryNode(node)) id = leftmost(node.exprName);
    if (id) seen.add(id.text);
    ts.forEachChild(node, visit);
  };
  visit(decl.stmt);
  return [...seen];
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
      bare.printNode(ts.EmitHint.Unspecified, sortUnions(stmt, sf), sf),
    );
    const region = regions[sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line]!;
    for (const name of names) {
      const list = mod.decls.get(name) ?? [];
      list.push({ region, name: normaliseText(name), text: printed, stmt, sf });
      mod.decls.set(name, list);
      if (hasExport(stmt)) mod.exports.set(name, { kind: "local", name });
    }
  }
  return mod;
}

export type Walk = {
  /** Every file loaded so far, by path relative to the package root. */
  mods: Map<string, Module>;
  load: (file: string) => Module;
  /** What `name` in `file`'s own scope (a declaration or an import) ends at. */
  resolveLocal: (file: string, name: string) => Target | null;
  resolveExport: (file: string, name: string) => Target | null;
  /** The entry file's public names, sorted; a star re-export of another package shows as `* from "<spec>"`. */
  entryNames: (file: string) => string[];
};

/** A walk over the `.d.mts` files `read` returns by path relative to the package root (`null` for a missing file). */
export function createWalk(read: (file: string) => string | null): Walk {
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
    if (b.kind === "import") return exportOf(near(file, b.spec), b.name, seen);
    const mod = load(file);
    if (mod.decls.has(b.name)) return { file, local: b.name };
    const imported = mod.imports.get(b.name);
    return imported ? resolveBinding(file, imported, seen) : null;
  };
  const exportOf = (file: string, name: string, seen: Set<string>): Target | null => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const mod = load(file);
    const b = mod.exports.get(name);
    if (b) return resolveBinding(file, b, seen);
    for (const spec of mod.stars) {
      if (!isRelative(spec)) continue;
      const hit = exportOf(near(file, spec), name, seen);
      if (hit) return hit;
    }
    return null;
  };

  return {
    mods,
    load,
    resolveLocal: (file, name) => resolveBinding(file, { kind: "local", name }, new Set()),
    resolveExport: (file, name) => exportOf(file, name, new Set()),
    entryNames: (file) => {
      const mod = load(file);
      const names = [...mod.exports.keys()];
      for (const spec of mod.stars) {
        if (isRelative(spec)) names.push(...load(near(file, spec)).exports.keys());
        else names.push(`* from "${spec}"`);
      }
      return [...new Set(names)].sort(cmp);
    },
  };
}

/** The display name of a public subpath: `@x/pkg` for `.`, `@x/pkg/view` for `./view`. */
export function entryTitle(pkgName: string, subpath: string): string {
  return subpath === "." ? pkgName : `${pkgName}/${subpath.replace(/^\.\//, "")}`;
}

export type PackageEntries = {
  name: string;
  /** Each public subpath to its declaration file, relative to the package root. */
  entries: Record<string, string>;
  read: (file: string) => string | null;
};

/** The package at `root`: its name and its `package.json` exports' `types` files. */
export function readPackage(root: string): PackageEntries {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, string | { types?: string }>;
  };
  const entries: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === "object" && target.types)
      entries[subpath] = target.types.replace(/^\.\//, "");
  }
  return {
    name: pkg.name,
    entries,
    read: (file) => {
      const path = join(root, file);
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    },
  };
}

/** The changed lines between two texts, `-` for the checked-in copy and `+` for the new one. */
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

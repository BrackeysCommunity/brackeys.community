/**
 * The engine's API reference: one Markdown page per public entry under
 * `packages/engine/docs/api/`, each export with its signature and its doc
 * comment, linked to the other exports of the same entry it refers to, and a
 * `README.md` index. Read from the packed `.d.mts` files with the API report's
 * walk, so it shows what a consumer of the package sees. CI fails when the
 * checked-in pages differ.
 *
 *   vp run engine:pack && bun scripts/engine-api-docs.ts                     # --check (the default)
 *   vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts   # after a reviewed API change
 *
 * `--root <dir>` reads another package and `--out <dir>` writes elsewhere
 * (default `<root>/docs/api`), for tests.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  cmp,
  createWalk,
  type Decl,
  docComment,
  entryTitle,
  normaliseText,
  printDeclaration,
  readPackage,
  referencedNames,
  reportDiff,
  type Walk,
} from "./engine-api/walk";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(REPO, "packages/engine");

const REGENERATE = "vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts";

/** The page an entry's reference lives on: `index.md` for `.`, `editor-ui.md` for `./editor-ui`. */
export function entryPage(subpath: string): string {
  return subpath === "." ? "index.md" : `${subpath.replace(/^\.\//, "").replace(/\//g, "-")}.md`;
}

/** Heading anchors as GitLab and GitHub derive them, numbered from `-1` on a repeat. */
function slugger() {
  const used = new Map<string, number>();
  return (heading: string) => {
    const base = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s/g, "-");
    const n = used.get(base);
    used.set(base, (n ?? -1) + 1);
    return n === undefined ? base : `${base}-${n + 1}`;
  };
}

function kindOf(stmt: ts.Statement): string {
  if (ts.isFunctionDeclaration(stmt)) return "function";
  if (ts.isClassDeclaration(stmt)) return "class";
  if (ts.isInterfaceDeclaration(stmt)) return "interface";
  if (ts.isTypeAliasDeclaration(stmt)) return "type";
  if (ts.isEnumDeclaration(stmt)) return "enum";
  if (ts.isModuleDeclaration(stmt)) return "namespace";
  if (ts.isVariableStatement(stmt))
    return stmt.declarationList.flags & ts.NodeFlags.Const ? "const" : "variable";
  return "declaration";
}

const code = (text: string) => {
  const run = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const tick = "`".repeat(run + 1);
  return run === 0 ? `${tick}${text}${tick}` : `${tick} ${text} ${tick}`;
};

const fenced = (text: string) => {
  const run = Math.max(0, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, run + 1));
  return `${fence}ts\n${text}\n${fence}`;
};

type Export = {
  name: string;
  heading: string;
  anchor: string;
  /** Set for a re-export of another package's name. */
  external?: { spec: string; name: string };
  file?: string;
  local?: string;
  decls: Decl[];
};

function entryDoc(pkgName: string, subpath: string, file: string, walk: Walk): string {
  const slug = slugger();
  const title = entryTitle(pkgName, subpath);
  slug(title);

  const stars: string[] = [];
  const exports: Export[] = [];
  const unresolved: string[] = [];
  for (const name of walk.entryNames(file)) {
    const star = /^\* from "(.+)"$/.exec(name);
    if (star) {
      stars.push(star[1]!);
      continue;
    }
    const target = walk.resolveExport(file, name);
    if (!target) {
      unresolved.push(name);
      continue;
    }
    const heading = code(name);
    const anchor = slug(name);
    if ("external" in target) {
      exports.push({
        name,
        heading,
        anchor,
        external: { spec: target.external, name: target.name },
        decls: [],
      });
      continue;
    }
    const decls = walk.load(target.file).decls.get(target.local) ?? [];
    exports.push({ name, heading, anchor, file: target.file, local: target.local, decls });
  }

  const byTarget = new Map<string, Export>();
  for (const e of exports) {
    if (e.file === undefined) continue;
    const key = `${e.file}#${e.local}`;
    if (!byTarget.has(key)) byTarget.set(key, e);
  }
  const byName = new Map(exports.map((e) => [e.name, e]));
  const link = (e: Export) => `[${code(e.name)}](#${e.anchor})`;
  const linkTags = (text: string) =>
    text.replace(
      /\{@link(?:code|plain)?\s+([^\s}|]+)(?:[\s|]+([^}]*))?\}/g,
      (_, ref: string, label?: string) => {
        const hit = byName.get(ref);
        const shown = label?.trim() ? label.trim() : ref;
        return hit ? `[${code(shown)}](#${hit.anchor})` : code(shown);
      },
    );

  const out: string[] = [
    `# ${title}`,
    "",
    `Generated from the packed \`.d.mts\` files by \`scripts/engine-api-docs.ts\`; regenerate with \`${REGENERATE}\`. [All entries](README.md)`,
  ];
  if (exports.length > 0) out.push("", exports.map(link).join(" · "));
  for (const spec of stars) out.push("", `Re-exports everything from ${code(spec)}.`);
  if (unresolved.length > 0)
    out.push("", `Unresolved in the packed types: ${unresolved.map(code).join(", ")}.`);

  for (const e of exports) {
    out.push("", `## ${e.heading}`, "");
    if (e.external) {
      out.push(
        `Re-exported from ${code(e.external.spec)}${e.external.name === e.name ? "" : ` as ${code(e.external.name)}`}.`,
      );
      continue;
    }
    const local = normaliseText(e.local!);
    const kinds = [...new Set(e.decls.map((d) => kindOf(d.stmt)))].join(", ");
    const regions = [...new Set(e.decls.map((d) => d.region))].filter((r) => r !== "(no region)");
    const where = regions.length > 0 ? ` in ${regions.map(code).join(", ")}` : "";
    const alias = local === e.name ? "" : ` · declared as ${code(local)}`;
    out.push(`_${kinds}_${alias}${where}`);

    const docs = [...new Set(e.decls.flatMap((d) => docComment(d) ?? []))];
    for (const doc of docs) out.push("", linkTags(doc));

    out.push("", fenced(e.decls.map(printDeclaration).join("\n")));

    const refs = new Map<string, Export>();
    for (const d of e.decls) {
      for (const id of referencedNames(d)) {
        const t = walk.resolveLocal(e.file!, id);
        if (!t || "external" in t) continue;
        const hit = byTarget.get(`${t.file}#${t.local}`);
        if (hit && hit !== e) refs.set(hit.name, hit);
      }
    }
    if (refs.size > 0) {
      const sorted = [...refs.values()].sort((a, b) => cmp(a.name, b.name));
      out.push("", `Refers to ${sorted.map(link).join(", ")}.`);
    }
  }
  return `${out.join("\n")}\n`;
}

/**
 * The reference pages for a package whose `.d.mts` files `read` returns by
 * path relative to the package root, by page file name; `entries` maps each
 * public subpath to its declaration file.
 */
export function apiDocs(
  pkgName: string,
  entries: Readonly<Record<string, string>>,
  read: (file: string) => string | null,
): Map<string, string> {
  const walk = createWalk(read);
  const pages = new Map<string, string>();
  const rows: string[] = [];
  for (const [subpath, file] of Object.entries(entries).sort(([a], [b]) => cmp(a, b))) {
    const page = entryPage(subpath);
    pages.set(page, entryDoc(pkgName, subpath, file, walk));
    const count = walk.entryNames(file).filter((n) => !n.startsWith("* from")).length;
    rows.push(`| [${code(entryTitle(pkgName, subpath))}](${page}) | ${count} |`);
  }
  pages.set(
    "README.md",
    [
      `# ${pkgName} API reference`,
      "",
      "One page per public entry: each export with its signature, its doc comment and links to the types of the same entry it refers to.",
      "",
      `Generated from the packed \`.d.mts\` files by \`scripts/engine-api-docs.ts\`; regenerate with \`${REGENERATE}\`.`,
      "",
      "| Entry | Exports |",
      "| --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
  return new Map([...pages].sort(([a], [b]) => cmp(a, b)));
}

const listPages = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort(cmp)
    : [];

/** What differs between the pages and the `.md` files in `dir`, one block per file; empty when they match. */
export function docsDiff(pages: ReadonlyMap<string, string>, dir: string): string[] {
  const out: string[] = [];
  for (const [page, actual] of pages) {
    const path = join(dir, page);
    if (!existsSync(path)) {
      out.push(`${page}: missing`);
      continue;
    }
    const expected = readFileSync(path, "utf8");
    if (expected !== actual) out.push(`${page}:\n${reportDiff(expected, actual, 50)}`);
  }
  for (const page of listPages(dir)) if (!pages.has(page)) out.push(`${page}: no longer generated`);
  return out;
}

export function writeDocs(pages: ReadonlyMap<string, string>, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const page of listPages(dir)) if (!pages.has(page)) rmSync(join(dir, page));
  for (const [page, text] of pages) writeFileSync(join(dir, page), text);
}

function main(argv: string[]): number {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = resolve(flag("--root") ?? ENGINE);
  const dir = resolve(flag("--out") ?? join(root, "docs/api"));
  let pages: Map<string, string>;
  try {
    const pkg = readPackage(root);
    pages = apiDocs(pkg.name, pkg.entries, pkg.read);
  } catch (e) {
    console.error(`engine-api-docs: ${(e as Error).message}. Run \`vp run engine:pack\` first.`);
    return 1;
  }
  if (process.env.UPDATE_API_DOCS === "1") {
    writeDocs(pages, dir);
    console.log(`engine-api-docs: wrote ${pages.size} pages to ${dir}`);
    return 0;
  }
  const diff = docsDiff(pages, dir);
  if (diff.length === 0) {
    console.log("engine-api-docs: the API reference matches the packed types");
    return 0;
  }
  console.error(
    [
      `engine-api-docs: the packed API differs from the reference in ${dir}:`,
      ...diff,
      "",
      `If the change is intended, run \`${REGENERATE}\` and commit the pages.`,
    ].join("\n"),
  );
  return 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));

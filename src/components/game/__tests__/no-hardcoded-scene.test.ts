import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

import { hostedGames } from "../hosted-games";

/** Where the site's game route lives: it plays a project's start scene and names none itself. */
const ROOTS = ["src/components/game", "src/routes/game", "src/routes/game.tsx"];

const SOURCE = /\.(?:ts|tsx)$/;

function sources(path: string): string[] {
  if (statSync(path).isFile()) return SOURCE.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => name !== "__tests__")
    .flatMap((name) => sources(join(path, name)));
}

/** Every string literal in `text` (quoted, or a template without substitutions), with its line. */
function stringLiterals(file: string, text: string): { value: string; line: number }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: { value: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      out.push({
        value: node.text,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** `file:line "id"` for each literal in `text` that is one of `ids`. */
const literalsNaming = (file: string, text: string, ids: ReadonlySet<string>) =>
  stringLiterals(file, text)
    .filter(({ value }) => ids.has(value))
    .map(({ value, line }) => `${file}:${line} "${value}"`);

describe("the site's game route", () => {
  it("finds a scene id written as a string literal, in code and in JSX", () => {
    const ids = new Set(["test-yard", "menu"]);
    const text = [
      'const scene = "test-yard";',
      "const other = `menu`;",
      "const fine = `menu-${scene}`;",
      'const el = <div role="menu">test-yard</div>;',
    ].join("\n");
    expect(literalsNaming("probe.tsx", text, ids)).toEqual([
      'probe.tsx:1 "test-yard"',
      'probe.tsx:2 "menu"',
      'probe.tsx:4 "menu"',
    ]);
  });

  // Loading every hosted game parses all its scenes, megabytes for the stress game.
  it("names no listed scene of any hosted game as a string literal", async () => {
    const ids = new Set<string>();
    for (const game of hostedGames()) {
      const { flow } = await game.load();
      for (const { scene } of flow.list()) ids.add(scene);
    }
    expect(ids.size).toBeGreaterThan(0);
    const files = ROOTS.flatMap(sources);
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((file) => literalsNaming(file, readFileSync(file, "utf8"), ids));
    expect(found).toEqual([]);
  }, 30_000);
});

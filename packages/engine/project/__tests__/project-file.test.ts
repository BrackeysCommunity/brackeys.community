import { describe, expect, it } from "vite-plus/test";

import {
  formatJsonDocument,
  formatProjectFile,
  parseProjectFile,
  PROJECT_FILE_DEFAULTS,
  projectGlobs,
} from "../project-file";
import type { ProjectFile } from "../types";

const platformer: ProjectFile = {
  $schema: "../../engine/project/project.schema.json",
  kind: "project",
  v: 1,
  id: "platformer",
  name: "Platformer",
  game: { module: "./index.ts", export: "platformerGame" },
  assets: ["scenes/**"],
  code: ["**/*.ts", "!**/__tests__/**"],
};

const PLATFORMER_TEXT = `{
  "$schema": "../../engine/project/project.schema.json",
  "kind": "project",
  "v": 1,
  "id": "platformer",
  "name": "Platformer",
  "game": { "module": "./index.ts", "export": "platformerGame" },
  "assets": ["scenes/**"],
  "code": ["**/*.ts", "!**/__tests__/**"]
}
`;

const minimal = { kind: "project", v: 1, id: "engine", name: "Engine", game: null };

const codesOf = (input: unknown) => {
  const r = parseProjectFile(input);
  return r.ok ? [] : r.issues.map((i) => [i.code, i.path]);
};

describe("parseProjectFile", () => {
  it("reads the documented example", () => {
    const r = parseProjectFile(PLATFORMER_TEXT);
    expect(r).toEqual({ ok: true, file: platformer });
  });

  it("takes a parsed value and leaves omitted globs omitted", () => {
    const r = parseProjectFile(minimal);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.file).toEqual(minimal);
    expect("assets" in r.file).toBe(false);
  });

  it("refuses bad JSON, another kind, a newer v", () => {
    expect(codesOf("{")).toEqual([["schema", ""]]);
    expect(codesOf({ ...minimal, kind: "prefab" })).toEqual([["schema", "/kind"]]);
    expect(codesOf([])).toEqual([["schema", ""]]);
    expect(codesOf({ ...minimal, v: 2 })).toEqual([["version-newer", "/v"]]);
    expect(codesOf({ ...minimal, v: 0 })).toEqual([["schema", "/v"]]);
  });

  it("refuses unknown keys and bad ids", () => {
    expect(codesOf({ ...minimal, scenes: [] })).toEqual([["unknown-key", "/scenes"]]);
    expect(codesOf({ ...minimal, game: { module: "./i.ts", export: "g", x: 1 } })).toEqual([
      ["unknown-key", "/game/x"],
    ]);
    expect(codesOf({ ...minimal, id: "Engine" })).toEqual([["bad-id", "/id"]]);
  });

  it("refuses a game module that isn't relative, or a bad export name", () => {
    expect(codesOf({ ...minimal, game: { module: "index.ts", export: "g" } })).toEqual([
      ["schema", "/game/module"],
    ]);
    expect(codesOf({ ...minimal, game: { module: "./index.ts", export: "1g" } })).toEqual([
      ["schema", "/game/export"],
    ]);
  });

  it("refuses globs that leave the project root", () => {
    for (const g of ["/abs/**", "../x/**", "a/../../b", "!../x", "a\\b", "", "!"])
      expect(codesOf({ ...minimal, assets: [g] }), g).toEqual([["schema", "/assets/0"]]);
    expect(codesOf({ ...minimal, assets: ["scenes/**", "!**/*.tmp.json"] })).toEqual([]);
  });
});

describe("projectGlobs", () => {
  it("fills the defaults for omitted globs and keeps written ones", () => {
    const parsed = parseProjectFile(minimal);
    if (!parsed.ok) throw new Error("unparsed");
    expect(projectGlobs(parsed.file)).toEqual({
      assets: ["**"],
      code: ["**/*.ts", "**/*.tsx"],
      ignore: [],
    });
    expect(PROJECT_FILE_DEFAULTS.assets).toEqual(["**"]);
    expect(projectGlobs({ ...platformer, ignore: ["**/*.tmp"] })).toEqual({
      assets: ["scenes/**"],
      code: ["**/*.ts", "!**/__tests__/**"],
      ignore: ["**/*.tmp"],
    });
    expect(projectGlobs({ ...platformer, code: [] }).code).toEqual([]);
  });

  it("returns copies", () => {
    const globs = projectGlobs(platformer);
    globs.assets.push("x");
    expect(platformer.assets).toEqual(["scenes/**"]);
  });
});

describe("formatProjectFile", () => {
  it("writes the documented example byte for byte", () => {
    expect(formatProjectFile(platformer)).toBe(PLATFORMER_TEXT);
  });

  it("orders keys by the schema, whatever order they were set in", () => {
    const shuffled = {
      code: platformer.code,
      game: { export: "platformerGame", module: "./index.ts" },
      name: "Platformer",
      assets: platformer.assets,
      id: "platformer",
      v: 1,
      kind: "project",
      $schema: platformer.$schema,
    } as ProjectFile;
    expect(formatProjectFile(shuffled)).toBe(PLATFORMER_TEXT);
  });

  it("round-trips: format of a parse is the same text", () => {
    for (const file of [platformer, minimal as ProjectFile, { ...platformer, ignore: ["x/**"] }]) {
      const text = formatProjectFile(file);
      const parsed = parseProjectFile(text);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      expect(formatProjectFile(parsed.file)).toBe(text);
    }
  });

  it("breaks a value onto lines only when it passes 100 columns", () => {
    const long = Array.from({ length: 8 }, (_, i) => `assets/folder-${i}/**/*.json`);
    const text = formatProjectFile({ ...platformer, assets: long });
    expect(text).toContain(`  "assets": [\n    "assets/folder-0/**/*.json",\n`);
    expect(text.split("\n").every((line) => line.length <= 100)).toBe(true);
  });
});

describe("formatJsonDocument", () => {
  it("prints nested values inline when they fit and expands them when they don't", () => {
    expect(formatJsonDocument({ a: { b: [1, 2] }, c: [], d: {} })).toBe(
      `{\n  "a": { "b": [1, 2] },\n  "c": [],\n  "d": {}\n}\n`,
    );
    const wide = { k: "x".repeat(100) };
    expect(formatJsonDocument({ o: wide })).toBe(
      `{\n  "o": {\n    "k": "${"x".repeat(100)}"\n  }\n}\n`,
    );
  });

  it("always breaks a list of several multi-key objects", () => {
    expect(
      formatJsonDocument({
        l: [
          { a: 1, b: 2 },
          { a: 3, b: 4 },
        ],
      }),
    ).toBe(`{\n  "l": [\n    { "a": 1, "b": 2 },\n    { "a": 3, "b": 4 }\n  ]\n}\n`);
    expect(formatJsonDocument({ l: [{ a: 1 }, { a: 2 }] })).toBe(
      `{\n  "l": [{ "a": 1 }, { "a": 2 }]\n}\n`,
    );
  });

  it("fills long number lists and writes exponents without a plus", () => {
    const text = formatJsonDocument({
      n: Array.from({ length: 50 }, (_, i) => i * 100),
      e: [3e21],
    });
    const lines = text.split("\n");
    expect(lines[1]).toBe(`  "n": [`);
    expect(lines[2]).toMatch(/^ {4}0, 100, 200, /);
    expect(lines.every((l) => l.length <= 100)).toBe(true);
    expect(text).toContain(`"e": [3e21]`);
    expect(JSON.parse(text)).toEqual({
      n: Array.from({ length: 50 }, (_, i) => i * 100),
      e: [3e21],
    });
  });
});

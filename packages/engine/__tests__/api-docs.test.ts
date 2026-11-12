// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

/** The docs script runs as a CLI, as CI runs it, so this test imports nothing outside the package. */
const SCRIPT = fileURLToPath(new URL("../../../scripts/engine-api-docs.ts", import.meta.url));

// Split so Vite doesn't take it for this file's own source map.
const MAP_COMMENT = ["//#", "sourceMappingURL"].join(" ");

const MOVE = "declare function move(p: Pt, by: Pt): Pt;";

const chunk = (hash: string, signature: string) => `import { Container } from "pixi.js";

//#region scene/types.d.ts
/** A point. */
type Pt = [x: number, y: number];
/** Where a thing sits. */
type Place = {
  at: Pt; /** Quarter turns, clockwise. */
  turn: number;
};
//#endregion
//#region scene/move.d.ts
/**
 * Moves a point.
 *
 * Use {@link Place} for a whole placement.
 */
${signature}
interface Thing$1 {
  view: Container;
  place: Place;
}
//#endregion
export { Place as i, Pt as n, move as r, Thing$1 as t };
${MAP_COMMENT}=types-${hash}.d.mts.map
`;

let root: string;
const docs = () => join(root, "docs/api");
const page = (name: string) => readFileSync(join(docs(), name), "utf8");

function pack(hash: string, signature = MOVE) {
  rmSync(join(root, "dist"), { recursive: true, force: true });
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", `types-${hash}.d.mts`), chunk(hash, signature));
  writeFileSync(
    join(root, "dist/index.d.mts"),
    `import { i as Place, n as Pt, r as move } from "./types-${hash}.mjs";\nexport { type Place, type Pt, move };\n`,
  );
  writeFileSync(
    join(root, "dist/view.d.mts"),
    `import { i as Place, t as Thing } from "./types-${hash}.mjs";\nimport { Container } from "pixi.js";\nexport { Container, type Place, type Thing as View };\n`,
  );
}

function run(env: Record<string, string> = {}, ...args: string[]) {
  const r = spawnSync("bun", [SCRIPT, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, UPDATE_API_DOCS: "", ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const write = () => run({ UPDATE_API_DOCS: "1" });

const REGENERATE =
  "Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`.";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "api-docs-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "@x/pkg",
      exports: {
        ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
        "./view": { types: "./dist/view.d.mts" },
        "./schema.json": "./schema.json",
      },
    }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("engine-api-docs", () => {
  it("writes one page per entry and an index, with signatures, doc comments and links", () => {
    pack("AbCd_f12");
    expect(write().status).toBe(0);
    expect(readdirSync(docs()).sort()).toEqual(["README.md", "index.md", "view.md"]);
    expect(page("README.md")).toBe(
      [
        "# @x/pkg API reference",
        "",
        "One page per public entry: each export with its signature, its doc comment and links to the types of the same entry it refers to.",
        "",
        REGENERATE,
        "",
        "| Entry | Exports |",
        "| --- | --- |",
        "| [`@x/pkg`](index.md) | 3 |",
        "| [`@x/pkg/view`](view.md) | 3 |",
        "",
      ].join("\n"),
    );
    expect(page("index.md")).toBe(
      [
        "# @x/pkg",
        "",
        `${REGENERATE} [All entries](README.md)`,
        "",
        "[`Place`](#place) · [`Pt`](#pt) · [`move`](#move)",
        "",
        "## `Place`",
        "",
        "_type_ in `scene/types.ts`",
        "",
        "Where a thing sits.",
        "",
        "```ts",
        "type Place = {",
        "    at: Pt;",
        "    /** Quarter turns, clockwise. */",
        "    turn: number;",
        "};",
        "```",
        "",
        "Refers to [`Pt`](#pt).",
        "",
        "## `Pt`",
        "",
        "_type_ in `scene/types.ts`",
        "",
        "A point.",
        "",
        "```ts",
        "type Pt = [",
        "    x: number,",
        "    y: number",
        "];",
        "```",
        "",
        "## `move`",
        "",
        "_function_ in `scene/move.ts`",
        "",
        "Moves a point.",
        "",
        "Use [`Place`](#place) for a whole placement.",
        "",
        "```ts",
        "declare function move(p: Pt, by: Pt): Pt;",
        "```",
        "",
        "Refers to [`Pt`](#pt).",
        "",
      ].join("\n"),
    );
    expect(page("view.md")).toBe(
      [
        "# @x/pkg/view",
        "",
        `${REGENERATE} [All entries](README.md)`,
        "",
        "[`Container`](#container) · [`Place`](#place) · [`View`](#view)",
        "",
        "## `Container`",
        "",
        "Re-exported from `pixi.js`.",
        "",
        "## `Place`",
        "",
        "_type_ in `scene/types.ts`",
        "",
        "Where a thing sits.",
        "",
        "```ts",
        "type Place = {",
        "    at: Pt;",
        "    /** Quarter turns, clockwise. */",
        "    turn: number;",
        "};",
        "```",
        "",
        "## `View`",
        "",
        "_interface_ · declared as `Thing` in `scene/move.ts`",
        "",
        "```ts",
        "interface Thing {",
        "    view: Container;",
        "    place: Place;",
        "}",
        "```",
        "",
        "Refers to [`Place`](#place).",
        "",
      ].join("\n"),
    );
    expect(run({}, "--check")).toMatchObject({ status: 0 });
  });

  it("passes when only the chunk hashes change", () => {
    pack("AbCd_f12");
    write();
    pack("Zz-9yX8w");
    expect(run({}, "--check")).toMatchObject({ status: 0 });
  });

  it("fails --check on a signature change, naming the page and the changed lines", () => {
    pack("AbCd_f12");
    write();
    pack("AbCd_f12", "declare function move(p: Pt, by?: Pt): Pt;");
    const r = run({}, "--check");
    expect(r.status).toBe(1);
    expect(r.out).toContain("index.md:");
    expect(r.out).toContain("- 45: declare function move(p: Pt, by: Pt): Pt;");
    expect(r.out).toContain("+ 45: declare function move(p: Pt, by?: Pt): Pt;");
    expect(r.out).toContain("UPDATE_API_DOCS=1");
    expect(r.out).not.toContain("view.md");
    expect(write().status).toBe(0);
    expect(page("index.md")).toContain("declare function move(p: Pt, by?: Pt): Pt;");
    expect(run({}, "--check").status).toBe(0);
  });

  it("fails --check on a missing or stale page, and the rewrite removes the stale one", () => {
    pack("AbCd_f12");
    write();
    rmSync(join(docs(), "view.md"));
    writeFileSync(join(docs(), "gone.md"), "# @x/pkg/gone\n");
    const r = run({}, "--check");
    expect(r.status).toBe(1);
    expect(r.out).toContain("view.md: missing");
    expect(r.out).toContain("gone.md: no longer generated");
    write();
    expect(existsSync(join(docs(), "gone.md"))).toBe(false);
    expect(run({}, "--check").status).toBe(0);
  });

  it("fails when the package isn't packed", () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain("vp run engine:pack");
  });
});

// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

/** The report script runs as a CLI, as CI runs it, so this test imports nothing outside the package. */
const SCRIPT = fileURLToPath(new URL("../../../scripts/engine-api-report.ts", import.meta.url));

// Split so Vite doesn't take it for this file's own source map.
const MAP_COMMENT = ["//#", "sourceMappingURL"].join(" ");

const chunk = (hash: string, signature: string) => `import { Container } from "pixi.js";

//#region scene/types.d.ts
/** A point. */
type Pt = [x: number, y: number];
//#endregion
//#region scene/move.d.ts
${signature}
interface Thing$1 {
  view: Container;
}
//#endregion
export { Pt as n, move as r, Thing$1 as t };
${MAP_COMMENT}=types-${hash}.d.mts.map
`;

const MOVE = "declare function move(p: Pt, by: Pt): Pt;";

let root: string;
const report = () => join(root, "api-report.txt");

function pack(hash: string, signature = MOVE) {
  rmSync(join(root, "dist"), { recursive: true, force: true });
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", `types-${hash}.d.mts`), chunk(hash, signature));
  writeFileSync(
    join(root, "dist/index.d.mts"),
    `import { n as Pt, r as move } from "./types-${hash}.mjs";\nexport { type Pt, move };\n`,
  );
  writeFileSync(
    join(root, "dist/view.d.mts"),
    `import { t as Thing } from "./types-${hash}.mjs";\nimport { Container } from "pixi.js";\nexport { Container, type Thing as View };\n`,
  );
}

function run(...args: string[]) {
  const r = spawnSync("bun", [SCRIPT, "--root", root, "--report", report(), ...args], {
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "api-report-"));
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

describe("engine-api-report", () => {
  it("lists each entry's exports and the declarations behind them, without hashes or comments", () => {
    pack("AbCd_f12");
    expect(run("--write").status).toBe(0);
    expect(readFileSync(report(), "utf8")).toBe(
      [
        "# @x/pkg API report",
        "# Generated from the packed .d.mts files by scripts/engine-api-report.ts; regenerate with --write.",
        "",
        "## @x/pkg",
        "Pt",
        "move",
        "",
        "## @x/pkg/view",
        'Container = "pixi.js".Container',
        "View = Thing",
        "",
        "## scene/move.ts",
        "interface Thing {",
        "    view: Container;",
        "}",
        "declare function move(p: Pt, by: Pt): Pt;",
        "",
        "## scene/types.ts",
        "type Pt = [",
        "    x: number,",
        "    y: number",
        "];",
        "",
      ].join("\n"),
    );
    expect(run("--check").status).toBe(0);
  });

  it("passes when only the chunk hashes change", () => {
    pack("AbCd_f12");
    run("--write");
    pack("Zz-9yX8w");
    expect(run("--check")).toMatchObject({ status: 0 });
  });

  it("fails a deliberate signature change with the changed lines", () => {
    pack("AbCd_f12");
    run("--write");
    pack("AbCd_f12", "declare function move(p: Pt, by?: Pt): Pt;");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain("- 16: declare function move(p: Pt, by: Pt): Pt;");
    expect(r.out).toContain("+ 16: declare function move(p: Pt, by?: Pt): Pt;");
  });

  it("fails when the package isn't packed", () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain("vp run engine:pack");
  });
});

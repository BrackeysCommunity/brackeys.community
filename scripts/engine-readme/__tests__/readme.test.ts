import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import {
  formatReference,
  REFERENCE_END,
  REFERENCE_START,
  withReference,
} from "../format-reference";

/**
 * Keeps `src/engine/README.md` honest: the format reference is the
 * generator's output, and every `ts` block is a file in `examples/` that `vp
 * check` type-checks against the engine's public entries. After changing
 * either on purpose, run `UPDATE_README=1 vp test run scripts/engine-readme`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const README = join(REPO, "src/engine/README.md");
const EXAMPLES = join(HERE, "../examples");
const update = process.env.UPDATE_README === "1";

/**
 * The text with what the formatter changes taken out: table padding, rule
 * widths and escapes. The README is formatted like any other file, so the
 * generator's raw output is compared in this form.
 */
const normalize = (text: string) =>
  text
    .replace(/\\([*_])/g, "$1")
    .replace(/-{3,}/g, "---")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\| ?/g, "|")
    .trim();

const section = (readme: string) =>
  readme.slice(
    readme.indexOf(REFERENCE_START) + REFERENCE_START.length,
    readme.indexOf(REFERENCE_END),
  );

type Block = { lang: string; name: string | undefined; body: string };

function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const m of markdown.matchAll(/^```(\w+)(?:[ \t]+(\S+))?\n([\s\S]*?)^```$/gm)) {
    out.push({ lang: m[1]!, name: m[2], body: m[3]! });
  }
  return out;
}

describe("the engine README", () => {
  it("has the generated scene format reference", () => {
    const readme = readFileSync(README, "utf8");
    expect(readme.indexOf(REFERENCE_START)).toBeLessThan(readme.indexOf(REFERENCE_END));
    const reference = formatReference();
    if (update && normalize(section(readme)) !== normalize(reference)) {
      writeFileSync(README, withReference(readme, reference));
      spawnSync("vp", ["fmt", README], { cwd: REPO });
    }
    expect(normalize(section(readFileSync(README, "utf8")))).toBe(normalize(reference));
  });

  it("names every ts block, and each is a file in examples/", () => {
    const ts = blocks(readFileSync(README, "utf8")).filter((b) => b.lang === "ts");
    expect(ts.length).toBeGreaterThan(0);
    const unnamed = ts.filter((b) => !b.name?.endsWith(".ts"));
    expect(
      unnamed.map((b) => b.body.split("\n")[0]),
      "every ts block needs a file name",
    ).toEqual([]);
    const names = ts.map((b) => b.name!);
    expect(new Set(names).size, "block names must be unique").toBe(names.length);

    if (update) {
      if (existsSync(EXAMPLES)) rmSync(EXAMPLES, { recursive: true });
      mkdirSync(EXAMPLES, { recursive: true });
      for (const b of ts) writeFileSync(join(EXAMPLES, b.name!), b.body);
    }
    expect(readdirSync(EXAMPLES).sort()).toEqual([...names].sort());
    for (const b of ts) {
      expect(readFileSync(join(EXAMPLES, b.name!), "utf8"), b.name).toBe(b.body);
    }
  });
});

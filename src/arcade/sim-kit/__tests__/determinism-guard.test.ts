import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vite-plus/test";

/**
 * The determinism guard `05` specifies.
 *
 * It is written as a test rather than as the lint config that plan names,
 * for two reasons. The repo has no `.oxlintrc.json` at all, so adding one
 * to carry a single scoped rule would set a lint baseline for the whole
 * tree as a side effect; and the rules that matter here (`no-restricted-
 * globals` scoped to a directory, banning `Math.sin` but not `Math.trunc`)
 * are a syntax-restriction shape oxlint does not fully cover. A scan is
 * cruder, but it runs in `vp test`, it fails loudly, and it is the check
 * that actually has to hold: everything in these directories is COPYd into
 * the validator's container and re-run there against a client's log.
 *
 * If a sim ever legitimately needs one of these, the fix is a helper in
 * `sim-kit` with the reasoning written down, not an exemption here.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

/** Directories whose contents the validator re-runs. Tests excepted. */
const GUARDED = ["sim-kit", "en-prison/sim"];

type Ban = { pattern: RegExp; why: string };

const BANS: readonly Ban[] = [
  { pattern: /\bnew Date\b|\bDate\.now\b/, why: "wall-clock time is not in the input log" },
  { pattern: /\bMath\.random\b/, why: "unseeded randomness cannot be replayed" },
  { pattern: /\bperformance\.now\b/, why: "wall-clock time is not in the input log" },
  {
    // Transcendental and irrational maths: the engines disagree in the last
    // bits, which is exactly the failure that would show up as a validator
    // mismatch nobody can reproduce. Angles are integer units for this
    // reason; trig belongs in the renderer.
    pattern: /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|pow|sqrt|cbrt|hypot)\b/,
    why: "transcendental maths is not bit-identical across engines",
  },
  { pattern: /\bMath\.fround\b/, why: "float32 rounding is a float operation" },
  { pattern: /\*\*/, why: "the exponent operator is float maths; use repeated multiplication" },
  { pattern: /\bcrypto\b/, why: "platform entropy cannot be replayed" },
  { pattern: /\bprocess\.env\b/, why: "a sim must not read its environment" },
  { pattern: /from "@\//, why: "the validator COPYs these files; alias imports do not resolve" },
  {
    // Erasable syntax only. A sim has to run after plain type-stripping so a
    // bare engine can execute it for the cross-engine check, and neither of
    // these survives that.
    pattern: /constructor\s*\([^)]*\b(readonly|public|private|protected)\b/,
    why: "a parameter property is not erasable syntax",
  },
  { pattern: /\benum\s+\w/, why: "an enum is not erasable syntax" },
];

/**
 * A float literal outside a comment. Written as a scan for a decimal point
 * between digits, which catches `0.35` and `1e-3` while leaving version
 * strings and property access alone.
 */
const FLOAT_LITERAL = /(?<![\w.])\d+\.\d+(?![\w.])|(?<![\w.])\d+e-\d+/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Strips comments and string literals so prose about `Math.random` is fine. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const FILES = GUARDED.flatMap((dir) => sourceFiles(join(ROOT, dir)));

describe("sim determinism guard", () => {
  it("finds the sim sources it is meant to guard", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  for (const ban of BANS) {
    it(`bans ${ban.pattern.source} (${ban.why})`, () => {
      const offenders = FILES.filter((file) => ban.pattern.test(code(readFileSync(file, "utf8"))));
      expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
    });
  }

  it("bans float literals", () => {
    const offenders = FILES.filter((file) => FLOAT_LITERAL.test(code(readFileSync(file, "utf8"))));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("uses relative imports with explicit .ts extensions", () => {
    // Bun resolves the COPYd tree at runtime and needs the extension; the
    // app's Vite build is happy either way, so only this check enforces it.
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from "(\.[^"]*)"/g)) {
        if (!match[1]!.endsWith(".ts")) offenders.push(`${relative(ROOT, file)} -> ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

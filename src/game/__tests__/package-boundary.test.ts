// @vitest-environment node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { ISSUE_CODES } from "../scene/issues";
import { ENGINE_VERSION } from "../version";

/**
 * The package boundary of `@jams/engine` (src/game), and the snapshot of its
 * public and agent surface in `public-api.json`. When an export, issue code or
 * CLI command changes on purpose, regenerate the snapshot with
 * `UPDATE_PUBLIC_API=1 vp test run src/game/__tests__/package-boundary.test.ts`
 * and add a CHANGELOG entry for it.
 */

const ENGINE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO = resolve(ENGINE, "../..");
const SITE = join(REPO, "src");
const SCRIPTS = join(REPO, "scripts/scene");

const ENTRIES = {
  ".": "index.ts",
  "./scene": "scene/index.ts",
  "./editor": "editor/index.ts",
  "./headless": "headless/index.ts",
  "./debug": "debug/index.ts",
  "./vite": "vite/index.ts",
} as const;

const PEERS = ["pixi.js", "@tanstack/store", "zod", "@dimforge/rapier2d"];
const TEST_ONLY = ["vite-plus/test", "@dimforge/rapier2d", "@dimforge/rapier2d-compat"];

/** The one file allowed a value import of Rapier: the shell's default loader. */
const RAPIER_VALUE_ALLOWLIST = ["engine.ts"];

/** Files in the headless graph that still draw with Pixi; emptied when drawing moves behind the view seam. */
const HEADLESS_PIXI_ALLOWLIST = [
  "entities/cloud-platform.ts",
  "entities/grapple-anchor.ts",
  "entities/moving-platform.ts",
  "entities/player.ts",
  "entities/shaper-constructs.ts",
];

/** Module-level empty arrays, Maps and Sets that are constants, not registries. */
const MODULE_STATE_ALLOWLIST: string[] = [];

// ─── Source scanning ─────────────────────────────────────

type Import = { spec: string; typeOnly: boolean; line: number };

const SKIP_DIRS = new Set(["node_modules", "dist", ".output"]);

function walk(dir: string, exts: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.test(entry.name)) out.push(full);
  }
  return out;
}

const posix = (p: string) => p.split(sep).join("/");
const rel = (file: string, root = ENGINE) => posix(relative(root, file));
const isTest = (file: string) => /(^|\/)__tests__\//.test(rel(file, REPO));

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function importsOf(file: string): Import[] {
  const src = stripComments(readFileSync(file, "utf8"));
  const lineOf = (index: number) => src.slice(0, index).split("\n").length;
  const out: Import[] = [];
  const statement = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gms;
  for (const m of src.matchAll(statement)) {
    const clause = m[3]!;
    const allTypes =
      /^\{[^}]*\}$/s.test(clause.trim()) &&
      clause
        .replace(/[{}]/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith("type "));
    out.push({ spec: m[4]!, typeOnly: Boolean(m[2]) || allTypes, line: lineOf(m.index) });
  }
  for (const m of src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    out.push({ spec: m[1]!, typeOnly: false, line: lineOf(m.index) });
  }
  for (const m of src.matchAll(/(typeof\s+)?\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push({ spec: m[2]!, typeOnly: Boolean(m[1]), line: lineOf(m.index) });
  }
  return out;
}

function resolveRelative(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(sep) && /\.(tsx?|json)$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

const engineFiles = walk(ENGINE, /\.tsx?$/).filter((f) => rel(f) !== "vite.config.ts");
const sourceFiles = engineFiles.filter((f) => !isTest(f));

/** Every runtime (non-type) import reachable from `entry`, as engine-relative files and bare specifiers. */
function runtimeGraph(entry: string): { files: Set<string>; bare: Map<string, string[]> } {
  const files = new Set<string>();
  const bare = new Map<string, string[]>();
  const queue = [join(ENGINE, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(rel(file))) continue;
    files.add(rel(file));
    for (const imp of importsOf(file)) {
      if (imp.typeOnly) continue;
      if (imp.spec.startsWith(".")) {
        const target = resolveRelative(file, imp.spec);
        if (target && target.endsWith(".ts")) queue.push(target);
      } else {
        bare.set(imp.spec, [...(bare.get(imp.spec) ?? []), rel(file)]);
      }
    }
  }
  return { files, bare };
}

const violations = (list: string[]) => expect(list, list.join("\n")).toEqual([]);

// ─── Rules ───────────────────────────────────────────────

describe("package boundary", () => {
  it("has no @/ imports and no relative imports that leave src/game", () => {
    const bad: string[] = [];
    for (const file of engineFiles) {
      for (const imp of importsOf(file)) {
        if (imp.spec.startsWith("@/")) bad.push(`${rel(file)}:${imp.line} imports ${imp.spec}`);
        if (imp.spec.startsWith(".")) {
          const target = resolve(dirname(file), imp.spec);
          if (!target.startsWith(ENGINE + sep)) {
            bad.push(`${rel(file)}:${imp.line} leaves the package: ${imp.spec}`);
          }
        }
      }
    }
    violations(bad);
  });

  it("never reads build-time env flags", () => {
    const env = new RegExp(["import", "meta", "env"].join("\\."));
    violations(
      engineFiles
        .filter((f) => env.test(stripComments(readFileSync(f, "utf8"))))
        .map((f) => rel(f)),
    );
  });

  it("imports only peers, node builtins in vite/, and test tooling in tests", () => {
    const bad: string[] = [];
    for (const file of engineFiles) {
      const path = rel(file);
      const test = isTest(file);
      for (const imp of importsOf(file)) {
        const spec = imp.spec;
        if (spec.startsWith(".") || spec.startsWith("@/")) continue;
        if (spec.startsWith("node:") && (path.startsWith("vite/") || test)) continue;
        if (test && TEST_ONLY.includes(spec)) continue;
        if (PEERS.includes(spec)) continue;
        bad.push(`${path}:${imp.line} imports ${spec}`);
      }
    }
    violations(bad);
  });

  it("imports Rapier as a value only from the default loader", () => {
    const bad: string[] = [];
    for (const file of sourceFiles) {
      for (const imp of importsOf(file)) {
        if (!imp.spec.startsWith("@dimforge/") || imp.typeOnly) continue;
        if (!RAPIER_VALUE_ALLOWLIST.includes(rel(file))) {
          bad.push(`${rel(file)}:${imp.line} imports ${imp.spec}`);
        }
      }
    }
    violations(bad);
  });

  it("keeps ./scene free of pixi.js, Rapier and @tanstack/store at runtime", () => {
    const { bare } = runtimeGraph(ENTRIES["./scene"]);
    expect([...bare.keys()].sort()).toEqual(["zod"]);
  });

  it("keeps ./vite on node builtins and ./scene", () => {
    const { bare } = runtimeGraph(ENTRIES["./vite"]);
    expect([...bare.keys()].filter((s) => !s.startsWith("node:") && s !== "zod")).toEqual([]);
  });

  it("keeps ./headless free of @tanstack/store, with Pixi only in the allowlisted files", () => {
    const { bare } = runtimeGraph(ENTRIES["./headless"]);
    expect(bare.has("@tanstack/store"), bare.get("@tanstack/store")?.join(", ")).toBe(false);
    expect([...(bare.get("pixi.js") ?? [])].sort()).toEqual(HEADLESS_PIXI_ALLOWLIST);
  });

  it("has no module-level Map, Set or array registries", () => {
    const decl =
      /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:new\s+(?:Map|Set)\b|\[\s*\])/gm;
    const found: string[] = [];
    for (const file of sourceFiles) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const m of src.matchAll(decl)) {
        const key = `${rel(file)}:${m[1]}`;
        if (!MODULE_STATE_ALLOWLIST.includes(key)) found.push(key);
      }
    }
    violations(found);
  });

  it("is consumed by the site only through @jams/engine entries", () => {
    const entries = new Set(
      Object.keys(ENTRIES).map((e) => (e === "." ? "@jams/engine" : `@jams/engine/${e.slice(2)}`)),
    );
    const bad: string[] = [];
    for (const file of walk(SITE, /\.tsx?$/)) {
      if (file.startsWith(ENGINE + sep) || file.endsWith("routeTree.gen.ts")) continue;
      for (const imp of importsOf(file)) {
        const where = `${rel(file, REPO)}:${imp.line}`;
        if (imp.spec.startsWith("@/game/") || imp.spec === "@/game") {
          if (!/^@\/game\/scenes\/[a-z0-9-]+\.json$/.test(imp.spec))
            bad.push(`${where} imports ${imp.spec}`);
        } else if (imp.spec.startsWith("@jams/engine")) {
          if (!entries.has(imp.spec)) bad.push(`${where} imports unknown entry ${imp.spec}`);
        } else if (imp.spec.startsWith(".")) {
          const target = resolve(dirname(file), imp.spec);
          if (target === ENGINE || target.startsWith(ENGINE + sep)) {
            bad.push(`${where} reaches into src/game: ${imp.spec}`);
          }
        }
      }
    }
    violations(bad);
  });

  it("keeps scripts/scene on public entries only", () => {
    const entries = new Set(
      Object.keys(ENTRIES).map((e) => (e === "." ? "@jams/engine" : `@jams/engine/${e.slice(2)}`)),
    );
    const bad: string[] = [];
    for (const file of walk(SCRIPTS, /\.tsx?$/)) {
      for (const imp of importsOf(file)) {
        const where = `${rel(file, REPO)}:${imp.line}`;
        if (imp.spec.startsWith("@/")) bad.push(`${where} imports ${imp.spec}`);
        else if (imp.spec.startsWith("@jams/engine") && !entries.has(imp.spec)) {
          bad.push(`${where} imports unknown entry ${imp.spec}`);
        } else if (imp.spec.startsWith(".")) {
          const target = resolve(dirname(file), imp.spec);
          if (target === ENGINE || target.startsWith(ENGINE + sep)) {
            bad.push(`${where} reaches into src/game: ${imp.spec}`);
          }
        }
      }
    }
    violations(bad);
  });

  it("pins ENGINE_VERSION to src/game/package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ENGINE, "package.json"), "utf8")) as {
      version: string;
      exports: Record<string, unknown>;
    };
    expect(ENGINE_VERSION).toBe(pkg.version);
    for (const entry of Object.keys(ENTRIES)) expect(pkg.exports).toHaveProperty([entry]);
  });
});

// ─── Public surface snapshot ─────────────────────────────

const SNAPSHOT = join(ENGINE, "__tests__/public-api.json");

async function surface() {
  const entries: Record<string, string[]> = {};
  for (const [entry, file] of Object.entries(ENTRIES)) {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(ENGINE, file)).href)) as object;
    entries[entry] = Object.keys(mod).sort();
  }
  const cli = (await import(
    /* @vite-ignore */ pathToFileURL(join(SCRIPTS, "commands.ts")).href
  )) as { COMMAND_NAMES: string[] };
  return {
    version: ENGINE_VERSION,
    entries,
    issueCodes: Object.keys(ISSUE_CODES).sort(),
    cliCommands: [...cli.COMMAND_NAMES].sort(),
  };
}

describe("public-api.json", () => {
  it("matches the regenerated surface", async () => {
    const current = await surface();
    const text = `${JSON.stringify(current, null, 2)}\n`;
    if (process.env.UPDATE_PUBLIC_API) writeFileSync(SNAPSHOT, text);
    const committed = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, "utf8")) : null;
    expect(
      current,
      "run UPDATE_PUBLIC_API=1 vp test run src/game/__tests__/package-boundary.test.ts",
    ).toEqual(committed);
  }, 30_000);
});

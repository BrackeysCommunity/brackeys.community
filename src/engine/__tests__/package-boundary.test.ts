// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { docKindJsonSchema } from "../project/kinds";
import { dataTableKind } from "../project/kinds/data-table";
import { gameSettingsKind } from "../project/kinds/game-settings";
import { materialKind } from "../project/kinds/material";
import { PROJECT_OP_NAMES, projectOpsJsonSchema } from "../project/ops";
import { projectJsonSchema } from "../project/project-file";
import { sidecarJsonSchema } from "../project/sidecar";
import { projectSnapshotJsonSchema } from "../project/snapshot";
import { checksJsonSchema } from "../scene/checks";
import { inputScriptJsonSchema } from "../scene/input-script";
import { ISSUE_CODES } from "../scene/issues";
import { fragmentJsonSchema, prefabJsonSchema, sceneJsonSchema } from "../scene/json-schema";
import { opsJsonSchema } from "../scene/ops-schema";
import { recordingJsonSchema } from "../scene/recording-schema";
import { OP_NAMES } from "../scene/types";
import { ENGINE_VERSION } from "../version";

/**
 * The package boundary of `@jams/engine` (src/engine), and the snapshot of its
 * public and agent surface in `public-api.json`. When an export, issue code or
 * CLI command changes on purpose, regenerate the snapshot with
 * `UPDATE_PUBLIC_API=1 vp test run src/engine/__tests__/package-boundary.test.ts`
 * (it rewrites the file only when the surface changed, then runs `vp fmt` on
 * it) and add a CHANGELOG entry for it.
 */

const ENGINE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO = resolve(ENGINE, "../..");
const SITE = join(REPO, "src");
const SCRIPTS = join(REPO, "scripts/scene");
const GAMES = join(REPO, "src/games");
const DIST = join(ENGINE, "dist");

const ENTRIES = {
  ".": "index.ts",
  "./scene": "scene/index.ts",
  "./editor": "editor/index.ts",
  "./collab": "collab/index.ts",
  "./headless": "headless/index.ts",
  "./game": "game/index.ts",
  "./debug": "debug/index.ts",
  "./sim-kit": "sim-kit/index.ts",
  "./vite": "vite/index.ts",
  "./project": "project/index.ts",
} as const;

const PEERS = [
  "pixi.js",
  "@tanstack/store",
  "zod",
  "@dimforge/rapier2d",
  "yjs",
  "fractional-indexing",
];
/** The dev sync server's optional peer; only `vite/` may import it. */
const VITE_ONLY = ["@hocuspocus/server"];
/** A provider is the host's to supply; the engine's own tests may use one as a client. */
const TEST_ONLY = [
  "vite-plus/test",
  "@dimforge/rapier2d",
  "@dimforge/rapier2d-compat",
  "@dimforge/rapier2d-deterministic-compat",
  "@hocuspocus/provider",
];
/** The engine's shared test helpers, a tsconfig alias only games' tests may import. */
const TEST_SUPPORT = "@jams/engine-testing";
/**
 * Site files a service image copies (the Dockerfile's COPY list) or a script
 * runs under plain type stripping, which reach engine entries by relative path
 * to an entry's `index.ts`, since neither has tsconfig paths.
 */
const SERVICE_SHARED = ["src/lib/scene/", "src/arcade/sim-kit/"];

/** Rapier is injected by the host, so no engine file imports it as a value. */
const RAPIER_VALUE_ALLOWLIST: string[] = [];

/** Where the engine may import pixi.js as a value: the renderer behind the view seam, the debug overlay, and the browser shell. */
const PIXI_VALUE_DIRS = ["render/", "debug/"];
const PIXI_VALUE_SHELL = ["assets.ts", "engine.ts", "renderer.ts"];

/** Words that name the first game's features; none may reach the built package. */
const GAME_WORDS = /\b(player|players|shaper|grapple|wind|constructs?|cheese|cloud|mover)\b/i;

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
const gameFiles = walk(GAMES, /\.tsx?$/);
const inside = (file: string, root: string) => file === root || file.startsWith(root + sep);
const entrySpecs = () =>
  new Set(
    Object.keys(ENTRIES).map((e) => (e === "." ? "@jams/engine" : `@jams/engine/${e.slice(2)}`)),
  );
/**
 * A game is reached through its directory's index (`src/games/platformer`),
 * or its dev-only debug layers (`src/games/platformer/debug`), loaded apart
 * so production never bundles them.
 */
const isGameEntry = (target: string) =>
  /^[a-z0-9-]+(\/debug)?(\/index(\.ts)?)?$/.test(posix(relative(GAMES, target)));

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
  it("has no @/ imports and no relative imports that leave src/engine", () => {
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
        if (VITE_ONLY.includes(spec) && (path.startsWith("vite/") || test)) continue;
        if (PEERS.includes(spec)) continue;
        bad.push(`${path}:${imp.line} imports ${spec}`);
      }
    }
    violations(bad);
  });

  it("never imports Rapier as a value: the host injects it", () => {
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

  it("imports pixi.js as a value only from render/, debug/ and the shell", () => {
    const bad: string[] = [];
    for (const file of sourceFiles) {
      const path = rel(file);
      const allowed =
        PIXI_VALUE_SHELL.includes(path) || PIXI_VALUE_DIRS.some((d) => path.startsWith(d));
      for (const imp of importsOf(file)) {
        if (imp.spec === "pixi.js" && !imp.typeOnly && !allowed) {
          bad.push(`${path}:${imp.line} imports pixi.js`);
        }
      }
    }
    violations(bad);
  });

  it("keeps ./scene free of pixi.js, Rapier and @tanstack/store at runtime", () => {
    const { bare } = runtimeGraph(ENTRIES["./scene"]);
    expect([...bare.keys()].sort()).toEqual(["zod"]);
  });

  it("keeps the transform math import-free and the scene's pure modules on zod", () => {
    expect(importsOf(join(ENGINE, "scene/transform.ts"))).toEqual([]);
    const { files } = runtimeGraph(ENTRIES["./scene"]);
    for (const file of [
      "scene/transform.ts",
      "scene/layers.ts",
      "scene/grid.ts",
      "scene/field-path.ts",
    ]) {
      expect(files.has(file), file).toBe(true);
      const own = runtimeGraph(file);
      expect(
        [...own.bare.keys()].filter((s) => s !== "zod"),
        file,
      ).toEqual([]);
      violations(
        [...own.files].filter((f) => !f.startsWith("scene/") && f !== "game/behaviors.ts"),
      );
    }
  });

  it("loads game/behaviors.ts on a server: zod and the game and scene files only", () => {
    const { files, bare } = runtimeGraph("game/behaviors.ts");
    expect([...bare.keys()].filter((s) => s !== "zod")).toEqual([]);
    violations([...files].filter((f) => !/^(game|scene)\//.test(f)));
  });

  it("keeps ./vite on node builtins, ./scene, ./collab and the dev sync server", () => {
    const { bare } = runtimeGraph(ENTRIES["./vite"]);
    const allowed = ["zod", "yjs", "fractional-indexing", ...VITE_ONLY];
    expect([...bare.keys()].filter((s) => !s.startsWith("node:") && !allowed.includes(s))).toEqual(
      [],
    );
  });

  it("keeps ./collab on yjs and the scene format, with no provider", () => {
    const { files, bare } = runtimeGraph(ENTRIES["./collab"]);
    expect([...bare.keys()].sort()).toEqual(["fractional-indexing", "yjs", "zod"]);
    violations(
      [...files].filter((f) => !/^(collab|project|scene|game)\//.test(f) && f !== "version.ts"),
    );
    const providers = sourceFiles.flatMap((f) =>
      importsOf(f)
        .filter((imp) => imp.spec.startsWith("@hocuspocus/") && !rel(f).startsWith("vite/"))
        .map((imp) => `${rel(f)}:${imp.line} imports ${imp.spec}`),
    );
    violations(providers);
  });

  it("leaves the shared provider socket to hosts", () => {
    violations(
      sourceFiles
        .filter((f) =>
          /\bHocuspocusProviderWebsocket\b/.test(stripComments(readFileSync(f, "utf8"))),
        )
        .map((f) => rel(f)),
    );
  });

  it("keeps ./project on zod and the project, scene and game files", () => {
    const { files, bare } = runtimeGraph(ENTRIES["./project"]);
    expect([...bare.keys()].sort()).toEqual(["zod"]);
    violations([...files].filter((f) => !/^(project|scene|game)\//.test(f) && f !== "version.ts"));
  });

  it("keeps ./headless free of pixi.js and @tanstack/store", () => {
    const { bare } = runtimeGraph(ENTRIES["./headless"]);
    for (const peer of ["pixi.js", "@tanstack/store"]) {
      expect(bare.has(peer), bare.get(peer)?.join(", ")).toBe(false);
    }
  });

  it("keeps ./sim-kit self-contained: no peers, nothing outside sim-kit/", () => {
    const { files, bare } = runtimeGraph(ENTRIES["./sim-kit"]);
    expect([...bare.keys()]).toEqual([]);
    violations([...files].filter((f) => !f.startsWith("sim-kit/")));
  });

  it("has no module-level Map, Set or array registries", () => {
    const decl =
      /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:new\s+(?:Map|Set)\b|\[\s*\])/gm;
    const found: string[] = [];
    for (const file of [...sourceFiles, ...gameFiles.filter((f) => !isTest(f))]) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const m of src.matchAll(decl)) {
        const key = `${rel(file, inside(file, GAMES) ? REPO : ENGINE)}:${m[1]}`;
        if (!MODULE_STATE_ALLOWLIST.includes(key)) found.push(key);
      }
    }
    violations(found);
  });

  it("is consumed by the site only through @jams/engine entries and game entries", () => {
    const entries = entrySpecs();
    const bad: string[] = [];
    for (const file of walk(SITE, /\.tsx?$/)) {
      if (inside(file, ENGINE) || inside(file, GAMES) || file.endsWith("routeTree.gen.ts"))
        continue;
      for (const imp of importsOf(file)) {
        const where = `${rel(file, REPO)}:${imp.line}`;
        const spec = imp.spec;
        if (spec.startsWith("@/engine/") || spec === "@/engine") {
          bad.push(`${where} imports ${spec}`);
        } else if (spec.startsWith("@/games/")) {
          const target = join(GAMES, spec.slice("@/games/".length));
          if (
            !isGameEntry(target) &&
            !/^@\/games\/[a-z0-9-]+\/scenes\/[a-z0-9-]+\.json$/.test(spec)
          )
            bad.push(`${where} deep-imports a game: ${spec}`);
        } else if (spec.startsWith("@jams/engine")) {
          if (!entries.has(spec)) bad.push(`${where} imports unknown entry ${spec}`);
        } else if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          const shared = SERVICE_SHARED.some((d) => rel(file, REPO).startsWith(d));
          const entryIndex = Object.values(ENTRIES).some((e) => target === join(ENGINE, e));
          if (inside(target, ENGINE) && !(shared && entryIndex))
            bad.push(`${where} reaches into src/engine: ${spec}`);
          if (inside(target, GAMES)) bad.push(`${where} reaches into src/games by path: ${spec}`);
        }
      }
    }
    violations(bad);
  });

  it("keeps scripts/scene on public entries and game entries only", () => {
    const entries = entrySpecs();
    const bad: string[] = [];
    for (const file of walk(SCRIPTS, /\.tsx?$/)) {
      for (const imp of importsOf(file)) {
        const where = `${rel(file, REPO)}:${imp.line}`;
        const spec = imp.spec;
        const target = spec.startsWith("@/")
          ? join(SITE, spec.slice(2))
          : spec.startsWith(".")
            ? resolve(dirname(file), spec)
            : null;
        if (spec.startsWith("@jams/engine") && !entries.has(spec)) {
          bad.push(`${where} imports unknown entry ${spec}`);
        } else if (target && inside(target, GAMES)) {
          if (!isGameEntry(target)) bad.push(`${where} deep-imports a game: ${spec}`);
        } else if (spec.startsWith("@/")) {
          bad.push(`${where} imports ${spec}`);
        } else if (target && inside(target, ENGINE)) {
          bad.push(`${where} reaches into src/engine: ${spec}`);
        }
      }
    }
    violations(bad);
  });

  it("ships no game code: no entry reaches src/games, and the built files and engine scenes name no game feature", () => {
    for (const file of Object.values(ENTRIES)) {
      for (const reached of runtimeGraph(file).files) {
        expect(reached, `${file} reaches ${reached}`).not.toMatch(/^\.\.\//);
      }
    }
    const built = walk(DIST, /\.(mjs|d\.mts)$/);
    const shipped = [
      ...built,
      join(ENGINE, "scene/scene.schema.json"),
      join(ENGINE, "scene/ops.schema.json"),
      join(ENGINE, "project/project.schema.json"),
      join(ENGINE, "project/asset-sidecar.schema.json"),
      join(ENGINE, "project/project-ops.schema.json"),
      join(ENGINE, "project/material.schema.json"),
      join(ENGINE, "project/game-settings.schema.json"),
      join(ENGINE, "project/data-table.schema.json"),
      join(ENGINE, "project/project-snapshot.schema.json"),
      ...walk(join(ENGINE, "scenes"), /\.json$/),
    ];
    const named = shipped
      .filter((f) => GAME_WORDS.test(readFileSync(f, "utf8")))
      .map((f) => rel(f));
    violations(named);
  });

  it("pins ENGINE_VERSION to src/engine/package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ENGINE, "package.json"), "utf8")) as {
      version: string;
      exports: Record<string, unknown>;
    };
    expect(ENGINE_VERSION).toBe(pkg.version);
    for (const entry of Object.keys(ENTRIES)) expect(pkg.exports).toHaveProperty([entry]);
  });
});

describe("game boundary", () => {
  it("keeps src/engine from importing src/games", () => {
    const bad: string[] = [];
    for (const file of engineFiles) {
      for (const imp of importsOf(file)) {
        const target = imp.spec.startsWith(".") ? resolve(dirname(file), imp.spec) : null;
        if (imp.spec.startsWith("@/games") || (target && inside(target, GAMES))) {
          bad.push(`${rel(file)}:${imp.line} imports ${imp.spec}`);
        }
      }
    }
    violations(bad);
  });

  it("lets a game import pixi.js only in its debug layers; everything else draws through the view", () => {
    const bad: string[] = [];
    for (const file of gameFiles.filter((f) => !isTest(f))) {
      if (/^[a-z0-9-]+\/debug\//.test(rel(file, GAMES))) continue;
      for (const imp of importsOf(file)) {
        if (imp.spec === "pixi.js") bad.push(`${rel(file, REPO)}:${imp.line} imports pixi.js`);
      }
    }
    violations(bad);
  });

  it("keeps the shared test helpers' alias inside the engine's tests", () => {
    const tsconfig = readFileSync(join(REPO, "tsconfig.json"), "utf8");
    const target = new RegExp(`"${TEST_SUPPORT}": \\["([^"]+)"\\]`).exec(tsconfig)?.[1];
    expect(target).toBeDefined();
    expect(isTest(resolve(REPO, target ?? ""))).toBe(true);
  });

  it("lets games reach the engine only through its entries, and nothing else of the site", () => {
    const entries = entrySpecs();
    const bad: string[] = [];
    for (const file of gameFiles) {
      const test = isTest(file);
      for (const imp of importsOf(file)) {
        const where = `${rel(file, REPO)}:${imp.line}`;
        const spec = imp.spec;
        if (spec.startsWith("@/")) bad.push(`${where} imports ${spec}`);
        else if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          if (!inside(target, GAMES)) bad.push(`${where} leaves src/games: ${spec}`);
        } else if (spec === TEST_SUPPORT) {
          if (!test) bad.push(`${where} imports ${spec} outside a test`);
        } else if (spec.startsWith("@jams/engine")) {
          if (!entries.has(spec)) bad.push(`${where} imports unknown entry ${spec}`);
        } else if (
          !(
            PEERS.includes(spec) ||
            (test && (TEST_ONLY.includes(spec) || spec.startsWith("node:")))
          )
        ) {
          bad.push(`${where} imports ${spec}`);
        }
      }
    }
    violations(bad);
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
  )) as {
    COMMANDS: Record<string, { values: readonly string[]; switches: readonly string[] }>;
  };
  const mcp = (await import(
    /* @vite-ignore */ pathToFileURL(join(SCRIPTS, "mcp-tools.ts")).href
  )) as { MCP_TOOL_NAMES: readonly string[] };
  const engine = createRegistry();
  const kindEnv = { registry: engine, project: null };
  return {
    version: ENGINE_VERSION,
    entries,
    issueCodes: Object.keys(ISSUE_CODES).sort(),
    opNames: [...OP_NAMES].sort(),
    projectOpNames: [...PROJECT_OP_NAMES].sort(),
    schemaIds: [
      sceneJsonSchema(engine).$id as string,
      opsJsonSchema(engine).$id as string,
      inputScriptJsonSchema(engine).$id as string,
      checksJsonSchema(engine).$id as string,
      recordingJsonSchema().$id as string,
      fragmentJsonSchema(engine).$id as string,
      prefabJsonSchema(engine).$id as string,
      projectJsonSchema().$id as string,
      sidecarJsonSchema().$id as string,
      projectOpsJsonSchema().$id as string,
      projectSnapshotJsonSchema().$id as string,
      docKindJsonSchema(materialKind, kindEnv).$id as string,
      docKindJsonSchema(gameSettingsKind, kindEnv).$id as string,
      docKindJsonSchema(dataTableKind, kindEnv).$id as string,
    ],
    cliCommands: Object.fromEntries(
      Object.entries(cli.COMMANDS)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, c]) => [name, [...c.values, ...c.switches, "json"].sort()]),
    ),
    checkKinds: [...engine.checkKinds],
    mcpTools: [...mcp.MCP_TOOL_NAMES],
  };
}

describe("public-api.json", () => {
  it("matches the regenerated surface", async () => {
    const current = await surface();
    const read = () => (existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, "utf8")) : null);
    if (process.env.UPDATE_PUBLIC_API && JSON.stringify(read()) !== JSON.stringify(current)) {
      writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`);
      execFileSync("vp", ["fmt", SNAPSHOT], { stdio: "ignore" });
    }
    const committed = read();
    expect(
      current,
      "run UPDATE_PUBLIC_API=1 vp test run src/engine/__tests__/package-boundary.test.ts",
    ).toEqual(committed);
  }, 30_000);
});

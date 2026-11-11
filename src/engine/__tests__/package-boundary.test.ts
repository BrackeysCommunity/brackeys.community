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
  "./editor-ui": "editor-ui/index.ts",
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
/** The editor UI's own libraries: only `editor-ui/` imports them, so every other entry stays React-free. */
const EDITOR_UI_LIBS = [
  "react",
  "react-dom",
  "@base-ui/react",
  "@dnd-kit/core",
  "@hugeicons/core-free-icons",
  "@hugeicons/react",
];
/** The editor UI's tests render with these. */
const EDITOR_UI_TEST_ONLY = ["@testing-library/react"];
/** The site's store bindings, toasts and styling, which the editor UI replaces with its own. */
const EDITOR_UI_NEVER = [
  "@tanstack/react-store",
  "sonner",
  "tailwindcss",
  "@tailwindcss",
  "tailwind-merge",
  "tailwind-variants",
];
/** Injected by the host as a module: the editor UI names its type and never loads it. */
const HOST_MODULE_TYPES = ["@hocuspocus/provider"];
/** The editor UI's transport, which builds the socket from the module its host passes in. */
const HOCUSPOCUS_TRANSPORT = "editor-ui/connect/hocuspocus.ts";
/** Specifiers of exported files that aren't entries. */
const FILE_EXPORTS = ["@jams/engine/editor-ui/style.css"];
/**
 * What the canvas-sync service image copies of the engine. None of it may
 * import the editor UI, which the image doesn't have.
 */
const SERVICE_COPIED = ["scene/", "collab/", "game/", "project/", "version.ts"];
const isServiceCopied = (path: string) =>
  SERVICE_COPIED.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
/** The canvas-sync service's own sources, which reach the engine by relative path. */
const SERVICE_SRC = join(REPO, "services/canvas-sync/src");
/** Engine directories that hold pure toolkits: no Pixi, and Rapier only through `ctx.rapier`. */
const TOOLKIT_DIRS = ["grid/", "nav/", "motion/"];
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
const PIXI_VALUE_SHELL = ["engine.ts", "renderer.ts"];

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
  return importsIn(readFileSync(file, "utf8"));
}

function importsIn(source: string): Import[] {
  const src = stripComments(source);
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
  new Set([
    ...Object.keys(ENTRIES).map((e) => (e === "." ? "@jams/engine" : `@jams/engine/${e.slice(2)}`)),
    ...FILE_EXPORTS,
  ]);
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
        if (target && /\.tsx?$/.test(target)) queue.push(target);
      } else {
        bare.set(imp.spec, [...(bare.get(imp.spec) ?? []), rel(file)]);
      }
    }
  }
  return { files, bare };
}

const violations = (list: string[]) => expect(list, list.join("\n")).toEqual([]);

/** `spec` is the package `pkg` or one of its subpaths. */
const isPackage = (spec: string, pkg: string) => spec === pkg || spec.startsWith(`${pkg}/`);
const isAny = (spec: string, pkgs: readonly string[]) => pkgs.some((p) => isPackage(spec, p));

/**
 * Why a bare import in the engine file at `path` (engine-relative) breaks the
 * boundary, or null when it may: peers anywhere, node builtins in vite/ and
 * tests, test tooling in tests, and the editor UI's libraries in editor-ui/ only.
 */
function bareImportViolation(
  path: string,
  imp: Pick<Import, "spec" | "typeOnly">,
  test: boolean,
): string | null {
  const { spec } = imp;
  if (spec.startsWith(".") || spec.startsWith("@/")) return null;
  const editorUi = path.startsWith("editor-ui/");
  if (editorUi && isAny(spec, EDITOR_UI_NEVER)) return `the editor UI never imports ${spec}`;
  if (spec.startsWith("node:")) {
    return path.startsWith("vite/") || test ? null : `imports the node builtin ${spec}`;
  }
  if (test && TEST_ONLY.includes(spec)) return null;
  if (test && EDITOR_UI_TEST_ONLY.includes(spec)) return null;
  if (VITE_ONLY.includes(spec) && (path.startsWith("vite/") || test)) return null;
  if (editorUi && imp.typeOnly && HOST_MODULE_TYPES.includes(spec)) return null;
  if (PEERS.includes(spec)) return null;
  if (isAny(spec, EDITOR_UI_LIBS)) {
    return editorUi ? null : `imports ${spec}, which only editor-ui/ may`;
  }
  return `imports ${spec}`;
}

/** A relative import from `path` (engine-relative) that lands in editor-ui/. */
function reachesEditorUi(path: string, spec: string): boolean {
  if (!spec.startsWith(".")) return false;
  const target = posix(relative(ENGINE, resolve(ENGINE, dirname(path), spec)));
  return target === "editor-ui" || target.startsWith("editor-ui/");
}

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

  it("imports only peers, node builtins in vite/, test tooling in tests, and UI libraries in editor-ui/", () => {
    const bad: string[] = [];
    for (const file of engineFiles) {
      const path = rel(file);
      for (const imp of importsOf(file)) {
        const why = bareImportViolation(path, imp, isTest(file));
        if (why) bad.push(`${path}:${imp.line} ${why}`);
      }
    }
    violations(bad);
  });

  it("refuses a fixture's React import outside editor-ui/ and the site's libraries inside it", () => {
    const check = (path: string, source: string, test = false) =>
      importsIn(source).map((imp) => bareImportViolation(path, imp, test));
    expect(check("editor/fixture.ts", 'import { useState } from "react";')).toEqual([
      "imports react, which only editor-ui/ may",
    ]);
    expect(check("scene/fixture.ts", 'import { HugeiconsIcon } from "@hugeicons/react";')).toEqual([
      "imports @hugeicons/react, which only editor-ui/ may",
    ]);
    expect(check("index.ts", 'export { createRoot } from "react-dom/client";')).toEqual([
      "imports react-dom/client, which only editor-ui/ may",
    ]);
    expect(
      check(
        "editor-ui/kit/fixture.tsx",
        [
          'import { useState } from "react";',
          'import { createRoot } from "react-dom/client";',
          'import { Tabs } from "@base-ui/react/tabs";',
          'import { DndContext } from "@dnd-kit/core";',
          'import { Add01Icon } from "@hugeicons/core-free-icons";',
          'import type { HocuspocusProvider } from "@hocuspocus/provider";',
          'import { Store } from "@tanstack/store";',
        ].join("\n"),
      ),
    ).toEqual([null, null, null, null, null, null, null]);
    expect(
      check(
        "editor-ui/fixture.tsx",
        [
          'import { useStore } from "@tanstack/react-store";',
          'import { toast } from "sonner";',
          'import { twMerge } from "tailwind-merge";',
          'import { readFileSync } from "node:fs";',
          'import { HocuspocusProvider } from "@hocuspocus/provider";',
          'import "tailwindcss";',
        ].join("\n"),
      ),
    ).toEqual([
      "the editor UI never imports @tanstack/react-store",
      "the editor UI never imports sonner",
      "the editor UI never imports tailwind-merge",
      "imports the node builtin node:fs",
      "imports @hocuspocus/provider",
      "the editor UI never imports tailwindcss",
    ]);
    expect(
      check(
        "editor-ui/__tests__/fixture.test.tsx",
        'import { render } from "@testing-library/react";\nimport { join } from "node:path";',
        true,
      ),
    ).toEqual([null, null]);
    expect(reachesEditorUi("collab/fixture.ts", "../editor-ui/host")).toBe(true);
    expect(reachesEditorUi("editor-ui/kit/button.tsx", "../host")).toBe(true);
    expect(reachesEditorUi("collab/fixture.ts", "../editor/index")).toBe(false);
  });

  it("keeps every entry but ./editor-ui free of React and the editor UI's libraries", () => {
    const bad: string[] = [];
    for (const [entry, file] of Object.entries(ENTRIES)) {
      if (entry === "./editor-ui") continue;
      const { files, bare } = runtimeGraph(file);
      for (const [spec, from] of bare) {
        if (isAny(spec, EDITOR_UI_LIBS))
          bad.push(`${entry} reaches ${spec} via ${from.join(", ")}`);
      }
      for (const f of files) if (f.startsWith("editor-ui/")) bad.push(`${entry} reaches ${f}`);
    }
    violations(bad);
  });

  it("never imports the editor UI from what the canvas-sync image copies", () => {
    const bad: string[] = [];
    for (const file of engineFiles) {
      const path = rel(file);
      if (!isServiceCopied(path)) continue;
      for (const imp of importsOf(file)) {
        if (reachesEditorUi(path, imp.spec)) bad.push(`${path}:${imp.line} imports ${imp.spec}`);
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

  it("imports pixi.js as a value under render/ only from the view, its shapes and the asset loader", () => {
    const known = [
      "render/draw-shape.ts",
      "render/pixi-view.ts",
      "render/asset-loader.ts",
      "render/sprite-textures.ts",
    ];
    const bad = sourceFiles
      .map((f) => rel(f))
      .filter((path) => path.startsWith("render/") && !known.includes(path))
      .filter((path) =>
        importsOf(join(ENGINE, path)).some((imp) => imp.spec === "pixi.js" && !imp.typeOnly),
      );
    violations(bad);
  });

  it("keeps runtime/ and project/ free of pixi.js at runtime", () => {
    const bad: string[] = [];
    for (const file of sourceFiles) {
      const path = rel(file);
      if (!/^(runtime|project)\//.test(path)) continue;
      const { bare } = runtimeGraph(path);
      if (bare.has("pixi.js"))
        bad.push(`${path} reaches pixi.js via ${bare.get("pixi.js")!.join(", ")}`);
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
        .filter((imp) => bareImportViolation(rel(f), imp, false) !== null)
        .map((imp) => `${rel(f)}:${imp.line} imports ${imp.spec}`),
    );
    violations(providers);
  });

  it("leaves the shared provider socket to hosts", () => {
    violations(
      sourceFiles
        .filter((f) => rel(f) !== HOCUSPOCUS_TRANSPORT)
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

  it("keeps grid/, nav/ and motion/ off pixi.js and Rapier values", () => {
    const toolkit = sourceFiles
      .map((f) => rel(f))
      .filter((path) => TOOLKIT_DIRS.some((d) => path.startsWith(d)));
    for (const dir of TOOLKIT_DIRS)
      expect(
        toolkit.some((p) => p.startsWith(dir)),
        dir,
      ).toBe(true);
    const bad: string[] = [];
    for (const path of toolkit) {
      const { bare } = runtimeGraph(path);
      for (const [spec, from] of bare) {
        if (spec === "pixi.js" || spec.startsWith("@dimforge/"))
          bad.push(`${path} reaches ${spec} via ${from.join(", ")}`);
      }
    }
    violations(bad);
  });

  it("lets the canvas-sync service reach only the engine files its image copies", () => {
    const via = new Map<string, string>();
    const queue = walk(SERVICE_SRC, /\.ts$/);
    expect(queue.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    const bad: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const imp of importsOf(file)) {
        if (imp.typeOnly || !imp.spec.startsWith(".")) continue;
        const target = resolveRelative(file, imp.spec);
        if (!target || !/\.tsx?$/.test(target)) continue;
        if (!via.has(target)) via.set(target, `${rel(file, REPO)}:${imp.line}`);
        if (inside(target, ENGINE)) {
          const path = rel(target);
          if (path === "game/index.ts")
            bad.push(`${via.get(target)} imports the ./game barrel; import single files`);
          else if (!isServiceCopied(path)) bad.push(`${via.get(target)} reaches ${path}`);
        }
        queue.push(target);
      }
    }
    violations(bad);
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

  it("never draws from ctx.random in engine systems, primitives or behaviors", () => {
    const reads = [/\bctx\s*\??\.\s*random\b/, /\{[^}]*\brandom\b[^}]*\}\s*=\s*ctx\b/];
    const files = sourceFiles.filter((f) => /^(systems|runtime\/behaviors)\//.test(rel(f)));
    expect(files.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const file of files) {
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (reads.some((re) => re.test(line))) bad.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        });
    }
    violations(bad);
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

// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { SAVE_SCHEMA_ID } from "../game/save-file";
import { docKindJsonSchema } from "../project/kinds";
import { dataTableKind } from "../project/kinds/data-table";
import { gameSettingsKind } from "../project/kinds/game-settings";
import { inputMapKind } from "../project/kinds/input-map";
import { materialKind } from "../project/kinds/material";
import { sceneListKind } from "../project/kinds/scene-list";
import { PROJECT_OP_NAMES, projectOpsJsonSchema } from "../project/ops";
import { projectJsonSchema } from "../project/project-file";
import { RELEASE_SCHEMA_ID } from "../project/release";
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
 * The package boundary of `@jams/engine` (packages/engine), and the snapshot of its
 * public and agent surface in `public-api.json`. When an export, issue code or
 * CLI command changes on purpose, regenerate the snapshot with
 * `UPDATE_PUBLIC_API=1 vp test run packages/engine/__tests__/package-boundary.test.ts`
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
  "./export": "export/index.ts",
  "./standalone": "standalone/index.ts",
} as const;

const PEERS = [
  "pixi.js",
  // Pixi's eval-free renderer paths, which the standalone host installs.
  "pixi.js/unsafe-eval",
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
/**
 * What the copied files may name in a type-only import beside each other:
 * the image strips types, so these never have to exist there.
 */
const SERVICE_TYPE_ONLY = [
  "runtime/",
  "saves/",
  "input/",
  "sim-kit/",
  "ui/",
  "types.ts",
  "engine.ts",
  "headless/",
  "export/",
  "standalone/",
];
const isServiceTypeTarget = (path: string) =>
  isServiceCopied(path) ||
  SERVICE_TYPE_ONLY.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
/** The save file, flow's rule and the scene-list and save kinds: what a server reads a save or a scene list with. */
const SAVE_AND_FLOW_FILES = [
  "game/save-file.ts",
  "game/flow.ts",
  "project/kinds/scene-list.ts",
  "project/kinds/save.ts",
];
/** The canvas-sync service's own sources, which reach the engine by relative path. */
const SERVICE_SRC = join(REPO, "services/canvas-sync/src");
/** What a released game's page never loads: the editor, its UI, the dev server, debug tooling, and the export planner (its types only). */
const STANDALONE_NEVER = ["editor/", "editor-ui/", "vite/", "debug/", "export/"];
/** Engine directories that hold pure toolkits: no Pixi, and Rapier only through `ctx.rapier`. */
const TOOLKIT_DIRS = ["grid/", "nav/", "motion/"];
/** The engine's shared test helpers, a tsconfig alias only games' tests may import. */
const TEST_SUPPORT = "@jams/engine-testing";
/**
 * Site files a service image copies (the Dockerfile's COPY list) or a script
 * runs under plain type stripping, which reach engine entries by relative path
 * to an entry's `index.ts`, since neither has tsconfig paths.
 */
const SERVICE_SHARED = [
  "src/lib/scene/",
  "src/arcade/sim-kit/",
  "src/lib/engine/limits.ts",
  "src/lib/engine/quota.ts",
  "src/lib/engine/storage-keys.ts",
  "src/lib/engine/collect-plan.ts",
  "src/lib/engine/release-audit.ts",
  "src/lib/format-bytes.ts",
];

/** Rapier is injected by the host, so no engine file imports it as a value. */
const RAPIER_VALUE_ALLOWLIST: string[] = [];

/** Where the engine may import pixi.js as a value: the renderer behind the view seam, the debug overlay, and the browser shell. */
const PIXI_VALUE_DIRS = ["render/", "debug/"];
const PIXI_VALUE_SHELL = ["engine.ts", "renderer.ts"];

/** Words that name the first game's features; none may reach the built package. Seats are the engine's own players. */
const GAME_WORDS = /\b(shaper|grapple|wind|constructs?|cheese|cloud|mover)\b/i;

/** Globals only a browser has, which the pure input modules never touch. */
const DOM_GLOBALS =
  /\b(window|document|navigator|localStorage|sessionStorage|matchMedia|requestAnimationFrame|HTMLElement|KeyboardEvent|PointerEvent|Gamepad)\b/;

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

/** `src` with its quoted string literals emptied, so a message naming a DOM type isn't a use of it. */
const stripStrings = (src: string) => src.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');

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
/**
 * What the site may load of a game: its entries (`index.ts`, the DOM UI's
 * `ui/index.ts`, the dev-only `debug/index.ts`) and its project JSON (the
 * project file, scenes, prefabs, game settings, input map, scene list and
 * data tables). Nothing else of a game is the site's.
 */
const isSiteGameTarget = (target: string) => {
  const path = posix(relative(GAMES, target));
  return (
    /^[a-z0-9-]+(\/(ui|debug))?(\/index(\.ts)?)?$/.test(path) ||
    /^[a-z0-9-]+\/(jams\.project|game-settings|input-map|scene-list|scenes\/[a-z0-9-]+|scenes\/prefabs\/[a-z0-9-]+|data\/[a-z0-9-]+)\.json$/.test(
      path,
    )
  );
};

/**
 * `import.meta.glob` patterns in `source`: each string of its first argument,
 * with its line. Read from the raw text, since a pattern's `/*` would read as
 * a comment's start; a commented-out call is judged too.
 */
function globsIn(src: string): { pattern: string; line: number; call: string[] }[] {
  const out: { pattern: string; line: number; call: string[] }[] = [];
  for (const m of src.matchAll(/\bimport\.meta\.glob\b/g)) {
    let i = m.index + m[0].length;
    if (src[i] === "<") {
      for (let depth = 0; i < src.length; i++) {
        if (src[i] === "<") depth++;
        else if (src[i] === ">" && src[i - 1] !== "=" && --depth === 0) break;
      }
      i++;
    }
    const call = /^\s*\(\s*(\[[^\]]*\]|"[^"]*"|'[^']*'|`[^`]*`)/.exec(src.slice(i));
    const line = src.slice(0, m.index).split("\n").length;
    if (!call) {
      out.push({ pattern: "", line, call: [""] });
      continue;
    }
    const patterns = [...call[1]!.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map(
      (lit) => lit[1] ?? lit[2] ?? lit[3]!,
    );
    for (const pattern of patterns) out.push({ pattern, line, call: patterns });
  }
  return out;
}

/** `{a,b}` alternatives spelled out, so each pattern names one shape. */
const expandBraces = (pattern: string): string[] => {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  return m[1]!
    .split(",")
    .flatMap((alt) =>
      expandBraces(pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length)),
    );
};

/**
 * A hosted game's art and the sidecars that describe it, the one deep glob
 * the site may make into src/games, and only from a call that leaves out
 * every game's tests.
 */
const SITE_ART_GLOB = /^\/src\/games\/\*\/\*\*\/\*\.(asset\.json|png|jpe?g|webp|gif)$/;
const NO_GAME_TESTS = "!/src/games/*/**/__tests__/**";

/**
 * Why a site file's `import.meta.glob` pattern breaks the boundary, or null:
 * a pattern into src/games must match only what `isSiteGameTarget` allows
 * (a wildcard stands for one name) or be `SITE_ART_GLOB` beside
 * `NO_GAME_TESTS` in its call, and none may reach packages/engine.
 */
function siteGlobViolation(file: string, pattern: string, call = [pattern]): string | null {
  if (pattern === "") return "calls import.meta.glob without a literal pattern";
  if (pattern.startsWith("!")) return null;
  for (const one of expandBraces(pattern)) {
    if (SITE_ART_GLOB.test(one) && call.includes(NO_GAME_TESTS)) continue;
    const target = one.startsWith("@/")
      ? join(SITE, one.slice(2))
      : one.startsWith("/")
        ? join(REPO, one)
        : resolve(dirname(file), one);
    if (inside(target, ENGINE)) return `globs into packages/engine: ${pattern}`;
    if (!inside(target, GAMES)) continue;
    const path = posix(relative(GAMES, target));
    if (/\*\*|[?[\]()!+@]/.test(path) || !isSiteGameTarget(target.replace(/\*/g, "x")))
      return `globs more of a game than its entries and project JSON: ${pattern}`;
  }
  return null;
}

/** Site directories whose `import.meta.glob` patterns the site rule reads. */
const SITE_GLOB_DIRS = [join(SITE, "components"), join(SITE, "routes")];

/** The engine directory a DOM UI lives in: off Pixi values, the games and the editor UI. */
const UI_DIR = "ui/";

/** Why `imp`, in the engine file at `path`, breaks ui/'s boundary, or null. */
function uiImportViolation(path: string, imp: Pick<Import, "spec" | "typeOnly">): string | null {
  if (imp.spec === "pixi.js" && !imp.typeOnly) return "imports pixi.js as a value";
  if (imp.spec.startsWith("@/")) return `imports ${imp.spec}`;
  if (!imp.spec.startsWith(".")) return null;
  const target = resolve(ENGINE, dirname(path), imp.spec);
  if (inside(target, GAMES) || !inside(target, ENGINE)) return `imports ${imp.spec}`;
  if (reachesEditorUi(path, imp.spec)) return `imports the editor UI: ${imp.spec}`;
  return null;
}

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
  it("has no @/ imports and no relative imports that leave packages/engine", () => {
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

  it("keeps the input code tables and the units maths import-free", () => {
    expect(importsOf(join(ENGINE, "game/input-codes.ts"))).toEqual([]);
    expect(importsOf(join(ENGINE, "scene/units.ts"))).toEqual([]);
  });

  it("keeps the binding check, the input-map kind and the unit walker inside what canvas-sync copies", () => {
    const outside = (file: string, allowed: (target: string, spec: string) => boolean) =>
      importsOf(join(ENGINE, file))
        .filter((imp) => {
          if (!imp.spec.startsWith(".")) return !allowed("", imp.spec);
          const target = rel(resolveRelative(join(ENGINE, file), imp.spec) ?? imp.spec);
          if (imp.typeOnly && isServiceCopied(target)) return false;
          return !allowed(target, imp.spec);
        })
        .map((imp) => `${file}:${imp.line} imports ${imp.spec}`);
    violations([
      ...outside(
        "game/input-bindings.ts",
        (t) => t.startsWith("game/") || t === "scene/did-you-mean.ts",
      ),
      ...outside(
        "project/kinds/input-map.ts",
        (t, spec) => spec === "zod" || t.startsWith("game/") || t.startsWith("project/"),
      ),
      ...outside(
        "game/units.ts",
        (t, spec) =>
          spec === "zod" ||
          t.startsWith("game/") ||
          t === "scene/units.ts" ||
          t === "scene/shapes.ts",
      ),
    ]);
  });

  it("keeps the save file, flow's rule and the scene-list and save kinds on zod, game/ and project/", () => {
    const bad: string[] = [];
    for (const path of SAVE_AND_FLOW_FILES) {
      for (const imp of importsOf(join(ENGINE, path))) {
        const where = `${path}:${imp.line} imports ${imp.spec}`;
        if (!imp.spec.startsWith(".")) {
          if (imp.spec !== "zod") bad.push(where);
          continue;
        }
        const target = rel(resolveRelative(join(ENGINE, path), imp.spec) ?? imp.spec);
        if (imp.typeOnly) {
          if (!isServiceTypeTarget(target)) bad.push(where);
        } else if (
          !target.startsWith("game/") &&
          !target.startsWith("project/") &&
          target !== "scene/issues.ts" &&
          target !== "scene/parse.ts"
        ) {
          bad.push(where);
        }
      }
      const { files, bare } = runtimeGraph(path);
      for (const spec of bare.keys()) if (spec !== "zod") bad.push(`${path} reaches ${spec}`);
      for (const f of files)
        if (!/^(game|project|scene)\//.test(f) && f !== "version.ts")
          bad.push(`${path} reaches ${f}`);
    }
    violations(bad);
  });

  it("lets what the canvas-sync image copies reach the rest of the engine only through type imports, and never @/", () => {
    const bad: string[] = [];
    for (const file of sourceFiles) {
      const path = rel(file);
      if (!isServiceCopied(path) || path === "game/index.ts") continue;
      for (const imp of importsOf(file)) {
        const where = `${path}:${imp.line} imports ${imp.spec}`;
        if (imp.spec.startsWith("@/")) bad.push(where);
        if (!imp.spec.startsWith(".") || imp.typeOnly) continue;
        const target = rel(resolveRelative(file, imp.spec) ?? resolve(dirname(file), imp.spec));
        if (!isServiceCopied(target)) bad.push(where);
      }
    }
    violations(bad);
  });

  it("keeps saves/ off Pixi values", () => {
    const saveFiles = sourceFiles.map((f) => rel(f)).filter((p) => p.startsWith("saves/"));
    expect(saveFiles).toContain("saves/index.ts");
    const bad: string[] = [];
    for (const path of saveFiles) {
      const { bare } = runtimeGraph(path);
      if (bare.has("pixi.js"))
        bad.push(`${path} reaches pixi.js via ${bare.get("pixi.js")!.join(", ")}`);
    }
    violations(bad);
  });

  it("keeps ui/ off Pixi values, src/games and the editor UI", () => {
    const uiFiles = sourceFiles.map((f) => rel(f)).filter((p) => p.startsWith(UI_DIR));
    expect(uiFiles).toContain("ui/index.ts");
    const bad: string[] = [];
    for (const path of uiFiles) {
      for (const imp of importsOf(join(ENGINE, path))) {
        const why = uiImportViolation(path, imp);
        if (why) bad.push(`${path}:${imp.line} ${why}`);
      }
      const { files, bare } = runtimeGraph(path);
      if (bare.has("pixi.js"))
        bad.push(`${path} reaches pixi.js via ${bare.get("pixi.js")!.join(", ")}`);
      for (const f of files) {
        if (f.startsWith("editor-ui/") || f.startsWith("../")) bad.push(`${path} reaches ${f}`);
      }
    }
    violations(bad);
  });

  it("refuses a fixture's Pixi value, game or editor UI import in ui/", () => {
    const check = (source: string) =>
      importsIn(source).map((imp) => uiImportViolation("ui/fixture.ts", imp));
    expect(
      check(
        [
          'import type { Container } from "pixi.js";',
          'import type { GameInstance } from "../types";',
          'import { Container as C } from "pixi.js";',
          'import { tacticsGame } from "../../games/tactics";',
          'import { EditorFrame } from "../editor-ui/frame/EditorFrame";',
          'import { cn } from "@/lib/utils";',
        ].join("\n"),
      ),
    ).toEqual([
      null,
      null,
      "imports pixi.js as a value",
      "imports ../../games/tactics",
      "imports the editor UI: ../editor-ui/frame/EditorFrame",
      "imports @/lib/utils",
    ]);
  });

  it("keeps input/ off Pixi and Rapier values, and its state, stream and quantising pure", () => {
    const inputFiles = sourceFiles.map((f) => rel(f)).filter((p) => p.startsWith("input/"));
    expect(inputFiles).toContain("input/system.ts");
    const bad: string[] = [];
    for (const path of inputFiles) {
      for (const [spec, from] of runtimeGraph(path).bare) {
        if (spec === "pixi.js" || spec.startsWith("@dimforge/"))
          bad.push(`${path} reaches ${spec} via ${from.join(", ")}`);
      }
    }
    for (const path of ["input/state.ts", "input/stream.ts", "input/quantize.ts"]) {
      const { files, bare } = runtimeGraph(path);
      if (bare.size > 0) bad.push(`${path} reaches ${[...bare.keys()].join(", ")}`);
      for (const file of files) {
        const code = stripStrings(stripComments(readFileSync(join(ENGINE, file), "utf8")));
        const dom = DOM_GLOBALS.exec(code);
        if (dom) bad.push(`${path} reaches ${dom[1]} in ${file}`);
      }
    }
    violations(bad);
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

  it("keeps ./export on zod and the project, scene and game files: no Pixi, no node:, no React", () => {
    const { files, bare } = runtimeGraph(ENTRIES["./export"]);
    expect([...bare.keys()].filter((s) => s !== "zod")).toEqual([]);
    violations(
      [...files].filter((f) => !/^(export|project|scene|game)\//.test(f) && f !== "version.ts"),
    );
  });

  it("keeps ./export's reach outside export/ inside what ./project already reaches", () => {
    const project = runtimeGraph(ENTRIES["./project"]).files;
    violations(
      [...runtimeGraph(ENTRIES["./export"]).files].filter(
        (f) => !f.startsWith("export/") && !project.has(f),
      ),
    );
  });

  it("keeps ./standalone on the shell, ./game and ./project, with ./export's types only", () => {
    const { files, bare } = runtimeGraph(ENTRIES["./standalone"]);
    const bad = [
      ...[...bare.keys()]
        .filter((s) => s.startsWith("node:") || isAny(s, [...EDITOR_UI_LIBS, ...VITE_ONLY]))
        .map((s) => `reaches ${s} via ${bare.get(s)?.join(", ")}`),
      ...[...files]
        .filter((f) => STANDALONE_NEVER.some((d) => f.startsWith(d)))
        .map((f) => `reaches ${f}`),
    ];
    violations(bad);
  });

  it("packs every entry: the neutral and node pack configs name each one", () => {
    const viteConfig = readFileSync(join(ENGINE, "vite.config.ts"), "utf8");
    const packInclude = (
      JSON.parse(readFileSync(join(ENGINE, "tsconfig.pack.json"), "utf8")) as { include: string[] }
    ).include;
    expect(Object.keys(ENTRIES)).toHaveLength(13);
    for (const [entry, file] of Object.entries(ENTRIES)) {
      const name = entry === "." ? "index" : entry.slice(2);
      const key = /^[a-z]+$/.test(name) ? name : `"${name}"`;
      expect(viteConfig, entry).toContain(`${key}: "./${file}"`);
      if (entry !== "./vite") expect(packInclude, entry).toContain(file);
    }
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
          if (!isSiteGameTarget(target)) bad.push(`${where} deep-imports a game: ${spec}`);
        } else if (spec.startsWith("@jams/engine")) {
          if (!entries.has(spec)) bad.push(`${where} imports unknown entry ${spec}`);
        } else if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          const shared = SERVICE_SHARED.some((d) => rel(file, REPO).startsWith(d));
          const entryIndex = Object.values(ENTRIES).some((e) => target === join(ENGINE, e));
          if (inside(target, ENGINE) && !(shared && entryIndex))
            bad.push(`${where} reaches into packages/engine: ${spec}`);
          if (inside(target, GAMES)) bad.push(`${where} reaches into src/games by path: ${spec}`);
          if (!isTest(file) && inside(target, join(REPO, "scripts")))
            bad.push(`${where} reaches into dev tooling in scripts/: ${spec}`);
        }
      }
    }
    violations(bad);
  });

  it("globs only game entries and project JSON from the site's components and routes", () => {
    const bad: string[] = [];
    for (const file of SITE_GLOB_DIRS.flatMap((d) => walk(d, /\.tsx?$/))) {
      if (isTest(file)) continue;
      for (const { pattern, line, call } of globsIn(readFileSync(file, "utf8"))) {
        const why = siteGlobViolation(file, pattern, call);
        if (why) bad.push(`${rel(file, REPO)}:${line} ${why}`);
      }
    }
    violations(bad);
  });

  it("judges a fixture's glob patterns by the site's game-entry rule", () => {
    const file = join(SITE, "components/game/fixture.ts");
    const judged = (source: string) =>
      globsIn(source).map(({ pattern, call }) => siteGlobViolation(file, pattern, call));
    expect(
      judged(
        [
          'import.meta.glob("/src/games/*/jams.project.json", { eager: true });',
          'import.meta.glob("/src/games/*/scene-list.json", { eager: true });',
          'import.meta.glob<() => Promise<unknown>>(["/src/games/*/index.ts", "/src/games/*/ui/index.ts"]);',
          "import.meta.glob('@/games/platformer/scenes/prefabs/*.json');",
          'import.meta.glob("/src/games/*/scenes/{*.json,prefabs/*.json}");',
          'import.meta.glob("/src/games/*/debug/index.ts");',
          'import.meta.glob(["/src/games/*/{game-settings,input-map}.json", "/src/games/*/data/*.json", "!/src/games/*/data/*.asset.json"]);',
          'import.meta.glob(["/src/games/*/**/*.asset.json", "!/src/games/*/**/__tests__/**"]);',
          'import.meta.glob(["/src/games/*/**/*.{png,jpg,jpeg,webp,gif}", "!/src/games/*/**/__tests__/**"]);',
          'import.meta.glob("/src/games/*/**/*.png");',
          'import.meta.glob(["/src/games/*/**/*.{png,ts}", "!/src/games/*/**/__tests__/**"]);',
          'import.meta.glob("/src/games/*/data/**/*.json");',
          'import.meta.glob("/src/games/**/*.ts");',
          'import.meta.glob("/src/games/*/runtime.ts");',
          'import.meta.glob("../../games/*/ui/*.ts");',
          'import.meta.glob("/packages/engine/scenes/*.json");',
          "import.meta.glob(patterns);",
        ].join("\n"),
      ),
    ).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "globs more of a game than its entries and project JSON: /src/games/*/**/*.png",
      "globs more of a game than its entries and project JSON: /src/games/*/**/*.{png,ts}",
      null,
      "globs more of a game than its entries and project JSON: /src/games/*/data/**/*.json",
      "globs more of a game than its entries and project JSON: /src/games/**/*.ts",
      "globs more of a game than its entries and project JSON: /src/games/*/runtime.ts",
      "globs more of a game than its entries and project JSON: ../../games/*/ui/*.ts",
      "globs into packages/engine: /packages/engine/scenes/*.json",
      "calls import.meta.glob without a literal pattern",
    ]);
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
          bad.push(`${where} reaches into packages/engine: ${spec}`);
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
      join(ENGINE, "project/input-map.schema.json"),
      join(ENGINE, "project/scene-list.schema.json"),
      join(ENGINE, "project/save.schema.json"),
      join(ENGINE, "project/data-table.schema.json"),
      join(ENGINE, "project/project-snapshot.schema.json"),
      ...walk(join(ENGINE, "scenes"), /\.json$/),
    ];
    const named = shipped
      .filter((f) => GAME_WORDS.test(readFileSync(f, "utf8")))
      .map((f) => rel(f));
    violations(named);
  });

  it("pins ENGINE_VERSION to packages/engine/package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ENGINE, "package.json"), "utf8")) as {
      version: string;
      exports: Record<string, unknown>;
    };
    expect(ENGINE_VERSION).toBe(pkg.version);
    for (const entry of Object.keys(ENTRIES)) expect(pkg.exports).toHaveProperty([entry]);
  });
});

describe("game boundary", () => {
  it("keeps packages/engine from importing src/games", () => {
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
      docKindJsonSchema(inputMapKind, kindEnv).$id as string,
      docKindJsonSchema(sceneListKind, kindEnv).$id as string,
      SAVE_SCHEMA_ID,
      RELEASE_SCHEMA_ID,
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
      "run UPDATE_PUBLIC_API=1 vp test run packages/engine/__tests__/package-boundary.test.ts",
    ).toEqual(committed);
  }, 30_000);
});

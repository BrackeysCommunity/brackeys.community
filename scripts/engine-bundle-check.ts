/**
 * Checks that production builds hold no dev-only engine module: the debug
 * overlay, the editor and its UI, the dev server, or a game's debug layers.
 * One list (`DEV_ONLY`) covers the site's client build and every game export.
 * Checked by module id from the build's chunk report
 * (`scripts/engine-bundle-report.ts`), since minification renames functions.
 *
 *   vp run engine:bundle-check                  # the site check (one build)
 *   vp run engine:bundle-check --self-test      # also proves both checks fail on a leak
 *   vp run engine:bundle-check --side-effects   # also measures "sideEffects": false
 *   bun scripts/engine-bundle-check.ts --report <dir>
 *     # checks a build that already ran with ENGINE_BUNDLE_REPORT=<dir> (CI's preload-budget job)
 *   bun scripts/engine-bundle-check.ts --export <dir> [--export <dir> …] [--self-test]
 *     # checks `game build` outputs by the report beside each (<dir>.bundle-report);
 *     # the self-test rebuilds the first one's project with an editor-ui import
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ReportedChunk } from "./engine-bundle-report";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE_MODULE = "src/components/game/GameCanvas.tsx";
const ENGINE_PKG = join(REPO, "packages/engine/package.json");
/** The entries no production build may load, by source directory and by packed file name. */
const DEV_ENTRIES = "debug|editor|editor-ui|vite";

/** Module ids no production client chunk or game export may hold. */
export const DEV_ONLY = [
  new RegExp(`/packages/engine/(?:${DEV_ENTRIES})/`),
  /\/src\/games\/[^/]+\/debug\//,
  /\/src\/components\/game\/editor-host\.tsx$/,
  // The packed entries, reached through the workspace link or its real path.
  new RegExp(`/(?:node_modules/@jams/engine|packages/engine)/dist/(?:${DEV_ENTRIES})\\.mjs$`),
];
/** Also kept out of the game route, though canvases load them elsewhere: the scene editor's provider. */
const NOT_IN_ROUTE = [...DEV_ONLY, /\/node_modules\/@hocuspocus\//];
const ENGINE_MODULE = /\/packages\/engine\/|\/node_modules\/@jams\/engine\//;
/** The project the export self-test builds when no `--export` names one. */
const SELF_TEST_PROJECT = { id: "tactics", target: "web" };

type Inject = { into: string; code: string };

type Measure = {
  /** The route chunk and everything it imports statically: what loads with the game. */
  routeFiles: string[];
  routeBytes: number;
  engineModules: string[];
  engineBytes: number;
  /** Dev-only modules in the route's chunks, and in any client chunk. */
  inRoute: string[];
  anywhere: string[];
};

export type ExportMeasure = {
  chunks: number;
  bytes: number;
  engineModules: number;
  /** Dev-only modules in any of the export's chunks. */
  leaks: string[];
};

const shown = (id: string) => (id.startsWith(REPO) ? relative(REPO, id) : id);

/**
 * The source files a packed module was built from, by its sourcemap: a
 * dist chunk shared between entries is dev-only when any of its sources is.
 */
function packedSources(id: string): string[] {
  if (!id.endsWith(".mjs") || !id.includes("/dist/")) return [];
  const map = `${id}.map`;
  if (!existsSync(map)) return [];
  try {
    const { sources = [], sourceRoot = "" } = JSON.parse(readFileSync(map, "utf8")) as {
      sources?: string[];
      sourceRoot?: string;
    };
    return sources.map((s) => resolve(dirname(map), sourceRoot, s));
  } catch {
    return [];
  }
}

/** Each module of `chunks` that matches `rules`, as `<chunk>: <module>` lines. */
export function devOnlyModules(chunks: ReportedChunk[], rules: RegExp[] = DEV_ONLY): string[] {
  return chunks.flatMap((c) =>
    Object.keys(c.modules).flatMap((id) => {
      if (rules.some((re) => re.test(id))) return [`${c.fileName}: ${shown(id)}`];
      const from = packedSources(id).filter((src) => rules.some((re) => re.test(src)));
      return from.length
        ? [`${c.fileName}: ${shown(id)} (from ${from.map(shown).join(", ")})`]
        : [];
    }),
  );
}

function readChunks(file: string): ReportedChunk[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { chunks: ReportedChunk[] }).chunks;
}

function build(inject?: Inject): Measure {
  const dir = mkdtempSync(join(tmpdir(), "engine-bundle-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, ENGINE_BUNDLE_REPORT: dir };
    if (inject) env.ENGINE_BUNDLE_INJECT = JSON.stringify(inject);
    const res = spawnSync("vp", ["build"], { cwd: REPO, env, encoding: "utf8" });
    if (res.status !== 0) throw new Error(`vp build failed\n${res.stdout}\n${res.stderr}`);
    return readReport(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readReport(dir: string): Measure {
  return measure(readChunks(join(dir, "client.json")));
}

function measure(chunks: ReportedChunk[]): Measure {
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const route = chunks.find((c) => Object.keys(c.modules).some((id) => id.endsWith(ROUTE_MODULE)));
  if (!route) throw new Error(`no client chunk holds ${ROUTE_MODULE}`);

  const closure = new Set<string>();
  const queue = [route.fileName];
  while (queue.length) {
    const file = queue.pop()!;
    if (closure.has(file)) continue;
    closure.add(file);
    queue.push(...(byFile.get(file)?.imports ?? []));
  }
  const routeChunks = [...closure].map((f) => byFile.get(f)!).filter(Boolean);

  const engine = routeChunks.flatMap((c) =>
    Object.entries(c.modules).filter(([id]) => ENGINE_MODULE.test(id)),
  );
  return {
    routeFiles: [...closure],
    routeBytes: routeChunks.reduce(
      (n, c) => n + Object.values(c.modules).reduce((a, b) => a + b, 0),
      0,
    ),
    engineModules: engine.map(([id]) => shown(id)),
    engineBytes: engine.reduce((n, [, size]) => n + size, 0),
    inRoute: devOnlyModules(routeChunks, NOT_IN_ROUTE),
    anywhere: devOnlyModules(chunks),
  };
}

/**
 * The client report of the export at `dir`: `game build` writes it beside
 * the output (`<dir>.bundle-report/client.json`); a report directory itself
 * is accepted too.
 */
async function exportReportFile(dir: string): Promise<string> {
  const own = join(dir, "client.json");
  if (existsSync(own)) return own;
  const { bundleReportDir } = await import("./scene/tools/game-build");
  const beside = join(bundleReportDir(dir), "client.json");
  if (existsSync(beside)) return beside;
  throw new Error(`no bundle report for ${shown(resolve(dir))}: looked for ${shown(beside)}`);
}

/** Checks one game export's chunks against `DEV_ONLY`. */
export async function checkExport(dir: string): Promise<ExportMeasure> {
  const chunks = readChunks(await exportReportFile(resolve(dir)));
  return {
    chunks: chunks.length,
    bytes: chunks.reduce((n, c) => n + Object.values(c.modules).reduce((a, b) => a + b, 0), 0),
    engineModules: chunks.reduce(
      (n, c) => n + Object.keys(c.modules).filter((id) => ENGINE_MODULE.test(id)).length,
      0,
    ),
    leaks: devOnlyModules(chunks),
  };
}

type ReleaseRef = {
  project: { id: string };
  build: { target: string; rapier: { package: string } | null };
};

/**
 * Rebuilds a project into a temp directory with an `editor-ui` import added
 * to the export's entry, and returns what the export check finds there.
 */
async function leakedExport(from: string | undefined): Promise<ExportMeasure> {
  const { EXPORT_ENTRY_ID } = await import("@jams/engine/vite");
  let args = [SELF_TEST_PROJECT.id, "--target", SELF_TEST_PROJECT.target];
  if (from) {
    const m = JSON.parse(readFileSync(join(resolve(from), "release.json"), "utf8")) as ReleaseRef;
    args = [m.project.id, "--target", m.build.target];
    if (m.build.rapier)
      args.push("--rapier", m.build.rapier.package.endsWith("-compat") ? "compat" : "standard");
  }
  const tmp = mkdtempSync(join(tmpdir(), "engine-export-leak-"));
  const out = join(tmp, "build");
  try {
    const inject: Inject = {
      into: EXPORT_ENTRY_ID,
      code: 'import { mountSceneEditor as __leak } from "@jams/engine/editor-ui";\nglobalThis.__engineBundleLeak = __leak;',
    };
    // The editor adds enough bytes to break the budget; the report is written either way.
    const res = spawnSync(
      "vp",
      ["run", "scene", "game", "build", ...args, "--out", out, "--allow-over-budget"],
      {
        cwd: REPO,
        env: { ...process.env, ENGINE_BUNDLE_INJECT: JSON.stringify(inject) },
        encoding: "utf8",
      },
    );
    try {
      return await checkExport(out);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${res.stdout}\n${res.stderr}`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

function flagValues(argv: string[], flag: string): string[] {
  return argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]!] : []));
}

async function main(argv: string[]): Promise<number> {
  const failures: string[] = [];
  const exports = flagValues(argv, "--export");
  const reportAt = argv.indexOf("--report");
  const selfTest = argv.includes("--self-test");
  const site = exports.length === 0 || reportAt >= 0;

  if (site) {
    const base = reportAt >= 0 ? readReport(resolve(argv[reportAt + 1] ?? "")) : build();
    console.log(
      `game route: ${base.routeFiles.length} chunks, ${kb(base.routeBytes)} rendered; ` +
        `${base.engineModules.length} engine modules, ${kb(base.engineBytes)}`,
    );
    if (base.inRoute.length)
      failures.push(`dev-only modules in the game route:\n  ${base.inRoute.join("\n  ")}`);
    if (base.anywhere.length)
      failures.push(`dev-only modules in the client build:\n  ${base.anywhere.join("\n  ")}`);

    if (selfTest) {
      const leaked = build({
        into: ROUTE_MODULE,
        code: 'import { createDebugOverlay as __leak } from "@jams/engine/debug";\nglobalThis.__engineBundleLeak = __leak;',
      });
      if (leaked.inRoute.some((m) => /engine\/(?:dist\/)?debug/.test(m))) {
        console.log("self-test: a static debug import in the route is caught");
      } else {
        failures.push("self-test: a static debug import in the route went unnoticed");
      }
    }

    if (argv.includes("--side-effects")) {
      // Builds again with the flag flipped, so the comparison works whichever way the package sets it.
      const original = readFileSync(ENGINE_PKG, "utf8");
      const pkg = JSON.parse(original) as Record<string, unknown>;
      const flipped = pkg.sideEffects === false ? undefined : false;
      let other: Measure;
      try {
        writeFileSync(ENGINE_PKG, `${JSON.stringify({ ...pkg, sideEffects: flipped }, null, 2)}\n`);
        other = build();
      } finally {
        writeFileSync(ENGINE_PKG, original);
      }
      const [on, off] = flipped === false ? [other, base] : [base, other];
      const dropped = off.engineModules.filter((id) => !on.engineModules.includes(id));
      console.log(
        `"sideEffects": false saves ${kb(off.routeBytes - on.routeBytes)} on the game route ` +
          `(${kb(off.engineBytes - on.engineBytes)} of engine code, ${dropped.length} modules: ${dropped.join(", ")})`,
      );
    }
  }

  for (const dir of exports) {
    let m: ExportMeasure;
    try {
      m = await checkExport(dir);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    console.log(
      `export ${shown(resolve(dir))}: ${m.chunks} chunks, ${kb(m.bytes)} rendered; ${m.engineModules} engine modules`,
    );
    if (m.leaks.length)
      failures.push(`dev-only modules in export ${dir}:\n  ${m.leaks.join("\n  ")}`);
  }

  if (selfTest) {
    const leaked = await leakedExport(exports[0]);
    if (leaked.leaks.some((m) => /engine\/(?:dist\/)?editor-ui/.test(m))) {
      console.log("self-test: an editor-ui import in an export is caught");
    } else {
      failures.push("self-test: an editor-ui import in an export went unnoticed");
    }
  }

  if (failures.length) {
    console.error(`\nengine bundle check failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
    return 1;
  }
  console.log("engine bundle check passed");
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

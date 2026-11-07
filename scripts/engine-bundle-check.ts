/**
 * Builds the site and checks that the game route's production chunks hold no
 * dev-only engine module: the debug overlay, the editor, the dev server, or a
 * game's debug layers. Checked by module id from the build's chunk report
 * (`scripts/engine-bundle-report.ts`), since minification renames functions.
 *
 *   vp run engine:bundle-check                  # the check (one build)
 *   vp run engine:bundle-check --self-test      # also proves it fails on a leak
 *   vp run engine:bundle-check --side-effects   # also measures "sideEffects": false
 *   bun scripts/engine-bundle-check.ts --report <dir>
 *     # checks a build that already ran with ENGINE_BUNDLE_REPORT=<dir> (CI's preload-budget job)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ReportedChunk } from "./engine-bundle-report";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE_MODULE = "src/components/game/GameCanvas.tsx";
const ENGINE_PKG = join(REPO, "src/engine/package.json");

/** Module ids no production client chunk may hold. */
const DEV_ONLY = [
  /\/src\/engine\/debug\//,
  /\/src\/engine\/editor\//,
  /\/src\/engine\/vite\//,
  /\/src\/games\/[^/]+\/debug\//,
  /\/src\/components\/game\/editor\//,
];
/** Also kept out of the game route, though canvases load them elsewhere: the scene editor's provider. */
const NOT_IN_ROUTE = [...DEV_ONLY, /\/node_modules\/@hocuspocus\//];

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
  const { chunks } = JSON.parse(readFileSync(join(dir, "client.json"), "utf8")) as {
    chunks: ReportedChunk[];
  };
  return measure(chunks);
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

  const matching = (list: ReportedChunk[], rules: RegExp[]) =>
    list.flatMap((c) =>
      Object.keys(c.modules)
        .filter((id) => rules.some((re) => re.test(id)))
        .map((id) => `${c.fileName}: ${relative(REPO, id)}`),
    );
  const engine = routeChunks.flatMap((c) =>
    Object.entries(c.modules).filter(([id]) => id.includes("/src/engine/")),
  );
  return {
    routeFiles: [...closure],
    routeBytes: routeChunks.reduce(
      (n, c) => n + Object.values(c.modules).reduce((a, b) => a + b, 0),
      0,
    ),
    engineModules: engine.map(([id]) => relative(REPO, id)),
    engineBytes: engine.reduce((n, [, size]) => n + size, 0),
    inRoute: matching(routeChunks, NOT_IN_ROUTE),
    anywhere: matching(chunks, DEV_ONLY),
  };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
const failures: string[] = [];

const reportAt = process.argv.indexOf("--report");
const base = reportAt > 0 ? readReport(resolve(process.argv[reportAt + 1] ?? "")) : build();
console.log(
  `game route: ${base.routeFiles.length} chunks, ${kb(base.routeBytes)} rendered; ` +
    `${base.engineModules.length} engine modules, ${kb(base.engineBytes)}`,
);
if (base.inRoute.length)
  failures.push(`dev-only modules in the game route:\n  ${base.inRoute.join("\n  ")}`);
if (base.anywhere.length)
  failures.push(`dev-only modules in the client build:\n  ${base.anywhere.join("\n  ")}`);

if (process.argv.includes("--self-test")) {
  const leaked = build({
    into: ROUTE_MODULE,
    code: 'import { createDebugOverlay as __leak } from "@jams/engine/debug";\nglobalThis.__engineBundleLeak = __leak;',
  });
  if (leaked.inRoute.some((m) => m.includes("src/engine/debug/"))) {
    console.log("self-test: a static debug import in the route is caught");
  } else {
    failures.push("self-test: a static debug import in the route went unnoticed");
  }
}

if (process.argv.includes("--side-effects")) {
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

if (failures.length) {
  console.error(`\nengine bundle check failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("engine bundle check passed");

/**
 * Reports the preload graph TanStack Start bakes into each route: the root
 * carries the client entry's whole static import graph (see
 * `docs/plans/15-preload-graph.md` §2), and every route adds its own chunks
 * on top. Run against a fresh `.output` — `vp build` first.
 *
 * `--check` exits non-zero if the root exceeds ROOT_BUDGET, so a regression
 * fails CI instead of quietly regrowing. Tighten the budget as further
 * levers in plan 15 land; it currently reflects §3.1 and §3.2 but not yet
 * §3.3 (the entry importing every route, left alone — see the plan).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT_BUDGET = { chunks: 58, gzipBytes: 310 * 1024 };

const outputDir = join(process.cwd(), ".output");
const serverDir = join(outputDir, "server");
const publicDir = join(outputDir, "public");

interface ManifestRoute {
  filePath?: string;
  preloads?: string[];
}

interface Manifest {
  routes: Record<string, ManifestRoute>;
}

function findManifest(): string {
  let entries: string[];
  try {
    entries = readdirSync(serverDir).filter(
      (f) => f.startsWith("_tanstack-start-manifest_v-") && f.endsWith(".mjs"),
    );
  } catch {
    throw new Error(`No \`.output/server\` directory. Run \`vp build\` first.`);
  }
  if (entries.length === 0) {
    throw new Error(`No manifest found in ${serverDir}. Run \`vp build\` first.`);
  }
  if (entries.length > 1) {
    throw new Error(
      `Multiple manifests found in ${serverDir}: ${entries.join(", ")}. Clean \`.output\` and rebuild.`,
    );
  }
  return join(serverDir, entries[0]!);
}

const gzipSizeCache = new Map<string, number>();

function gzipSize(assetPath: string): number {
  const cached = gzipSizeCache.get(assetPath);
  if (cached !== undefined) return cached;
  const filePath = join(publicDir, assetPath.replace(/^\//, ""));
  const content = readFileSync(filePath);
  const size = gzipSync(content, { level: 9 }).length;
  gzipSizeCache.set(assetPath, size);
  return size;
}

function fmtKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

async function main() {
  const check = process.argv.includes("--check");
  const manifestPath = findManifest();
  const { tsrStartManifest } = (await import(manifestPath)) as {
    tsrStartManifest: () => Manifest;
  };
  const manifest = tsrStartManifest();

  const rows = Object.entries(manifest.routes)
    .map(([routeId, route]) => {
      const unique = [...new Set(route.preloads ?? [])];
      const bytes = unique.reduce((sum, asset) => sum + gzipSize(asset), 0);
      return { routeId, chunks: unique.length, bytes };
    })
    .filter((r) => r.chunks > 0)
    .sort((a, b) => b.bytes - a.bytes);

  const routeCol = Math.max(...rows.map((r) => r.routeId.length), "route".length);
  console.log(`${"route".padEnd(routeCol)}  chunks      gz`);
  for (const r of rows) {
    console.log(
      `${r.routeId.padEnd(routeCol)}  ${String(r.chunks).padStart(6)}  ${fmtKb(r.bytes).padStart(6)}`,
    );
  }

  if (!check) return;

  const root = rows.find((r) => r.routeId === "__root__");
  if (!root) throw new Error("No __root__ entry in manifest.");

  const overChunks = root.chunks > ROOT_BUDGET.chunks;
  const overBytes = root.bytes > ROOT_BUDGET.gzipBytes;
  if (overChunks || overBytes) {
    console.error(
      `\n__root__ preload budget exceeded: ${root.chunks} chunks (budget ${ROOT_BUDGET.chunks}), ` +
        `${fmtKb(root.bytes)} gz (budget ${fmtKb(ROOT_BUDGET.gzipBytes)}).`,
    );
    process.exit(1);
  }
  console.log(
    `\n__root__ within budget: ${root.chunks}/${ROOT_BUDGET.chunks} chunks, ` +
      `${fmtKb(root.bytes)}/${fmtKb(ROOT_BUDGET.gzipBytes)} gz.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

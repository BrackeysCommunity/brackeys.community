/**
 * The engine's browser smoke: build the page in `browser/` with Vite, serve
 * it with `vite preview`, open it headless in each browser, and check that
 * every browser's digest of the shared run (`browser/run.ts`) equals the
 * one Bun computes in-process, and that its render run (`browser/render.ts`)
 * draws the kitchen sink's crate sprite where it stands and nothing in the
 * empty air beside it. The preview server serves the engine project's blobs
 * on the dev route (`browser/project.ts`).
 *
 *   vp run engine:smoke:browser [--browsers chromium,firefox,webkit]
 *
 * Writes `engine-browser-smoke.json` at the repo root. A browser Playwright
 * hasn't installed is skipped locally and fails under `CI=true`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";
import { build, preview, type PreviewServer } from "vite-plus";

import {
  judgeLaunchFailure,
  judgeResult,
  overallOk,
  PAGE_TIMEOUT_MS,
  parseBrowsers,
  withTimeout,
  type BrowserName,
  type BrowserOutcome,
} from "./browser-compare";
import type { EngineSmokeResult } from "./browser/main";
import { loadSinkProject, sinkPreviewPlugin, type SinkProject } from "./browser/project";
import { runSmokeDigest } from "./browser/run";
import { INSIDE_COLOUR, INSIDE_POINT, OUTSIDE_POINT, SINK_SCENE } from "./browser/sink";
import { REPO, ENGINE } from "./pack";

const PAGE_DIR = join(REPO, "scripts/engine-smoke/browser");
const REPORT = join(REPO, "engine-browser-smoke.json");
const TYPES: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

const { values } = parseArgs({ options: { browsers: { type: "string" } } });
const browsers = parseBrowsers(values.browsers);
const ci = process.env.CI === "true";

const outDir = mkdtempSync(join(tmpdir(), "jams-engine-browser-smoke-"));
let server: PreviewServer | null = null;
let sink: SinkProject | null = null;
const open = new Set<Browser>();

async function cleanup(): Promise<void> {
  await Promise.allSettled([...open].map((b) => b.close()));
  open.clear();
  const closing = server;
  server = null;
  await closing?.close();
  const project = sink;
  sink = null;
  await project?.close();
  rmSync(outDir, { recursive: true, force: true });
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.once(signal, () => {
    console.error(`\n${signal}: stopping the preview server`);
    void cleanup().finally(() => process.exit(code));
  });
}

async function runIn(name: BrowserName, url: string, expected: string): Promise<BrowserOutcome> {
  const started = performance.now();
  let browser: Browser;
  try {
    browser = await TYPES[name].launch({ headless: true });
  } catch (err) {
    return judgeLaunchFailure(name, err instanceof Error ? err.message : String(err), ci);
  }
  open.add(browser);
  try {
    const page = await browser.newPage();
    const pageError = new Promise<never>((_, reject) => {
      page.once("pageerror", (err) => reject(new Error(`uncaught in the page: ${err.message}`)));
    });
    pageError.catch(() => {});
    const result = await withTimeout(
      Promise.race([
        (async () => {
          await page.goto(url);
          await page.waitForFunction(() => window.__engineSmoke !== undefined, null, {
            timeout: 0,
          });
          return page.evaluate(() => window.__engineSmoke) as Promise<EngineSmokeResult>;
        })(),
        pageError,
      ]),
      PAGE_TIMEOUT_MS,
      `${name}'s window.__engineSmoke`,
    );
    return { ...judgeResult(name, result, expected), ms: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      browser: name,
      status: "fail",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    open.delete(browser);
    await browser.close().catch(() => {});
  }
}

let outcomes: BrowserOutcome[] = [];
let node: Awaited<ReturnType<typeof runSmokeDigest>> | null = null;
let error: string | null = null;

try {
  node = await runSmokeDigest();
  console.log(`in-process (bun ${process.versions.bun}): ${node.digest}`);
  const project = await loadSinkProject(join(ENGINE, "scenes"));
  sink = project;

  await build({
    configFile: false,
    root: PAGE_DIR,
    base: "./",
    logLevel: "warn",
    resolve: {
      alias: [
        { find: /^@jams\/engine$/, replacement: join(ENGINE, "index.ts") },
        { find: /^@jams\/engine\/(.+)$/, replacement: join(ENGINE, "$1/index.ts") },
      ],
    },
    // `-compat` inlines its wasm as base64, so the one chunk is a few MB by design.
    build: { outDir, emptyOutDir: true, reportCompressedSize: false, chunkSizeWarningLimit: 8192 },
  });
  server = await preview({
    configFile: false,
    root: PAGE_DIR,
    logLevel: "warn",
    plugins: [sinkPreviewPlugin(project)],
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
  });
  const { port } = server.httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`serving the page at ${url}`);

  for (const name of browsers) {
    const outcome = await runIn(name, url, node.digest);
    outcomes.push(outcome);
    const drew = outcome.render
      ? `; ${outcome.render.renderer} drew rgba(${outcome.render.inside.join(", ")}) on the sprite`
      : "";
    const detail =
      outcome.status === "pass" ? `${outcome.digest}${drew} in ${outcome.ms} ms` : outcome.reason;
    console.log(`${name}: ${outcome.status}${detail ? ` — ${detail}` : ""}`);
  }
} catch (err) {
  error = err instanceof Error ? (err.stack ?? err.message) : String(err);
} finally {
  await cleanup();
}

const ok = error === null && overallOk(outcomes);
writeFileSync(
  REPORT,
  `${JSON.stringify(
    {
      ok,
      ci,
      engine: node?.engine ?? null,
      ticks: node?.ticks ?? null,
      flavour: "rapier2d-compat",
      render: {
        scene: SINK_SCENE,
        inside: { at: INSIDE_POINT, colour: `#${INSIDE_COLOUR.toString(16).padStart(6, "0")}` },
        outside: { at: OUTSIDE_POINT },
      },
      inProcess: node && { runtime: `bun ${process.versions.bun}`, digest: node.digest },
      browsers: outcomes,
      ...(error ? { error } : {}),
    },
    null,
    2,
  )}\n`,
);

if (error) console.error(`\nengine browser smoke failed:\n${error}`);
const skipped = outcomes.filter((o) => o.status === "skipped").map((o) => o.browser);
if (ok) {
  console.log(
    `engine browser smoke passed${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}`,
  );
} else {
  if (!error) console.error("\nengine browser smoke failed");
  process.exit(1);
}

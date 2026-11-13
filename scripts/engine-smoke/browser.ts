/**
 * The engine's browser smoke: build the page in `browser/` with Vite, serve
 * it with `vite preview`, open it headless in each browser, and check that
 * every browser's digest of the shared run (`browser/run.ts`) equals the
 * one Bun computes in-process, that its physics-free run
 * (`browser/physics-free.ts`) gives Bun's digest too without ever loading
 * Rapier, that its tactics run (`browser/tactics.ts`) replays the tactics
 * game's golden recording to the game's one pin with no Rapier, and that its
 * render run (`browser/render.ts`) draws the kitchen sink's crate sprite where
 * it stands and nothing in the empty air beside it. The preview server serves the engine project's blobs on the dev route
 * (`browser/project.ts`).
 *
 * Then, in the same browser, the editor page (`browser/editor.ts`): the
 * packed `dist` editor on the kitchen sink of a scratch copy of the engine
 * project, served by `listenSceneCollab` in a Node child (Hocuspocus won't
 * run under Bun) behind a second preview server's proxy. It is measured at
 * each of `EDITOR_VIEWPORTS`, switched to another tab, and its own renderer's
 * crate pixel read back.
 *
 *   vp run engine:smoke:browser [--browsers chromium,firefox,webkit] [--out <file>]
 *
 * Writes `engine-browser-smoke.json` at the repo root, or to `--out`. A
 * browser Playwright hasn't installed is skipped locally and fails under
 * `CI=true`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite-plus";

import { engineScenes, type EngineScenes } from "../engine-editor/run";
import {
  EDITOR_TAB,
  EDITOR_VIEWPORTS,
  INSPECTOR_MIN_PX,
  judgeEditor,
  judgeLaunchFailure,
  judgePhysicsFree,
  judgeResult,
  judgeTactics,
  overallOk,
  PAGE_TIMEOUT_MS,
  parseBrowsers,
  withTimeout,
  type BrowserName,
  type BrowserOutcome,
  type EditorOutcome,
  type EditorTabProbe,
  type PhysicsFreeProbe,
  type SmokeExpected,
} from "./browser-compare";
import type { EngineEditorPage } from "./browser/editor";
import type { EngineSmokeResult } from "./browser/main";
import { rapierSpy, runPhysicsFree } from "./browser/physics-free";
import { loadSinkProject, sinkPreviewPlugin, type SinkProject } from "./browser/project";
import { loadRapier, runSmokeDigest } from "./browser/run";
import { INSIDE_COLOUR, INSIDE_POINT, OUTSIDE_POINT, SINK_SCENE } from "./browser/sink";
import { runTactics, type TacticsProbe } from "./browser/tactics";
import { closeWithin } from "./export";
import { ENGINE, REPO, run, VP } from "./pack";

const PAGE_DIR = join(REPO, "scripts/engine-smoke/browser");
const TYPES: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

const { values } = parseArgs({
  options: { browsers: { type: "string" }, out: { type: "string" } },
});
const browsers = parseBrowsers(values.browsers);
const REPORT = values.out ? resolve(values.out) : join(REPO, "engine-browser-smoke.json");
const ci = process.env.CI === "true";

const outDir = mkdtempSync(join(tmpdir(), "jams-engine-browser-smoke-"));
const editorOutDir = mkdtempSync(join(tmpdir(), "jams-engine-browser-smoke-editor-"));
let server: PreviewServer | null = null;
let sink: SinkProject | null = null;
let editorServer: ChildProcess | null = null;
let editorScenes: EngineScenes | null = null;
const open = new Set<Browser>();

async function cleanup(): Promise<void> {
  await Promise.allSettled([...open].map((b) => closeWithin(b.close(), "a browser")));
  open.clear();
  const closing = server;
  server = null;
  await closing?.close();
  const child = editorServer;
  editorServer = null;
  await stopChild(child);
  const scenes = editorScenes;
  editorScenes = null;
  await scenes?.remove();
  const project = sink;
  sink = null;
  await project?.close();
  rmSync(outDir, { recursive: true, force: true });
  rmSync(editorOutDir, { recursive: true, force: true });
}

/**
 * The editor page's server, run by Node: the engine project's collab server
 * from `dist/vite.mjs` and a preview of the editor build that proxies the
 * collab socket and the project routes to it. Prints its port once both
 * listen; stops on SIGTERM or when the runner's end of stdin closes.
 */
const EDITOR_SERVER = `
const cfg = JSON.parse(process.env.ENGINE_EDITOR_SMOKE);
const [{ listenSceneCollab, readFileProject }, { preview }] = await Promise.all([
  import(cfg.vite),
  import("vite-plus"),
]);
const project = await readFileProject(cfg.scenesDir, { cacheDir: cfg.cacheDir });
const collab = await listenSceneCollab({
  projects: [project],
  warn: (m) => console.error("[scene-collab] " + m),
});
const target = collab.httpUrl;
const server = await preview({
  configFile: false,
  root: cfg.root,
  logLevel: "warn",
  build: { outDir: cfg.outDir },
  preview: {
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    open: false,
    proxy: {
      "/__scene-collab": { target, ws: true },
      "/__project": { target },
    },
  },
});
let stopping = null;
const stop = () =>
  (stopping ??= Promise.allSettled([server.close(), collab.close()]).then(() => process.exit(0)));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
process.stdin.on("end", stop);
process.stdin.resume();
console.log("ready " + server.httpServer.address().port);
`;

/** Starts the editor's server and resolves its page's URL; rejects when Node exits or stays silent first. */
function startEditorServer(scenes: EngineScenes): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(
    process.env.NODE ?? "node",
    ["--no-experimental-webstorage", "--input-type=module", "-e", EDITOR_SERVER],
    {
      cwd: REPO,
      env: {
        ...process.env,
        ENGINE_EDITOR_SMOKE: JSON.stringify({
          vite: pathToFileURL(join(ENGINE, "dist/vite.mjs")).href,
          scenesDir: scenes.dir,
          cacheDir: scenes.cacheDir,
          root: PAGE_DIR,
          outDir: editorOutDir,
        }),
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const ready = new Promise<{ child: ChildProcess; url: string }>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", (line) => {
      const port = /^ready (\d+)$/.exec(line)?.[1];
      if (port) resolve({ child, url: `http://127.0.0.1:${port}/editor.html` });
      else console.log(`[editor server] ${line}`);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      reject(new Error(`the editor's server exited (${signal ?? code}) before it listened`)),
    );
  });
  return withTimeout(ready, PAGE_TIMEOUT_MS, "the editor's server").catch(async (err) => {
    await stopChild(child);
    throw err;
  });
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
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

/** Rejects with the page's first uncaught error, for racing against whatever the runner waits on. */
function pageErrors(page: Page): Promise<never> {
  const failed = new Promise<never>((_, reject) => {
    page.once("pageerror", (err) => reject(new Error(`uncaught in the page: ${err.message}`)));
  });
  failed.catch(() => {});
  return failed;
}

async function runEngine(
  browser: Browser,
  name: BrowserName,
  url: string,
  expected: SmokeExpected,
): Promise<BrowserOutcome> {
  const started = performance.now();
  const page = await browser.newPage();
  try {
    const errors = pageErrors(page);
    const result = await withTimeout(
      Promise.race([
        (async () => {
          await page.goto(url);
          await page.waitForFunction(() => window.__engineSmoke !== undefined, null, {
            timeout: 0,
          });
          return page.evaluate(() => window.__engineSmoke) as Promise<EngineSmokeResult>;
        })(),
        errors,
      ]),
      PAGE_TIMEOUT_MS,
      `${name}'s window.__engineSmoke`,
    );
    return { ...judgeResult(name, result, expected), ms: Math.round(performance.now() - started) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runEditor(browser: Browser, name: BrowserName, url: string): Promise<EditorOutcome> {
  const started = performance.now();
  const [first] = EDITOR_VIEWPORTS;
  const context = await browser.newContext({ viewport: { ...first } });
  try {
    const page = await context.newPage();
    const errors = pageErrors(page);
    const step = <T>(label: string, work: () => Promise<T>) =>
      withTimeout(Promise.race([work(), errors]), PAGE_TIMEOUT_MS, `${name}'s editor: ${label}`);

    await step("loading the page", () => page.goto(url));
    const crate = page
      .getByRole("navigation", { name: "Outliner" })
      .getByRole("button", { name: /^crate/ })
      .first();
    const mounted = await step("mounting", () =>
      Promise.race([
        crate.waitFor({ state: "visible", timeout: 0 }).then(() => null),
        page
          .waitForFunction(() => window.__engineEditor?.error, null, { timeout: 0 })
          .then((h) => h.jsonValue() as Promise<string>),
      ]),
    ).catch(async (err: unknown) => {
      const status = await page
        .locator(".je-editor-connecting")
        .textContent({ timeout: 1000 })
        .catch(() => null);
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}${status ? `; the editor shows "${status.trim()}"` : ""}`,
      );
    });
    if (mounted) return judgeEditor(name, { ok: false, error: mounted });

    await step("selecting the crate", () => crate.click());
    const layouts: Awaited<ReturnType<EngineEditorPage["measure"]>>[] = [];
    let tab: EditorTabProbe | null = null;
    for (const viewport of EDITOR_VIEWPORTS) {
      await page.setViewportSize({ ...viewport });
      layouts.push(
        await step(`measuring at ${viewport.width}×${viewport.height}`, () =>
          page.evaluate(() => window.__engineEditor!.measure()),
        ),
      );
      if (tab) continue;
      await step(`switching to the ${EDITOR_TAB} tab`, () =>
        page
          .getByRole("tab", { name: new RegExp(`^${EDITOR_TAB}\\b`) })
          .first()
          .click(),
      );
      tab = await step(`reading the ${EDITOR_TAB} tab`, () =>
        page.evaluate(async (label) => {
          await window.__engineEditor!.measure();
          return window.__engineEditor!.tabShown(label);
        }, EDITOR_TAB),
      );
    }
    await page.setViewportSize({ ...first });
    const render = await step("reading the crate's sprite", () =>
      page.evaluate((ms) => window.__engineEditor!.readSprite(ms), PAGE_TIMEOUT_MS / 2),
    );
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return {
      ...judgeEditor(name, { ok: true, layouts, tab: tab!, render, userAgent }),
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      browser: name,
      status: "fail",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await closeWithin(context.close(), `${name}'s editor context`);
  }
}

async function runIn(
  name: BrowserName,
  url: string,
  expected: SmokeExpected,
  editorUrl: string,
): Promise<BrowserOutcome> {
  let browser: Browser;
  try {
    browser = await TYPES[name].launch({ headless: true });
  } catch (err) {
    return judgeLaunchFailure(name, err instanceof Error ? err.message : String(err), ci);
  }
  open.add(browser);
  try {
    const engine = await runEngine(browser, name, url, expected).catch(
      (err: unknown): BrowserOutcome => ({
        browser: name,
        status: "fail",
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ...engine, editor: await runEditor(browser, name, editorUrl) };
  } finally {
    open.delete(browser);
    await closeWithin(browser.close(), name);
  }
}

let outcomes: BrowserOutcome[] = [];
let node: Awaited<ReturnType<typeof runSmokeDigest>> | null = null;
let physicsFree: PhysicsFreeProbe | null = null;
let tactics: TacticsProbe | null = null;
let error: string | null = null;

try {
  node = await runSmokeDigest();
  console.log(`in-process (bun ${process.versions.bun}): ${node.digest}`);
  const spy = rapierSpy(loadRapier);
  physicsFree = { ...(await runPhysicsFree(spy.load)), rapierLoads: spy.calls(), shellTicks: null };
  const unsound = judgePhysicsFree(physicsFree, physicsFree.digest, false);
  if (unsound) throw new Error(`in-process: ${unsound}`);
  console.log(`in-process physics-free: ${physicsFree.digest}`);
  const tacticsSpy = rapierSpy(loadRapier);
  tactics = { ...(await runTactics(tacticsSpy.load)), rapierLoads: tacticsSpy.calls() };
  const offPin = judgeTactics(tactics);
  if (offPin) throw new Error(`in-process: ${offPin}`);
  console.log(`in-process tactics: ${tactics.digest}`);
  const expected: SmokeExpected = { digest: node.digest, physicsFree: physicsFree.digest };
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

  // The editor page runs the package as it ships: `dist`, packed fresh.
  run(VP, ["pack"], { cwd: ENGINE });
  await build({
    configFile: false,
    root: PAGE_DIR,
    base: "./",
    logLevel: "warn",
    resolve: {
      alias: [
        {
          find: /^@jams\/engine\/editor-ui\/style\.css$/,
          replacement: join(ENGINE, "editor-ui/style.css"),
        },
        { find: /^@jams\/engine$/, replacement: join(ENGINE, "dist/index.mjs") },
        { find: /^@jams\/engine\/(.+)$/, replacement: join(ENGINE, "dist/$1.mjs") },
      ],
    },
    build: {
      outDir: editorOutDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 8192,
      rollupOptions: { input: join(PAGE_DIR, "editor.html") },
    },
  });
  editorScenes = await engineScenes();
  const editor = await startEditorServer(editorScenes);
  editorServer = editor.child;
  console.log(`serving the editor at ${editor.url}`);

  for (const name of browsers) {
    const outcome = await runIn(name, url, expected, editor.url);
    outcomes.push(outcome);
    const drew = outcome.render
      ? `; ${outcome.render.renderer} drew rgba(${outcome.render.inside.join(", ")}) on the sprite`
      : "";
    const free = outcome.physicsFree ? `; physics-free ${outcome.physicsFree.digest}` : "";
    const second = outcome.tactics ? `; tactics ${outcome.tactics.digest}` : "";
    const detail =
      outcome.status === "pass"
        ? `${outcome.digest}${free}${second}${drew} in ${outcome.ms} ms`
        : outcome.reason;
    console.log(`${name}: ${outcome.status}${detail ? ` — ${detail}` : ""}`);
    const ed = outcome.editor;
    if (ed) {
      const edDetail = ed.status === "pass" ? `in ${ed.ms} ms` : ed.reason;
      console.log(`${name} editor: ${ed.status}${edDetail ? ` — ${edDetail}` : ""}`);
    }
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
      editor: {
        scene: SINK_SCENE,
        viewports: EDITOR_VIEWPORTS,
        inspectorMin: INSPECTOR_MIN_PX,
        tab: EDITOR_TAB,
      },
      inProcess: node && {
        runtime: `bun ${process.versions.bun}`,
        digest: node.digest,
        physicsFree,
        tactics,
      },
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

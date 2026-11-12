/**
 * The play-frame smoke: tactics and the platformer built with `game build`
 * (the web export), uploaded through the site's release protocol into a
 * PGlite database and a memory object store, and served by the site's own
 * frame route on one origin (`play-adapter.ts`); the play page stand-in
 * (`play-host.html`, bundled here with the site's host server and
 * signed-out saves) frames them from a second origin with the play page's
 * sandbox. Then, in each browser:
 *
 * - `play`, both games: the frame reaches `data-jams-state="ready"` under the
 *   frame's full CSP with no violation the build caused, reports "ready" to
 *   the host over the channel, and draws;
 * - `saves`, tactics: Start, End turn, Save on turn 2 through the host into
 *   the host origin's IndexedDB; the host page reloads, the menu offers
 *   Continue with the host's own save note, and Continue lands on turn 2;
 * - `embed`, tactics: a page on a third origin frames the host page, as
 *   another site frames the embed page, and the frame still reaches "ready"
 *   and draws: a public release's CSP admits every ancestor;
 * - `sandbox`, tactics: inside the frame `self.origin` is "null",
 *   `document.cookie` and `localStorage` throw, a fetch to the host's `/api/`
 *   and to the platformer's release directory are refused before reaching
 *   either server, an injected inline script doesn't run, a top-level
 *   navigation doesn't happen, and the frame URL opened directly is still
 *   on an opaque origin;
 * - every run: no request leaves the release's directory and the host
 *   page's own files (the browser's request log, probes aside), and the
 *   root element's `data-jams-render` never reads "lost".
 *
 *   vp run engine:smoke:play [--browsers chromium,firefox,webkit] [--out <file>]
 *
 * Writes `engine-play-smoke.json` at the repo root, or to `--out`. A browser
 * Playwright hasn't installed is skipped locally and fails under `CI=true`.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import type { Browser, BrowserContext, BrowserType, Frame, Page } from "playwright";

import { FRAME_ALLOW, FRAME_SANDBOX } from "../../src/lib/engine/frame-sandbox";
import { LOCAL_SAVES_DB, SIGNED_OUT_SAVES_DESCRIBE } from "../../src/lib/engine/local-saves";
import {
  installCommand,
  isMissingBrowser,
  PAGE_TIMEOUT_MS,
  parseBrowsers,
  withTimeout,
  type BrowserName,
} from "./browser-compare";
import { BUILD_TIMEOUT_MS, decodePng, distinctColours, judgeDrawn, RUN_TIMEOUT_MS } from "./export";
import { describeFailure, REPO, VP } from "./pack";
import type { HandlerServer, PublishedRelease, SmokeSite } from "./play-adapter";
import { serveStatic, type StaticServer } from "./static-server";

// ─── What runs ───────────────────────────────────────────

export const PLAY_GAMES = ["tactics", "platformer"] as const;
export type PlayGame = (typeof PLAY_GAMES)[number];

export type PlayRunKind = "play" | "embed" | "saves" | "sandbox";

export type PlannedPlayRun = { game: PlayGame; kind: PlayRunKind; browser: BrowserName };

/** One browser's runs, in order. */
export const PLAY_RUNS: readonly { game: PlayGame; kind: PlayRunKind }[] = [
  { game: "platformer", kind: "play" },
  { game: "tactics", kind: "play" },
  { game: "tactics", kind: "embed" },
  { game: "tactics", kind: "saves" },
  { game: "tactics", kind: "sandbox" },
];

/** The release the sandbox run's frame tries to read from: another project's directory. */
export const OTHER_RELEASE_GAME: Record<PlayGame, PlayGame> = {
  tactics: "platformer",
  platformer: "tactics",
};

export const plannedPlayRuns = (browsers: readonly BrowserName[]): PlannedPlayRun[] =>
  browsers.flatMap((browser) => PLAY_RUNS.map((run) => ({ ...run, browser })));

export const HOST_PAGE_FILE = "play-host.html";
/** The embed run's page on a third origin, standing in for another site that embeds the game. */
export const EMBEDDER_FILE = "embedder.html";
const EMBEDDER_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Another site</title>
<iframe id="embed" style="width: 960px; height: 600px; border: 0"></iframe>
<script>
  document.getElementById("embed").src = new URLSearchParams(location.search).get("src");
</script>
`;
/** The release's page as the play page frames it. */
export const FRAME_ENTRY = "index.html?host=jams";
/** Marks the sandbox run's own requests: judged by whether a server saw them, never by the request log. */
export const PROBE_PARAM = "jams-probe";
/** How long the sandbox run waits for an injected script or a navigation that mustn't happen. */
export const SETTLE_MS = 1500;

/** The tactics HUD's turn banner on the turn the save run saves. */
export const SAVED_BANNER = "Turn 2 · Your orders";
export const SAVED_NOTE = "Saved";

// ─── Requests ────────────────────────────────────────────

/** What a run may reach: its release's directory and the host page's own files. */
export type PlayScope = {
  /** The release's directory URL, with its trailing slash. */
  release: string;
  hostOrigin: string;
  /** The host bundle's paths, each starting with "/". */
  hostFiles: ReadonlySet<string>;
  /** The embed run's outer page, without its query. */
  embedder?: string;
};

export type PlayRequestScope = "release" | "host-page" | "local" | "outside";

const FAVICON = "/favicon.ico";

/**
 * Where a request went: under the release's directory, to one of the host
 * page's files, nowhere on the network (`data:`, `about:`, `blob:`, or the
 * browser's own favicon fetch), or anywhere else.
 */
export function playRequestScope(url: string, scope: PlayScope): PlayRequestScope {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "outside";
  }
  if (["data:", "about:", "blob:"].includes(parsed.protocol)) return "local";
  const path = `${parsed.origin}${parsed.pathname}`;
  if (path.startsWith(scope.release)) return "release";
  if (parsed.origin === scope.hostOrigin && scope.hostFiles.has(parsed.pathname))
    return "host-page";
  if (scope.embedder !== undefined && path === scope.embedder) return "host-page";
  if (parsed.pathname === FAVICON) return "local";
  return "outside";
}

/** The requests outside the run's scope, each once in first-seen order; probes are left out. */
export function outsideRequests(urls: readonly string[], scope: PlayScope): string[] {
  const outside = new Set<string>();
  for (const url of urls) {
    if (isProbe(url)) continue;
    if (playRequestScope(url, scope) === "outside") outside.add(url);
  }
  return [...outside];
}

export const isProbe = (url: string): boolean => {
  try {
    return new URL(url, "http://x").searchParams.has(PROBE_PARAM);
  } catch {
    return false;
  }
};

// ─── Verdicts ────────────────────────────────────────────

/** A `securitypolicyviolation` the frame saw. */
export type CspViolation = { directive: string; blocked: string; source: string };

/**
 * Whether a violation is the CSP doing what it was written for while the
 * game plays on: Pixi's feature probe for `new Function` (the standalone
 * host installs Pixi's eval-free paths), and the build's PWA manifest link (a hosted
 * release installs nothing: `manifest-src 'none'`).
 */
export function expectedViolation(v: CspViolation): boolean {
  if (v.blocked === "eval") return true;
  return v.directive === "manifest-src";
}

export function judgeViolations(violations: readonly CspViolation[]): string | null {
  const unexpected = violations.filter((v) => !expectedViolation(v));
  if (unexpected.length === 0) return null;
  const listed = unexpected.map((v) => `${v.directive} refused ${v.blocked || "(inline)"}`);
  return `the frame's CSP refused what the build loads: ${[...new Set(listed)].join(", ")}`;
}

/** What the host page heard from its frame. */
export type HostProbe = { states: string[]; issues: string[]; dropped: number };

export function judgeHost(probe: HostProbe | undefined): string[] {
  if (!probe) return ["the host page kept no record"];
  const reasons: string[] = [];
  if (probe.states.includes("error"))
    reasons.push(
      `the frame reported "error" to the host${probe.issues.length ? `: ${probe.issues.join("; ")}` : ""}`,
    );
  else if (probe.states.at(-1) !== "ready")
    reasons.push(
      `the frame's last state over the host channel is ${probe.states.at(-1) ?? "none"}, not "ready"`,
    );
  if (probe.dropped > 0) reasons.push(`the host dropped ${probe.dropped} of the frame's messages`);
  return reasons;
}

/** What the save run saw: the save, the host's storage, and the reloaded menu. */
export type SavesProbe = {
  note: string;
  /** Records in the host origin's `jams-play-saves` IndexedDB after the save. */
  hostRecords: number;
  /** The reloaded menu's save line: the host's `describe`. */
  menuNote: string | null;
  /** The banner once Continue loaded the save. */
  continued: string | null;
};

export function judgeSaves(p: SavesProbe | undefined): string[] {
  if (!p) return ["the save run didn't finish"];
  const reasons: string[] = [];
  if (p.note !== SAVED_NOTE) reasons.push(`Save said "${p.note}", not "${SAVED_NOTE}"`);
  if (p.hostRecords < 1) reasons.push("the host origin's IndexedDB holds no save after Save");
  if (p.menuNote !== SIGNED_OUT_SAVES_DESCRIBE)
    reasons.push(
      `the reloaded menu's save note is ${JSON.stringify(p.menuNote)}, not the host's signed-out note`,
    );
  if (p.continued !== SAVED_BANNER)
    reasons.push(`Continue landed on ${JSON.stringify(p.continued)}, not "${SAVED_BANNER}"`);
  return reasons;
}

/** What the sandbox run read inside the frame, and opened directly. */
export type SandboxProbe = {
  origin: string;
  cookieThrows: boolean;
  localStorageThrows: boolean;
  /** The fetch to the host origin's `/api/` rejected. */
  apiBlocked: boolean;
  /** The fetch to another release's directory rejected. */
  otherReleaseBlocked: boolean;
  inlineRan: boolean;
  /** The host page left its URL, or the host server saw the navigation. */
  topNavigated: boolean;
  direct: { origin: string; cookieThrows: boolean; localStorageThrows: boolean } | null;
  /** Probe requests either server answered: none may arrive. */
  reachedServer: string[];
};

export function judgeSandbox(p: SandboxProbe | undefined): string[] {
  if (!p) return ["the sandbox probe didn't run"];
  const reasons: string[] = [];
  if (p.origin !== "null") reasons.push(`inside the frame self.origin is ${p.origin}, not "null"`);
  if (!p.cookieThrows) reasons.push("inside the frame document.cookie doesn't throw");
  if (!p.localStorageThrows) reasons.push("inside the frame localStorage doesn't throw");
  if (!p.apiBlocked) reasons.push("a fetch to the host's /api/ went through");
  if (!p.otherReleaseBlocked) reasons.push("a fetch to another release's directory went through");
  if (p.inlineRan) reasons.push("an injected inline script ran");
  if (p.topNavigated) reasons.push("the frame navigated the top-level page");
  if (!p.direct) reasons.push("the frame URL opened directly wasn't probed");
  else {
    if (p.direct.origin !== "null")
      reasons.push(`opened directly, the frame's self.origin is ${p.direct.origin}, not "null"`);
    if (!p.direct.cookieThrows) reasons.push("opened directly, document.cookie doesn't throw");
    if (!p.direct.localStorageThrows) reasons.push("opened directly, localStorage doesn't throw");
  }
  if (p.reachedServer.length)
    reasons.push(`probe requests reached a server: ${p.reachedServer.join(", ")}`);
  return reasons;
}

/** What a finished run observed, before judging. */
export type PlayObservation = {
  requests: readonly string[];
  scope: PlayScope;
  /** Violations in the frame before any probe ran. */
  violations: readonly CspViolation[];
  host: HostProbe;
  /** The frame root's `data-jams-render` once ready; null when the build doesn't mirror it. */
  render: string | null;
  /** Distinct colours on the frame's canvas once ready; null when not read. */
  colours: number | null;
  saves?: SavesProbe;
  sandbox?: SandboxProbe;
};

/** Every reason a run fails, in a fixed order: requests, CSP, host, render, then the run's own checks. */
export function judgePlayRun(kind: PlayRunKind, o: PlayObservation): string[] {
  const reasons: string[] = [];
  const outside = outsideRequests(o.requests, o.scope);
  if (outside.length)
    reasons.push(`requests outside the release and the host page: ${outside.join(", ")}`);
  const csp = judgeViolations(o.violations);
  if (csp) reasons.push(csp);
  reasons.push(...judgeHost(o.host));
  if (o.render === "lost") reasons.push('the frame\'s data-jams-render reads "lost"');
  if (kind === "play" || kind === "embed") {
    const flat = o.colours === null ? "the canvas wasn't read" : judgeDrawn(o.colours);
    if (flat) reasons.push(flat);
  }
  if (kind === "saves") reasons.push(...judgeSaves(o.saves));
  if (kind === "sandbox") reasons.push(...judgeSandbox(o.sandbox));
  return reasons;
}

export type PlayRunOutcome = PlannedPlayRun & {
  status: "pass" | "fail" | "skipped";
  reason?: string;
  ms?: number;
  requests?: number;
  outside?: string[];
  /** Requests that failed or got a 4xx/5xx; recorded, not judged (the probes fail by design). */
  failed?: string[];
  violations?: CspViolation[];
  host?: HostProbe;
  render?: string | null;
  colours?: number | null;
  saves?: SavesProbe;
  sandbox?: SandboxProbe;
};

export function playRunOutcome(
  planned: PlannedPlayRun,
  o: PlayObservation,
  failed: readonly string[],
  ms: number,
): PlayRunOutcome {
  const reasons = judgePlayRun(planned.kind, o);
  return {
    ...planned,
    status: reasons.length ? "fail" : "pass",
    ...(reasons.length ? { reason: reasons.join("; ") } : {}),
    ms,
    requests: o.requests.length,
    outside: outsideRequests(o.requests, o.scope),
    failed: [...new Set(failed)],
    violations: [...o.violations],
    host: o.host,
    render: o.render,
    colours: o.colours,
    ...(o.saves ? { saves: o.saves } : {}),
    ...(o.sandbox ? { sandbox: o.sandbox } : {}),
  };
}

/** Every run in a browser that wouldn't launch: skipped locally when it isn't installed, else failed. */
export function playLaunchFailures(
  runs: readonly PlannedPlayRun[],
  message: string,
  ci: boolean,
): PlayRunOutcome[] {
  const missing = isMissingBrowser(message);
  return runs.map((run) => ({
    ...run,
    status: missing && !ci ? "skipped" : "fail",
    reason: missing
      ? `not installed; run \`${installCommand(run.browser)}\``
      : `couldn't launch: ${message.split("\n", 1)[0]}`,
  }));
}

export type PlayBuildOutcome = {
  game: PlayGame;
  ok: boolean;
  reason?: string;
  /** The release id `game build` printed; the site's commit must give the same. */
  built: string | null;
  published: PublishedRelease | null;
  ms: number;
};

export type PlaySmokeReport = {
  ok: boolean;
  ci: boolean;
  browsers: BrowserName[];
  builds: PlayBuildOutcome[];
  runs: PlayRunOutcome[];
  error?: string;
};

/** Passes when nothing errored, every build built and published, every planned run has an outcome, none failed, and one ran. */
export function playSmokeOk(
  r: Omit<PlaySmokeReport, "ok">,
  planned: readonly PlannedPlayRun[],
): boolean {
  if (r.error !== undefined) return false;
  if (r.builds.length !== PLAY_GAMES.length || r.builds.some((b) => !b.ok)) return false;
  if (r.runs.length !== planned.length) return false;
  if (r.runs.some((run) => run.status === "fail")) return false;
  return r.runs.some((run) => run.status === "pass");
}

/** Why a published release doesn't match its build, or null. */
export function judgePublished(built: string | null, published: PublishedRelease): string | null {
  if (built === null) return "game build printed no release id";
  if (published.releaseId !== built)
    return `the site recorded release ${published.releaseId}, not the build's ${built}`;
  return null;
}

// ─── Building ────────────────────────────────────────────

/** `game build <game> --target web` into `out`; the release id it printed, or why it failed. */
function buildGame(game: PlayGame, out: string): { release: string | null; reason?: string } {
  const args = ["run", "scene", "game", "build", game, "--target", "web", "--out", out];
  const res = spawnSync(VP, args, {
    cwd: REPO,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0)
    return { release: null, reason: describeFailure(`vp ${args.join(" ")}`, res) };
  return { release: /\(release ([0-9a-f]{64})\)/.exec(res.stdout)?.[1] ?? null };
}

const ENGINE = join(REPO, "packages/engine");
const SMOKE_DIR = join(REPO, "scripts/engine-smoke");

/** `play-host.html` bundled with the site's host server; the bundle's paths as the server serves them. */
async function buildHostPage(outDir: string): Promise<Set<string>> {
  const { build } = await import("vite-plus");
  await build({
    configFile: false,
    root: SMOKE_DIR,
    base: "./",
    logLevel: "warn",
    css: { postcss: { plugins: [] } },
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${join(REPO, "src")}/` },
        { find: /^@jams\/engine$/, replacement: join(ENGINE, "index.ts") },
        { find: /^@jams\/engine\/(.+)$/, replacement: join(ENGINE, "$1/index.ts") },
      ],
    },
    build: {
      outDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 8192,
      rollupOptions: { input: join(SMOKE_DIR, HOST_PAGE_FILE) },
    },
  });
  const files = new Set<string>();
  for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true }))
    if (entry.isFile())
      files.add(`/${relative(outDir, join(entry.parentPath, entry.name)).split(sep).join("/")}`);
  return files;
}

// ─── In the browser ──────────────────────────────────────

type Hosted = {
  release: PublishedRelease;
  /** The release's directory URL. */
  dir: string;
};

type Stage = {
  host: StaticServer;
  /** A third origin, for the embed run's outer page. */
  embedder: StaticServer;
  hostFiles: ReadonlySet<string>;
  frames: HandlerServer;
  releases: ReadonlyMap<PlayGame, Hosted>;
};

/** The host page framing `hosted`, as the play page would. */
function hostPageUrl(stage: Stage, hosted: Hosted): string {
  const q = new URLSearchParams({
    frame: `${hosted.dir}${FRAME_ENTRY}`,
    release: hosted.release.releaseId,
    game: hosted.release.gameId,
    project: hosted.release.projectId,
    sandbox: FRAME_SANDBOX,
    allow: FRAME_ALLOW,
  });
  return `${stage.host.url}${HOST_PAGE_FILE}?${q}`;
}

/** Another site's page framing the host page, as a site embedding the game frames the embed page. */
const embedderUrl = (stage: Stage, hosted: Hosted): string =>
  `${stage.embedder.url}${EMBEDDER_FILE}?${new URLSearchParams({ src: hostPageUrl(stage, hosted) })}`;

/** Records every CSP violation on `window.__playSmokeCsp`, in every frame, before the page's own scripts. */
async function recordViolations(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const list: { directive: string; blocked: string; source: string }[] = [];
    Object.defineProperty(window, "__playSmokeCsp", { value: list });
    window.addEventListener(
      "securitypolicyviolation",
      (e) =>
        list.push({
          directive: e.effectiveDirective || e.violatedDirective,
          blocked: e.blockedURI,
          source: e.sourceFile,
        }),
      true,
    );
  });
}

const violationsIn = (frame: Frame): Promise<CspViolation[]> =>
  frame.evaluate(() => [
    ...((window as unknown as { __playSmokeCsp?: CspViolation[] }).__playSmokeCsp ?? []),
  ]);

const hostProbe = (host: Frame): Promise<HostProbe> =>
  host.evaluate(() => {
    const r = (window as unknown as { __playHost?: HostProbe }).__playHost;
    return r
      ? { states: [...r.states], issues: [...r.issues], dropped: r.dropped }
      : { states: [], issues: [], dropped: 0 };
  });

function pageErrors(page: Page): Promise<never> {
  const failed = new Promise<never>((_, reject) => {
    page.once("pageerror", (err) => reject(new Error(`uncaught in the host page: ${err.message}`)));
  });
  failed.catch(() => {});
  return failed;
}

/** Opens the host page and hands back the release's frame once it is attached. */
async function openHosted(page: Page, url: string): Promise<Frame> {
  await page.goto(url);
  return attachedFrame(page.mainFrame());
}

/** Opens another site's page framing the host page; hands back the host page's frame and the release's. */
async function openEmbedded(page: Page, url: string): Promise<{ host: Frame; frame: Frame }> {
  await page.goto(url);
  const host = await (await page.waitForSelector("iframe#embed")).contentFrame();
  if (!host) throw new Error("the embedding page's iframe has no frame");
  return { host, frame: await attachedFrame(host) };
}

async function attachedFrame(host: Frame): Promise<Frame> {
  const frame = await (await host.waitForSelector("iframe#frame")).contentFrame();
  if (!frame) throw new Error("the host page's iframe has no frame");
  return frame;
}

/** Waits for the frame's `ready`; its `error` throws with what the page shows. */
async function waitReady(frame: Frame): Promise<void> {
  const handle = await frame.waitForFunction(
    () => {
      const state = document.documentElement.dataset.jamsState;
      return state === "ready" || state === "error" ? state : null;
    },
    null,
    { timeout: PAGE_TIMEOUT_MS },
  );
  if ((await handle.jsonValue()) === "ready") return;
  const shown = await frame
    .locator("[data-jams-error]")
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => null);
  throw new Error(`the frame reports jamsState "error"${shown ? `: ${shown.trim()}` : ""}`);
}

const renderState = (frame: Frame): Promise<string | null> =>
  frame.evaluate(() => document.documentElement.dataset.jamsRender ?? null);

/** Two frames and a beat, then the distinct colours on the frame's canvas. */
async function canvasColours(frame: Frame): Promise<number> {
  await frame.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await frame.waitForTimeout(250);
  const png = await frame.locator("#game canvas").first().screenshot({ animations: "allow" });
  return distinctColours(decodePng(png));
}

const bannerIs = (frame: Frame, want: string) =>
  frame.waitForFunction(
    (text) => document.querySelector(".tactics-hud-banner")?.textContent === text,
    want,
    { timeout: PAGE_TIMEOUT_MS },
  );

const bannerText = (frame: Frame): Promise<string | null> =>
  frame.evaluate(() => document.querySelector(".tactics-hud-banner")?.textContent ?? null);

/** The records in every store of the host origin's signed-out saves database. */
const hostSaveRecords = (page: Page): Promise<number> =>
  page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((ok, no) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => no(req.error);
    });
    let records = 0;
    for (const store of Array.from(db.objectStoreNames))
      records += await new Promise<number>((ok, no) => {
        const req = db.transaction(store).objectStore(store).count();
        req.onsuccess = () => ok(req.result);
        req.onerror = () => no(req.error);
      });
    db.close();
    return records;
  }, LOCAL_SAVES_DB);

/** Start, End turn, Save on turn 2; reload the host page; Continue. */
async function saveAndContinue(page: Page, first: Frame): Promise<SavesProbe> {
  await first.getByRole("button", { name: "Start", exact: true }).click();
  await bannerIs(first, "Turn 1 · Your orders");
  await first.locator('button[data-order="end-turn"][aria-disabled="false"]').first().click();
  await bannerIs(first, SAVED_BANNER);
  await first.locator('.tactics-hud button[data-action="save"][aria-disabled="false"]').click();
  const note = await first
    .waitForFunction(
      () => {
        const text = document.querySelector('.tactics-hud [data-save="note"]')?.textContent ?? "";
        return text === "Saved" || text.startsWith("Not saved") ? text : null;
      },
      null,
      { timeout: PAGE_TIMEOUT_MS },
    )
    .then((h) => h.jsonValue() as Promise<string>);
  const hostRecords = await hostSaveRecords(page);
  const probe: SavesProbe = { note, hostRecords, menuNote: null, continued: null };
  if (note !== SAVED_NOTE) return probe;

  await page.reload();
  const frame = await attachedFrame(page.mainFrame());
  await waitReady(frame);
  const resume = frame.locator(
    '.tactics-menu button[data-action="continue"][aria-disabled="false"]',
  );
  await resume.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  probe.menuNote = await frame
    .locator(".tactics-menu-note")
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => null);
  await resume.click();
  await bannerIs(frame, SAVED_BANNER).catch(() => {});
  probe.continued = await bannerText(frame);
  return probe;
}

/** The sandbox's checks from inside the frame, the top-level navigation, then the frame URL opened directly. */
async function probeSandbox(
  context: BrowserContext,
  page: Page,
  frame: Frame,
  stage: Stage,
  hosted: Hosted,
  other: Hosted,
): Promise<SandboxProbe> {
  const token = randomBytes(8).toString("hex");
  const probe = (url: string) => `${url}${url.includes("?") ? "&" : "?"}${PROBE_PARAM}=${token}`;
  const inside = await frame.evaluate(
    async ({ api, otherRelease, settleMs }) => {
      const throws = (read: () => unknown) => {
        try {
          read();
          return false;
        } catch {
          return true;
        }
      };
      const refused = (url: string) =>
        fetch(url, { cache: "no-store" }).then(
          () => false,
          () => true,
        );
      const flag = window as unknown as { __playSmokeInline?: boolean };
      const script = document.createElement("script");
      script.textContent = "window.__playSmokeInline = true;";
      document.head.append(script);
      const result = {
        origin: self.origin,
        cookieThrows: throws(() => document.cookie),
        localStorageThrows: throws(() => window.localStorage),
        apiBlocked: await refused(api),
        otherReleaseBlocked: await refused(otherRelease),
      };
      await new Promise((done) => setTimeout(done, settleMs));
      return { ...result, inlineRan: flag.__playSmokeInline === true };
    },
    {
      api: probe(`${stage.host.origin}/api/health`),
      otherRelease: probe(`${other.dir}index.html`),
      settleMs: SETTLE_MS,
    },
  );

  const hostUrl = page.url();
  const navigation = probe(`${stage.host.origin}/navigated`);
  await frame
    .evaluate((url) => {
      try {
        window.top!.location.href = url;
      } catch {
        // A sandboxed frame without allow-top-navigation may throw; the page's URL decides.
      }
    }, navigation)
    .catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  const direct = await context.newPage();
  let opened: SandboxProbe["direct"] = null;
  try {
    await direct.goto(`${hosted.dir}index.html`, { waitUntil: "domcontentloaded" });
    opened = await direct.evaluate(() => {
      const throws = (read: () => unknown) => {
        try {
          read();
          return false;
        } catch {
          return true;
        }
      };
      return {
        origin: self.origin,
        cookieThrows: throws(() => document.cookie),
        localStorageThrows: throws(() => window.localStorage),
      };
    });
  } finally {
    await direct.close().catch(() => {});
  }

  const reached = [...stage.host.served, ...stage.frames.served]
    .filter((r) => r.path.includes(`${PROBE_PARAM}=${token}`))
    .map((r) => r.path);
  return {
    ...inside,
    topNavigated: page.url() !== hostUrl || reached.some((p) => p.startsWith("/navigated")),
    direct: opened,
    reachedServer: reached,
  };
}

async function runOne(
  browser: Browser,
  planned: PlannedPlayRun,
  stage: Stage,
): Promise<PlayRunOutcome> {
  const started = performance.now();
  const hosted = stage.releases.get(planned.game);
  const other = stage.releases.get(OTHER_RELEASE_GAME[planned.game]);
  if (!hosted || !other) throw new Error(`nothing hosts ${planned.game}`);
  const embedded = planned.kind === "embed";
  const scope: PlayScope = {
    release: hosted.dir,
    hostOrigin: stage.host.origin,
    hostFiles: stage.hostFiles,
    ...(embedded ? { embedder: `${stage.embedder.url}${EMBEDDER_FILE}` } : {}),
  };
  const context = await browser.newContext();
  const requests: string[] = [];
  const failed: string[] = [];
  context.on("request", (r) => requests.push(r.url()));
  context.on("requestfailed", (r) =>
    failed.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`),
  );
  context.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.url()} (${r.status()})`);
  });
  try {
    await recordViolations(context);
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const errors = pageErrors(page);
    const work = async (): Promise<PlayObservation> => {
      const { host, frame } = embedded
        ? await openEmbedded(page, embedderUrl(stage, hosted))
        : { host: page.mainFrame(), frame: await openHosted(page, hostPageUrl(stage, hosted)) };
      await waitReady(frame);
      const violations = await violationsIn(frame);
      const render = await renderState(frame);
      const colours = planned.kind === "play" || embedded ? await canvasColours(frame) : null;
      const saves = planned.kind === "saves" ? await saveAndContinue(page, frame) : undefined;
      const sandbox =
        planned.kind === "sandbox"
          ? await probeSandbox(context, page, frame, stage, hosted, other)
          : undefined;
      return {
        requests,
        scope,
        violations,
        host: await hostProbe(host),
        render,
        colours,
        ...(saves ? { saves } : {}),
        ...(sandbox ? { sandbox } : {}),
      };
    };
    const observed = await withTimeout(
      Promise.race([work(), errors]),
      RUN_TIMEOUT_MS,
      `${planned.browser} ${planned.kind} ${planned.game}`,
    );
    return playRunOutcome(planned, observed, failed, Math.round(performance.now() - started));
  } catch (err) {
    return {
      ...planned,
      status: "fail",
      reason: err instanceof Error ? err.message : String(err),
      ms: Math.round(performance.now() - started),
      requests: requests.length,
      outside: outsideRequests(requests, scope),
      failed: [...new Set(failed)],
    };
  } finally {
    await context.close().catch(() => {});
  }
}

// ─── The runner ──────────────────────────────────────────

/** A refusal as the site's API would answer it: the code and message, else the error's own message. */
function refusal(err: unknown): string {
  const body = (err as { body?: { code?: unknown; message?: unknown } } | null)?.body;
  if (body && typeof body.code === "string") return `${body.code}: ${String(body.message)}`;
  return err instanceof Error ? err.message : String(err);
}

/** Variables that would point the site's modules at shared services; the smoke uses its own. */
const SHARED_SERVICE_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET",
  "POSTHOG_API_KEY",
  "VITE_PUBLIC_POSTHOG_KEY",
];

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { browsers: { type: "string" }, out: { type: "string" } },
  });
  const browsers = parseBrowsers(values.browsers);
  const reportFile = values.out ? resolve(values.out) : join(REPO, "engine-play-smoke.json");
  const ci = process.env.CI === "true";
  for (const name of SHARED_SERVICE_ENV) delete process.env[name];
  // The tests' database helper reads the migrations and caches its snapshot under the repo.
  process.chdir(REPO);
  const site = await import("./play-adapter");
  const playwright = await import("playwright");
  const types: Record<BrowserName, BrowserType> = {
    chromium: playwright.chromium,
    firefox: playwright.firefox,
    webkit: playwright.webkit,
  };

  const tmp = mkdtempSync(join(tmpdir(), "jams-engine-play-smoke-"));
  const servers: { close(): Promise<void> }[] = [];
  const open = new Set<Browser>();
  let smokeSite: SmokeSite | undefined;
  const cleanup = async () => {
    await Promise.allSettled([...open].map((b) => b.close()));
    open.clear();
    await Promise.allSettled(servers.splice(0).map((s) => s.close()));
    await smokeSite?.db.$client.close().catch(() => {});
    smokeSite = undefined;
    rmSync(tmp, { recursive: true, force: true });
  };
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.once(signal, () => {
      console.error(`\n${signal}: stopping the servers`);
      void cleanup().finally(() => process.exit(code));
    });
  }

  const planned = plannedPlayRuns(browsers);
  const builds: PlayBuildOutcome[] = [];
  const runs: PlayRunOutcome[] = [];
  let error: string | undefined;
  try {
    smokeSite = await site.createSmokeSite();
    const published = new Map<PlayGame, PublishedRelease>();
    for (const game of PLAY_GAMES) {
      const out = join(tmp, game);
      const started = performance.now();
      const built = buildGame(game, out);
      let outcome: PlayBuildOutcome = {
        game,
        ok: !built.reason,
        ...(built.reason ? { reason: built.reason } : {}),
        built: built.release,
        published: null,
        ms: 0,
      };
      if (outcome.ok) {
        try {
          const release = await site.publishBuild(smokeSite, out);
          const mismatch = judgePublished(built.release, release);
          outcome = {
            ...outcome,
            published: release,
            ...(mismatch ? { ok: false, reason: mismatch } : {}),
          };
        } catch (err) {
          outcome = { ...outcome, ok: false, reason: `the upload was refused: ${refusal(err)}` };
        }
      }
      outcome.ms = Math.round(performance.now() - started);
      builds.push(outcome);
      if (!outcome.ok || !outcome.published) throw new Error(`${game}: ${outcome.reason}`);
      published.set(game, outcome.published);
      console.log(
        `${game}: built and published as v${outcome.published.version} (release ${outcome.published.releaseId}, ${outcome.published.uploaded} files uploaded)`,
      );
    }

    const hostDir = join(tmp, "host");
    const hostFiles = await buildHostPage(hostDir);
    const host = await serveStatic({ dir: hostDir });
    servers.push(host);
    const frames = await site.serveFrames(smokeSite, host.origin);
    servers.push(frames);
    const embedderDir = join(tmp, "embedder");
    mkdirSync(embedderDir);
    writeFileSync(join(embedderDir, EMBEDDER_FILE), EMBEDDER_HTML);
    const embedder = await serveStatic({ dir: embedderDir });
    servers.push(embedder);
    console.log(
      `serving the host page at ${host.url}${HOST_PAGE_FILE}, frames at ${frames.origin}`,
    );
    const releases = new Map<PlayGame, Hosted>();
    for (const [game, release] of published)
      releases.set(game, { release, dir: site.releaseDir(frames, release.releaseId) });
    const stage: Stage = { host, embedder, hostFiles, frames, releases };

    for (const name of browsers) {
      const mine = planned.filter((p) => p.browser === name);
      let browser: Browser;
      try {
        browser = await types[name].launch({ headless: true });
      } catch (err) {
        runs.push(
          ...playLaunchFailures(mine, err instanceof Error ? err.message : String(err), ci),
        );
        console.log(`${name}: ${runs.at(-1)?.status} — ${runs.at(-1)?.reason}`);
        continue;
      }
      open.add(browser);
      try {
        for (const p of mine) {
          const outcome = await runOne(browser, p, stage);
          runs.push(outcome);
          const detail = outcome.status === "pass" ? `${outcome.ms} ms` : outcome.reason;
          console.log(`${name} ${p.kind} ${p.game}: ${outcome.status} — ${detail}`);
        }
      } finally {
        open.delete(browser);
        await browser.close().catch(() => {});
      }
    }
  } catch (err) {
    error = err instanceof Error ? (err.stack ?? err.message) : String(err);
  } finally {
    await cleanup();
  }

  const parts = { ci, browsers, builds, runs, ...(error !== undefined ? { error } : {}) };
  const report: PlaySmokeReport = { ok: playSmokeOk(parts, planned), ...parts };
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  if (error) console.error(`\nengine play smoke failed:\n${error}`);
  if (!report.ok) {
    if (!error) console.error("\nengine play smoke failed");
    return 1;
  }
  const skipped = [...new Set(runs.filter((r) => r.status === "skipped").map((r) => r.browser))];
  console.log(
    `engine play smoke passed${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}`,
  );
  return 0;
}

// Exits rather than waiting for the event loop: the site modules the smoke
// imports may hold handles that would keep a finished run alive until CI's timeout.
if (import.meta.main) process.exit(await main());

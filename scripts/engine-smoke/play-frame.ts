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
 * - `own-saves`, the fixture game in `fixtures/own-saves/` whose
 *   `GameDefinition.saves.store` is its own server: published with saves
 *   `own` and that server's HTTPS origin as its one connect origin, its Save
 *   lands on that server, the frame sends the host no `saves.*` request and
 *   the host's store sees no call; a fetch to an undeclared origin is
 *   refused by `connect-src` before reaching it;
 * - `claim`, tactics: signed out, Save on turn 2 into this browser; sign in
 *   with the smoke's test session and reload: the host page claims the
 *   save through `claimSaves` into the site's save API (PGlite and the
 *   memory object store) and this browser's copy goes; a second browser
 *   context with the same session and an empty IndexedDB offers Continue
 *   with the signed-in save note and lands on turn 2;
 * - every run: no request leaves the release's directory, the host page's
 *   own files and the routes its run uses (the browser's request log,
 *   probes aside), and the root element's `data-jams-render` never reads
 *   "lost".
 *
 *   vp run engine:smoke:play [--browsers chromium,firefox,webkit] [--out <file>]
 *
 * Writes `engine-play-smoke.json` at the repo root, or to `--out`. A browser
 * Playwright hasn't installed is skipped locally and fails under `CI=true`.
 * The games are built once; each browser then runs in its own process
 * (this script with `--builds <dir>`), with its own site and servers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { Browser, BrowserContext, BrowserType, Frame, Page } from "playwright";

import type { ClaimResult } from "../../src/lib/engine/claim-saves";
import { FRAME_ALLOW, FRAME_SANDBOX } from "../../src/lib/engine/frame-sandbox";
import type { SaveMode } from "../../src/lib/engine/host-server";
import {
  LOCAL_SAVES_DB,
  SIGNED_IN_SAVES_DESCRIBE,
  SIGNED_OUT_SAVES_DESCRIBE,
} from "../../src/lib/engine/local-saves";
import { ENGINE_SAVES_PATH } from "../../src/lib/engine/route-paths";
import { engineSourceAlias } from "../engine-source-alias";
import {
  installCommand,
  isMissingBrowser,
  PAGE_TIMEOUT_MS,
  parseBrowsers,
  withTimeout,
  type BrowserName,
} from "./browser-compare";
import {
  closeWithin,
  CLOSE_MS,
  decodePng,
  distinctColours,
  judgeDrawn,
  RUN_TIMEOUT_MS,
} from "./export";
import { SAVE_SERVER_PARAM } from "./fixtures/own-saves/store";
import { REPO } from "./pack";
import type {
  HandlerServer,
  HostSiteServer,
  PublishedRelease,
  SaveStubServer,
  SmokePlayer,
  SmokeProjectSettings,
  SmokeSite,
} from "./play-adapter";
import { BUILD_TIMEOUT_MS, buildOne, pageErrors, waitReady } from "./smoke-page";
import { serveStatic, type StaticServer } from "./static-server";

// ─── What runs ───────────────────────────────────────────

export const PLAY_GAMES = ["tactics", "platformer", "own-saves"] as const;
export type PlayGame = (typeof PLAY_GAMES)[number];

/** A game the smoke keeps beside it, built from its directory instead of by the scene CLI. */
export const PLAY_FIXTURES: Partial<Record<PlayGame, string>> = {
  "own-saves": "fixtures/own-saves",
};

export type PlayRunKind = "play" | "embed" | "saves" | "sandbox" | "own-saves" | "claim";

export type PlannedPlayRun = { game: PlayGame; kind: PlayRunKind; browser: BrowserName };

/** One browser's runs, in order. */
export const PLAY_RUNS: readonly { game: PlayGame; kind: PlayRunKind }[] = [
  { game: "platformer", kind: "play" },
  { game: "tactics", kind: "play" },
  { game: "tactics", kind: "embed" },
  { game: "tactics", kind: "saves" },
  { game: "tactics", kind: "sandbox" },
  { game: "own-saves", kind: "own-saves" },
  { game: "tactics", kind: "claim" },
];

/** The release the sandbox run's frame tries to read from: another project's directory. */
export const OTHER_RELEASE_GAME: Record<PlayGame, PlayGame> = {
  tactics: "platformer",
  platformer: "tactics",
  "own-saves": "tactics",
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
  /** Path prefixes on the host origin the host page itself calls: its session, and the save API in the claim run. */
  hostPaths?: readonly string[];
  /** Origins the game itself connects to: its declared connect origins. */
  connect?: readonly string[];
};

export type PlayRequestScope = "release" | "host-page" | "game-server" | "local" | "outside";

const FAVICON = "/favicon.ico";

/**
 * Where a request went: under the release's directory, to one of the host
 * page's files or routes, to a connect origin the game declared, nowhere on
 * the network (`data:`, `about:`, `blob:`, or the browser's own favicon
 * fetch), or anywhere else.
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
  if (
    parsed.origin === scope.hostOrigin &&
    scope.hostPaths?.some((prefix) => parsed.pathname.startsWith(prefix))
  )
    return "host-page";
  if (scope.embedder !== undefined && path === scope.embedder) return "host-page";
  if (scope.connect?.includes(parsed.origin)) return "game-server";
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
export type HostProbe = {
  states: string[];
  issues: string[];
  dropped: number;
  /** The `saves.*` messages the frame sent on its channel, in order. */
  frameSaves: string[];
  /** Every call the host server made to its save store, by method. */
  storeCalls: string[];
};

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

/** What the own-saves run saw: the game's Save, its own server, and an undeclared origin. */
export type OwnSavesProbe = {
  note: string;
  /** Writes the game's declared save server received. */
  written: number;
  /** The declared server holds a save file for the game after Save. */
  stored: boolean;
  /** A fetch from the frame to the declared origin answered. */
  declaredReached: boolean;
  /** A fetch from the frame to an undeclared origin rejected. */
  undeclaredBlocked: boolean;
  /** Requests the undeclared server received: none may arrive. */
  undeclaredReceived: number;
  /** The frame reported a `connect-src` violation for the undeclared origin; recorded, not judged. */
  undeclaredViolation: boolean;
};

/** The own-saves run's reasons, from its probe and what the host heard. */
export function judgeOwnSaves(p: OwnSavesProbe | undefined, host: HostProbe): string[] {
  if (!p) return ["the own-saves run didn't finish"];
  const reasons: string[] = [];
  if (p.note !== SAVED_NOTE) reasons.push(`Save said "${p.note}", not "${SAVED_NOTE}"`);
  if (p.written < 1) reasons.push("the game's own save server received no save");
  else if (!p.stored) reasons.push("the game's own save server holds no save file for it");
  if (!p.declaredReached) reasons.push("a fetch from the frame to its declared origin failed");
  if (host.frameSaves.length > 0)
    reasons.push(`the frame sent the host ${[...new Set(host.frameSaves)].join(", ")}`);
  if (host.storeCalls.length > 0)
    reasons.push(`the host's save store was called: ${[...new Set(host.storeCalls)].join(", ")}`);
  if (!p.undeclaredBlocked) reasons.push("a fetch to an undeclared origin went through");
  if (p.undeclaredReceived > 0)
    reasons.push(`an undeclared origin received ${p.undeclaredReceived} request(s) from the frame`);
  return reasons;
}

/** What the claim run saw: the signed-out save, the claim on sign-in, and the read-back elsewhere. */
export type ClaimProbe = {
  /** The signed-out Save's note. */
  note: string;
  /** Records in the host origin's IndexedDB before signing in. */
  localBefore: number;
  /** The host page saw the session after signing in. */
  signedIn: boolean;
  rows: { slot: string; ticked: boolean; collides: boolean }[];
  results: ClaimResult[];
  /** Records left in this browser's IndexedDB after the claim. */
  localAfter: number;
  /** The account's saves in the site's database after the claim. */
  accountSaves: number;
  /** The second browser context, with the same session and its own empty storage. */
  second: {
    signedIn: boolean;
    localRecords: number;
    menuNote: string | null;
    continued: string | null;
  } | null;
};

export function judgeClaim(p: ClaimProbe | undefined): string[] {
  if (!p) return ["the claim run didn't finish"];
  const reasons: string[] = [];
  if (p.note !== SAVED_NOTE)
    reasons.push(`the signed-out Save said "${p.note}", not "${SAVED_NOTE}"`);
  if (p.localBefore < 1) reasons.push("this browser held no save before signing in");
  if (!p.signedIn) reasons.push("the host page didn't see the session after signing in");
  if (!p.rows.some((r) => r.ticked)) reasons.push("the claim offered no save ticked");
  if (p.results.length === 0) reasons.push("nothing was claimed");
  for (const r of p.results)
    if (!r.ok) reasons.push(`claiming ${r.slot} was refused: ${r.message}`);
  if (p.localAfter !== 0)
    reasons.push(`this browser still holds ${p.localAfter} save record(s) after the claim`);
  if (p.accountSaves < 1) reasons.push("the account holds no save after the claim");
  if (!p.second) reasons.push("the second browser context didn't run");
  else {
    if (!p.second.signedIn) reasons.push("the second context's host page saw no session");
    if (p.second.localRecords !== 0)
      reasons.push("the second context's IndexedDB holds a save, so it didn't read the account's");
    if (p.second.menuNote !== SIGNED_IN_SAVES_DESCRIBE)
      reasons.push(
        `the second context's save note is ${JSON.stringify(p.second.menuNote)}, not the signed-in note`,
      );
    if (p.second.continued !== SAVED_BANNER)
      reasons.push(
        `the second context's Continue landed on ${JSON.stringify(p.second.continued)}, not "${SAVED_BANNER}"`,
      );
  }
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
  own?: OwnSavesProbe;
  claim?: ClaimProbe;
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
  if (kind === "own-saves") reasons.push(...judgeOwnSaves(o.own, o.host));
  if (kind === "claim") reasons.push(...judgeClaim(o.claim));
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
  own?: OwnSavesProbe;
  claim?: ClaimProbe;
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
    ...(o.own ? { own: o.own } : {}),
    ...(o.claim ? { claim: o.claim } : {}),
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

const SMOKE_DIR = join(REPO, "scripts/engine-smoke");

/**
 * A fixture project built as `game build --target web` builds, from its own
 * directory: the scene CLI finds projects under `src/` and `packages/` only.
 */
async function buildFixture(
  dir: string,
  out: string,
): Promise<{ release: string | null; reason?: string }> {
  const [{ buildGame: build }, { discoverProjects }, { PROJECT_FILE }, { loadCompatRapier }] =
    await Promise.all([
      import("../scene/tools/game-build"),
      import("../scene/projects"),
      import("@jams/engine/project"),
      import("../scene/rapier-compat"),
    ]);
  const projects = await discoverProjects(dir, [PROJECT_FILE], {
    cacheDirOf: (id) => `${out}.cache-${id}`,
  });
  const [project] = projects;
  if (!project) return { release: null, reason: `no ${PROJECT_FILE} in ${dir}` };
  const { result, built } = await withTimeout(
    build(
      { id: project.file.id, target: "web", out, allowOverBudget: false },
      { projects, loadRapier: loadCompatRapier },
    ),
    BUILD_TIMEOUT_MS,
    `building ${project.file.id}`,
  );
  if (result.exitCode !== 0 || !built) return { release: null, reason: result.text };
  return { release: built.release };
}

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
      alias: [...engineSourceAlias, { find: /^@\//, replacement: `${join(REPO, "src")}/` }],
    },
    build: {
      outDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 8192,
      // The page awaits who is signed in at its top level.
      target: "es2022",
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
  /** The play page's origin: its files, the save API and the session. */
  host: HostSiteServer;
  /** Where the host page asks who is signed in. */
  sessionPath: string;
  /** A third origin, for the embed run's outer page. */
  embedder: StaticServer;
  hostFiles: ReadonlySet<string>;
  frames: HandlerServer;
  releases: ReadonlyMap<PlayGame, Hosted>;
  /** The own-saves game's declared save server, and an origin it never declared. */
  stubs: { declared: SaveStubServer; undeclared: SaveStubServer };
  player: SmokePlayer;
  sessionCookie: string;
  /** The player's saves in the site's database. */
  accountSaves(): Promise<number>;
};

/** Where each game saves, as its project's settings say; the rest save to the site. */
const SAVE_MODES: Partial<Record<PlayGame, SaveMode>> = { "own-saves": "own" };

/** The host page framing `hosted`, as the play page would, with the project's save mode. */
function hostPageUrl(stage: Stage, hosted: Hosted, game: PlayGame): string {
  const frame = new URL(`${hosted.dir}${FRAME_ENTRY}`);
  if (game === "own-saves") frame.searchParams.set(SAVE_SERVER_PARAM, stage.stubs.declared.origin);
  const q = new URLSearchParams({
    frame: frame.href,
    release: hosted.release.releaseId,
    game: hosted.release.gameId,
    project: hosted.release.projectId,
    sandbox: FRAME_SANDBOX,
    allow: FRAME_ALLOW,
    mode: SAVE_MODES[game] ?? "site",
    session: stage.sessionPath,
  });
  return `${stage.host.url}${HOST_PAGE_FILE}?${q}`;
}

/** Another site's page framing the host page, as a site embedding the game frames the embed page. */
const embedderUrl = (stage: Stage, hosted: Hosted, game: PlayGame): string =>
  `${stage.embedder.url}${EMBEDDER_FILE}?${new URLSearchParams({ src: hostPageUrl(stage, hosted, game) })}`;

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

/** How long one run may take: the claim run boots the game three times, in two contexts. */
export const runTimeoutMs = (kind: PlayRunKind): number =>
  kind === "claim" ? 2 * RUN_TIMEOUT_MS : RUN_TIMEOUT_MS;

/** How long the host page may take to hear a state the frame already shows: the port's delivery is async. */
const HOST_HEARS_MS = 10_000;

/** What the host page heard, once it has heard `ready` or `HOST_HEARS_MS` has passed. */
async function hostProbe(host: Frame): Promise<HostProbe> {
  await host
    .waitForFunction(
      () =>
        (window as unknown as { __playHost?: HostProbe }).__playHost?.states.includes("ready") ===
        true,
      null,
      { timeout: HOST_HEARS_MS },
    )
    .catch(() => {});
  return readHostProbe(host);
}

type HostRecord = {
  states: string[];
  issues: string[];
  dropped: number;
  frameMessages: string[];
  storeCalls: string[];
};

const readHostProbe = (host: Frame): Promise<HostProbe> =>
  host.evaluate(() => {
    const r = (window as unknown as { __playHost?: HostRecord }).__playHost;
    return r
      ? {
          states: [...r.states],
          issues: [...r.issues],
          dropped: r.dropped,
          frameSaves: r.frameMessages.filter((type) => type.startsWith("saves.")),
          storeCalls: [...r.storeCalls],
        }
      : { states: [], issues: [], dropped: 0, frameSaves: [], storeCalls: [] };
  });

/** Who the host page saw signed in, and the claim it made on load. */
const hostSession = (host: Frame) =>
  host.evaluate(() => {
    const r = (
      window as unknown as {
        __playHost?: {
          user: { id: string } | null;
          claim: Pick<ClaimProbe, "rows" | "results"> | null;
        };
      }
    ).__playHost;
    return { signedIn: r?.user != null, claim: r?.claim ?? null };
  });

/**
 * WebKit reports the sandbox refusing the frame's top navigation (the
 * sandbox probe's own attempt) as a page error even though the frame catches it.
 */
const SANDBOX_REFUSED_TOP_NAVIGATION =
  /The frame attempting navigation of the top-level window is sandboxed/;

const hostPageErrors = (page: Page) =>
  pageErrors(page, { ignore: SANDBOX_REFUSED_TOP_NAVIGATION, what: "host page" });

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

/** The note a Save button's `[data-save="note"]` settles on: "Saved" or "Not saved: …". */
const saveNote = (frame: Frame, scope: string): Promise<string> =>
  frame
    .waitForFunction(
      (selector) => {
        const text = document.querySelector(selector)?.textContent ?? "";
        return text === "Saved" || text.startsWith("Not saved") ? text : null;
      },
      `${scope} [data-save="note"]`.trim(),
      { timeout: PAGE_TIMEOUT_MS },
    )
    .then((h) => h.jsonValue() as Promise<string>);

/** Start, End turn, Save on turn 2; the save note. */
async function saveOnTurnTwo(frame: Frame): Promise<string> {
  await frame.getByRole("button", { name: "Start", exact: true }).click();
  await bannerIs(frame, "Turn 1 · Your orders");
  await frame.locator('button[data-order="end-turn"][aria-disabled="false"]').first().click();
  await bannerIs(frame, SAVED_BANNER);
  await frame.locator('.tactics-hud button[data-action="save"][aria-disabled="false"]').click();
  return saveNote(frame, ".tactics-hud");
}

/** The reloaded menu's save note once it offers Continue, and the banner Continue lands on. */
async function continueFromMenu(
  frame: Frame,
): Promise<{ menuNote: string | null; continued: string | null }> {
  const resume = frame.locator(
    '.tactics-menu button[data-action="continue"][aria-disabled="false"]',
  );
  await resume.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const menuNote = await frame
    .locator(".tactics-menu-note")
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => null);
  await resume.click();
  await bannerIs(frame, SAVED_BANNER).catch(() => {});
  return { menuNote, continued: await bannerText(frame) };
}

/** Start, End turn, Save on turn 2; reload the host page; Continue. */
async function saveAndContinue(page: Page, first: Frame): Promise<SavesProbe> {
  const note = await saveOnTurnTwo(first);
  const hostRecords = await hostSaveRecords(page);
  const probe: SavesProbe = { note, hostRecords, menuNote: null, continued: null };
  if (note !== SAVED_NOTE) return probe;

  await page.reload();
  const frame = await attachedFrame(page.mainFrame());
  await waitReady(frame, "frame");
  return { ...probe, ...(await continueFromMenu(frame)) };
}

/**
 * The own-saves game's Save, then fetches from inside the frame to its
 * declared origin and to one it never declared.
 */
async function saveToOwnServer(frame: Frame, stage: Stage): Promise<OwnSavesProbe> {
  const { declared, undeclared } = stage.stubs;
  await frame.locator('button[data-action="save"]').click();
  const note = await saveNote(frame, "");
  const token = randomBytes(8).toString("hex");
  const reach = (url: string) =>
    frame.evaluate(
      (u) =>
        fetch(u, { cache: "no-store" }).then(
          (r) => r.ok,
          () => false,
        ),
      `${url}${url.includes("?") ? "&" : "?"}${PROBE_PARAM}=${token}`,
    );
  const declaredReached = await reach(`${declared.origin}/saves/probe`);
  const undeclaredReached = await reach(`${undeclared.origin}/saves/probe`);
  const violations = await violationsIn(frame);
  const prefix = `/saves/${encodeURIComponent(stage.releases.get("own-saves")?.release.gameId ?? "")}/`;
  const stored = [...declared.saves].some(([key, text]) => {
    if (!`/saves/${key}`.startsWith(prefix)) return false;
    try {
      return (JSON.parse(text) as { kind?: unknown }).kind === "save";
    } catch {
      return false;
    }
  });
  return {
    note,
    written: declared.received.filter((r) => r.method === "POST" && r.path.startsWith(prefix))
      .length,
    stored,
    declaredReached,
    undeclaredBlocked: !undeclaredReached,
    undeclaredReceived: undeclared.received.length,
    undeclaredViolation: violations.some(
      (v) => v.directive === "connect-src" && v.blocked.startsWith(undeclared.origin),
    ),
  };
}

/** Signs `context` in as the smoke's player, as the site's session cookie would. */
const signIn = (context: BrowserContext, stage: Stage) =>
  context.addCookies([
    {
      name: stage.sessionCookie,
      value: stage.player.token,
      url: stage.host.origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

/**
 * Signed out, Save on turn 2 into this browser; sign in and reload, so the
 * host page claims the save to the account; then a second context with the
 * same session and nothing in its storage Continues from the account's save.
 * Hands back the probe and what the host page the run is judged by heard:
 * the second context's, once it has Continued.
 */
async function claimAndReadBack(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  first: Frame,
  stage: Stage,
  url: string,
  watch: (context: BrowserContext) => void,
): Promise<{ claim: ClaimProbe; host: HostProbe }> {
  const note = await saveOnTurnTwo(first);
  const probe: ClaimProbe = {
    note,
    localBefore: await hostSaveRecords(page),
    signedIn: false,
    rows: [],
    results: [],
    localAfter: 0,
    accountSaves: 0,
    second: null,
  };
  if (note !== SAVED_NOTE) return { claim: probe, host: await hostProbe(page.mainFrame()) };

  await signIn(context, stage);
  await page.reload();
  await waitReady(await attachedFrame(page.mainFrame()), "frame");
  const seen = await hostSession(page.mainFrame());
  probe.signedIn = seen.signedIn;
  probe.rows = seen.claim?.rows ?? [];
  probe.results = seen.claim?.results ?? [];
  probe.localAfter = await hostSaveRecords(page);
  probe.accountSaves = await stage.accountSaves();

  const other = await browser.newContext();
  watch(other);
  try {
    await signIn(other, stage);
    const second = await other.newPage();
    second.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const errors = hostPageErrors(second);
    const read = async () => {
      const frame = await openHosted(second, url);
      await waitReady(frame, "frame");
      const back = await continueFromMenu(frame);
      return {
        signedIn: (await hostSession(second.mainFrame())).signedIn,
        localRecords: await hostSaveRecords(second),
        ...back,
      };
    };
    probe.second = await Promise.race([read(), errors]);
    return { claim: probe, host: await hostProbe(second.mainFrame()) };
  } finally {
    await closeWithin(other.close(), "the second context");
  }
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
  const ownSaves = planned.kind === "own-saves";
  const claiming = planned.kind === "claim";
  const scope: PlayScope = {
    release: hosted.dir,
    hostOrigin: stage.host.origin,
    hostFiles: stage.hostFiles,
    hostPaths: claiming ? [stage.sessionPath, ENGINE_SAVES_PATH] : [stage.sessionPath],
    ...(embedded ? { embedder: `${stage.embedder.url}${EMBEDDER_FILE}` } : {}),
    ...(ownSaves ? { connect: [stage.stubs.declared.origin] } : {}),
  };
  // The own-saves game's server has a throwaway self-signed certificate.
  const context = await browser.newContext(ownSaves ? { ignoreHTTPSErrors: true } : {});
  const requests: string[] = [];
  const failed: string[] = [];
  const watch = (watched: BrowserContext) => {
    watched.on("request", (r) => requests.push(r.url()));
    watched.on("requestfailed", (r) =>
      failed.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`),
    );
    watched.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.url()} (${r.status()})`);
    });
  };
  watch(context);
  try {
    await recordViolations(context);
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const errors = hostPageErrors(page);
    const work = async (): Promise<PlayObservation> => {
      const url = hostPageUrl(stage, hosted, planned.game);
      const { host, frame } = embedded
        ? await openEmbedded(page, embedderUrl(stage, hosted, planned.game))
        : { host: page.mainFrame(), frame: await openHosted(page, url) };
      await waitReady(frame, "frame");
      const violations = await violationsIn(frame);
      const render = await renderState(frame);
      const colours = planned.kind === "play" || embedded ? await canvasColours(frame) : null;
      const saves = planned.kind === "saves" ? await saveAndContinue(page, frame) : undefined;
      const sandbox =
        planned.kind === "sandbox"
          ? await probeSandbox(context, page, frame, stage, hosted, other)
          : undefined;
      const own = ownSaves ? await saveToOwnServer(frame, stage) : undefined;
      const claimed = claiming
        ? await claimAndReadBack(browser, context, page, frame, stage, url, watch)
        : undefined;
      return {
        requests,
        scope,
        violations,
        host: claimed?.host ?? (await hostProbe(host)),
        render,
        colours,
        ...(saves ? { saves } : {}),
        ...(sandbox ? { sandbox } : {}),
        ...(own ? { own } : {}),
        ...(claimed ? { claim: claimed.claim } : {}),
      };
    };
    const observed = await withTimeout(
      Promise.race([work(), errors]),
      runTimeoutMs(planned.kind),
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
    await closeWithin(context.close(), `${planned.browser}'s context`);
  }
}

// ─── One browser's process ───────────────────────────────

/** What one browser's process hands back: the releases its site recorded, and its runs. */
export type PlayBrowserReport = {
  browser: BrowserName;
  published: Partial<Record<PlayGame, PublishedRelease>>;
  runs: PlayRunOutcome[];
  error?: string;
};

/**
 * Every planned run of `browser`, from its report: a run the report lacks
 * fails with the report's error, or `ended` when it has none.
 */
export function browserRuns(
  planned: readonly PlannedPlayRun[],
  report: Pick<PlayBrowserReport, "runs" | "error"> | null,
  ended: string,
): PlayRunOutcome[] {
  return planned.map(
    (p) =>
      report?.runs.find(
        (r) => r.game === p.game && r.kind === p.kind && r.browser === p.browser,
      ) ?? {
        ...p,
        status: "fail",
        reason: report?.error ?? ended,
      },
  );
}

/** The builds once each browser's site recorded them: a release that doesn't match its build fails it. */
export function publishedBuilds(
  builds: readonly PlayBuildOutcome[],
  reports: readonly Pick<PlayBrowserReport, "browser" | "published">[],
): PlayBuildOutcome[] {
  return builds.map((build) => {
    let outcome = { ...build };
    for (const report of reports) {
      const release = report.published[build.game];
      if (!release) continue;
      outcome.published ??= release;
      const mismatch = judgePublished(build.built, release);
      if (mismatch && outcome.ok)
        outcome = { ...outcome, ok: false, reason: `${report.browser}: ${mismatch}` };
    }
    return outcome;
  });
}

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
  "VITE_POSTHOG_KEY",
  "VITE_PUBLIC_POSTHOG_KEY",
];

/** Runs `cleanup` and exits on SIGINT or SIGTERM. */
function stopOnSignals(cleanup: () => Promise<void>): void {
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.once(signal, () => {
      console.error(`\n${signal}: stopping`);
      void cleanup().finally(() => process.exit(code));
    });
  }
}

const errorText = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

/**
 * One browser's runs against the builds in `buildsDir`: its own PGlite site
 * publishes them, its own servers frame them, and it writes its
 * `PlayBrowserReport` to `reportFile`.
 */
async function runBrowser(
  name: BrowserName,
  buildsDir: string,
  reportFile: string,
  ci: boolean,
): Promise<number> {
  const site = await import("./play-adapter");
  const playwright = await import("playwright");
  const types: Record<BrowserName, BrowserType> = {
    chromium: playwright.chromium,
    firefox: playwright.firefox,
    webkit: playwright.webkit,
  };

  const tmp = mkdtempSync(join(tmpdir(), `jams-engine-play-smoke-${name}-`));
  const servers: { close(): Promise<void> }[] = [];
  let browser: Browser | undefined;
  let smokeSite: SmokeSite | undefined;
  const cleanup = async () => {
    if (browser) await closeWithin(browser.close(), name);
    browser = undefined;
    await Promise.allSettled(servers.splice(0).map((s) => s.close()));
    await smokeSite?.db.$client.close().catch(() => {});
    smokeSite = undefined;
    rmSync(tmp, { recursive: true, force: true });
  };
  stopOnSignals(cleanup);

  const mine = plannedPlayRuns([name]);
  const report: PlayBrowserReport = { browser: name, published: {}, runs: [] };
  try {
    smokeSite = await site.createSmokeSite();
    const declared = await site.serveSaveStub();
    servers.push(declared);
    const undeclared = await site.serveSaveStub();
    servers.push(undeclared);
    const settings: Partial<Record<PlayGame, SmokeProjectSettings>> = {
      "own-saves": { saveMode: "own", connectOrigins: [declared.origin] },
    };
    const releases = new Map<PlayGame, PublishedRelease>();
    for (const game of PLAY_GAMES) {
      let release: PublishedRelease;
      try {
        release = await site.publishBuild(smokeSite, join(buildsDir, game), settings[game]);
      } catch (err) {
        throw new Error(`${game}: the upload was refused: ${refusal(err)}`);
      }
      releases.set(game, release);
      report.published[game] = release;
    }

    const player = await site.createSmokePlayer(smokeSite);
    const hostDir = join(tmp, "host");
    const hostFiles = await buildHostPage(hostDir);
    const host = await site.serveHostSite(smokeSite, hostDir);
    servers.push(host);
    const frames = await site.serveFrames(smokeSite, host.origin);
    servers.push(frames);
    const embedderDir = join(tmp, "embedder");
    mkdirSync(embedderDir);
    writeFileSync(join(embedderDir, EMBEDDER_FILE), EMBEDDER_HTML);
    const embedder = await serveStatic({ dir: embedderDir });
    servers.push(embedder);
    const hosted = new Map<PlayGame, Hosted>();
    for (const [game, release] of releases)
      hosted.set(game, { release, dir: site.releaseDir(frames, release.releaseId) });
    const ownSite = smokeSite;
    const stage: Stage = {
      host,
      sessionPath: site.SMOKE_SESSION_PATH,
      embedder,
      hostFiles,
      frames,
      releases: hosted,
      stubs: { declared, undeclared },
      player,
      sessionCookie: site.SMOKE_SESSION_COOKIE,
      accountSaves: () => site.accountSaveCount(ownSite, player.userId),
    };

    try {
      browser = await types[name].launch({ headless: true });
    } catch (err) {
      report.runs.push(
        ...playLaunchFailures(mine, err instanceof Error ? err.message : String(err), ci),
      );
      console.log(`${name}: ${report.runs.at(-1)?.status} — ${report.runs.at(-1)?.reason}`);
    }
    if (browser)
      for (const p of mine) {
        const outcome = await runOne(browser, p, stage);
        report.runs.push(outcome);
        const detail = outcome.status === "pass" ? `${outcome.ms} ms` : outcome.reason;
        console.log(`${name} ${p.kind} ${p.game}: ${outcome.status} — ${detail}`);
      }
  } catch (err) {
    report.error = errorText(err);
  } finally {
    await cleanup();
  }
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return report.error === undefined ? 0 : 1;
}

// ─── The runner ──────────────────────────────────────────

const SELF = fileURLToPath(import.meta.url);

/** The flag that makes this script one browser's process, naming the directory of the builds. */
const BUILDS_FLAG = "builds";

/**
 * How long one browser's process may run before it is stopped: its site and
 * host page, every run's own limit, and closing. Each run is already bounded;
 * this catches a process that hangs outside them.
 */
export const BROWSER_PROCESS_MS =
  3 * 60_000 + PLAY_RUNS.reduce((ms, run) => ms + runTimeoutMs(run.kind) + 2 * CLOSE_MS, 0);
/** How long a stopped process gets to clean up before it is killed. */
const KILL_GRACE_MS = 20_000;

/**
 * Runs `name` in its own process and reads back its report, or null when the
 * process left none; why it ended is the second value.
 */
function inOwnProcess(
  name: BrowserName,
  buildsDir: string,
  running: Set<ChildProcess>,
): Promise<[PlayBrowserReport | null, string]> {
  const reportFile = join(buildsDir, `${name}.report.json`);
  const args = [SELF, "--browsers", name, `--${BUILDS_FLAG}`, buildsDir, "--out", reportFile];
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: "inherit" });
    running.add(child);
    let timedOut = false;
    let kill: ReturnType<typeof setTimeout> | undefined;
    const stop = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      kill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, BROWSER_PROCESS_MS);
    let settled = false;
    const finish = (ended: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(stop);
      clearTimeout(kill);
      running.delete(child);
      let report: PlayBrowserReport | null = null;
      try {
        report = JSON.parse(readFileSync(reportFile, "utf8")) as PlayBrowserReport;
      } catch {
        // The process ended before it wrote one.
      }
      done([
        report,
        timedOut ? `${name}'s process timed out after ${BROWSER_PROCESS_MS / 1000} s` : ended,
      ]);
    };
    child.once("error", (err) => finish(`${name}'s process didn't start: ${err.message}`));
    child.once("exit", (code, signal) =>
      finish(`${name}'s process ended (${signal ?? `exit ${code}`}) before its runs finished`),
    );
  });
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      browsers: { type: "string" },
      out: { type: "string" },
      [BUILDS_FLAG]: { type: "string" },
    },
  });
  const browsers = parseBrowsers(values.browsers);
  const reportFile = values.out ? resolve(values.out) : join(REPO, "engine-play-smoke.json");
  const ci = process.env.CI === "true";
  for (const name of SHARED_SERVICE_ENV) delete process.env[name];
  // The tests' database helper reads the migrations and caches its snapshot under the repo.
  process.chdir(REPO);

  const buildsDir = values[BUILDS_FLAG];
  if (buildsDir !== undefined) {
    const [only] = browsers;
    if (!only || browsers.length !== 1) throw new Error(`--${BUILDS_FLAG} runs one browser`);
    return runBrowser(only, resolve(buildsDir), reportFile, ci);
  }

  const tmp = mkdtempSync(join(tmpdir(), "jams-engine-play-smoke-"));
  const running = new Set<ChildProcess>();
  const cleanup = async () => {
    for (const child of running) child.kill("SIGTERM");
    running.clear();
    rmSync(tmp, { recursive: true, force: true });
  };
  stopOnSignals(cleanup);

  const planned = plannedPlayRuns(browsers);
  let builds: PlayBuildOutcome[] = [];
  const runs: PlayRunOutcome[] = [];
  const errors: string[] = [];
  try {
    for (const game of PLAY_GAMES) {
      const started = performance.now();
      const fixture = PLAY_FIXTURES[game];
      const built = fixture
        ? await buildFixture(join(SMOKE_DIR, fixture), join(tmp, game))
        : buildOne({ game, target: "web" }, join(tmp, game));
      const outcome: PlayBuildOutcome = {
        game,
        ok: !built.reason,
        ...(built.reason ? { reason: built.reason } : {}),
        built: built.release,
        published: null,
        ms: Math.round(performance.now() - started),
      };
      builds.push(outcome);
      if (!outcome.ok) throw new Error(`${game}: ${outcome.reason}`);
      console.log(`${game}: built (release ${outcome.built})`);
    }

    // Each browser gets its own process, site and servers, so nothing one
    // browser leaves behind reaches the next: on macOS, WebKit timed out
    // after Firefox when both ran in one process.
    const reports: PlayBrowserReport[] = [];
    for (const name of browsers) {
      const [report, ended] = await inOwnProcess(name, tmp, running);
      if (report) reports.push(report);
      if (report?.error !== undefined) errors.push(`${name}: ${report.error}`);
      else if (!report) errors.push(ended);
      runs.push(
        ...browserRuns(
          planned.filter((p) => p.browser === name),
          report,
          ended,
        ),
      );
    }
    builds = publishedBuilds(builds, reports);
    for (const build of builds)
      if (build.published)
        console.log(
          `${build.game}: published as v${build.published.version} (release ${build.published.releaseId}, ${build.published.uploaded} files uploaded)`,
        );
  } catch (err) {
    errors.push(errorText(err));
  } finally {
    await cleanup();
  }

  const error = errors.length ? errors.join("\n") : undefined;
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

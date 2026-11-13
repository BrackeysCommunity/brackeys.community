/**
 * The export smoke: builds the platformer (`web`) and tactics (`web` and
 * `itch`) with `game build`, checks each build's bundle report with
 * `engine-bundle-check --export`, serves each output from a plain static
 * server (`static-server.ts`) and plays it in each browser:
 *
 * - every run waits for `data-jams-state="ready"`, records every request and
 *   fails on any URL outside the server's origin (or, under a nested mount,
 *   outside its directory), and fails a page that scrolls or a canvas that
 *   doesn't fill the window;
 * - tactics: Start on the menu, then a unit and a reachable cell through the
 *   HUD's `data-cell` elements, until the HUD's card shows the unit moved;
 * - the platformer: `ArrowRight` held for a second changes the canvas's
 *   pixel hash;
 * - tactics `itch` also plays under `/games/t/`, and no `itch` run registers
 *   a service worker;
 * - tactics `web` also plays framed by `host-stub.html` (another origin)
 *   with `?host=jams`: the stub must see one handshake, a `hello` naming
 *   the build's release, `state` going to "ready", and no service worker
 *   may register in the frame;
 * - the platformer `web` also plays framed by the stub with a live swap: a
 *   version of its start scene, built by `buildSceneVersion` from the
 *   fixture edit in `fixtures/live/` and served under the build's `live/`,
 *   goes to the frame in a `live.update` with timing `now`; the frame must
 *   fetch it from its own directory and report it `applied` at `now`, then
 *   offer its run's recording through `download` when the stub asks, and
 *   that recording must replay headless (`replay --versions`) to the same
 *   end;
 * - Chromium only: each PWA build plays again offline once its service
 *   worker is activated, and the platformer, with `?renderer=webgl`, loses
 *   and gets back its WebGL context (as the host mirrors it on the root
 *   element's `data-jams-render`), then draws and plays again. Whether
 *   Pixi restored the context in place or the engine rebuilt the renderer
 *   is recorded as `pixiRestoredInPlace`.
 *
 *   vp run engine:smoke:export [--browsers chromium,firefox,webkit] [--out <file>]
 *
 * Writes `engine-export-smoke.json` at the repo root, or to `--out`. A
 * browser Playwright hasn't installed is skipped locally and fails under
 * `CI=true`.
 */
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";

import { LIVE_DEFAULTS, type SwapTiming } from "@jams/engine/game";
import {
  liveFiles,
  type ReleaseManifest,
  type SceneVersion,
  type Sha256,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";
import type { LiveSnapshot, LiveStateMessage } from "@jams/engine/standalone";
import type { Browser, BrowserContext, BrowserType, Frame, Locator, Page } from "playwright";

import { SCENE_VERSION_FILE } from "../scene/tools/replay";
import {
  installCommand,
  isMissingBrowser,
  PAGE_TIMEOUT_MS,
  parseBrowsers,
  withTimeout,
  type BrowserName,
} from "./browser-compare";
import { describeFailure, REPO } from "./pack";
import { buildOne, pageErrors, waitReady } from "./smoke-page";
import { serveStatic, type StaticServer } from "./static-server";

// ─── What runs ───────────────────────────────────────────

export type SmokeGame = "platformer" | "tactics";

export type SmokeBuild = {
  game: SmokeGame;
  target: "web" | "itch";
  /** Where the build is served; each mount is played in every browser. */
  mounts: readonly string[];
  /** The target ships a service worker, so Chromium also plays it offline. */
  pwa: boolean;
};

export const SMOKE_BUILDS: readonly SmokeBuild[] = [
  { game: "platformer", target: "web", mounts: ["/"], pwa: true },
  { game: "tactics", target: "web", mounts: ["/"], pwa: true },
  { game: "tactics", target: "itch", mounts: ["/", "/games/t/"], pwa: false },
];

export const buildName = (b: Pick<SmokeBuild, "game" | "target">) => `${b.game}-${b.target}`;

/** The build the context-loss run plays: the platformer moves, so its canvas shows drawing resumed. */
export const CONTEXT_LOSS_BUILD = "platformer-web";
/** How long the platformer holds `ArrowRight`. */
export const HOLD_MS = 1000;
/** How long the context stays lost before `restoreContext()`: inside the engine's 3 s restore window. */
export const RESTORE_AFTER_MS = 500;
/** How long `data-jams-render` may take to leave "lost" once the context is restored (or the renderer rebuilt). */
export const RESTORE_TIMEOUT_MS = 15_000;
/** One whole run in one browser: load, play, and for offline a second load. */
export const RUN_TIMEOUT_MS = 3 * PAGE_TIMEOUT_MS;
export const BUNDLE_CHECK_TIMEOUT_MS = 2 * 60_000;
/** How long closing a context or browser may take: WebKit can hang closing one, and the run's result is already in hand. */
export const CLOSE_MS = 15_000;

/** Waits up to `CLOSE_MS` for `closing`, logging a refusal or a timeout rather than throwing. */
export async function closeWithin(closing: Promise<void>, what: string): Promise<void> {
  await withTimeout(closing, CLOSE_MS, `closing ${what}`).catch((err) =>
    console.error(err instanceof Error ? err.message : String(err)),
  );
}

export type RunKind = "play" | "offline" | "context-loss" | "host" | "live";

export type PlannedRun = { build: string; mount: string; browser: BrowserName; kind: RunKind };

/** Every run the smoke makes, in order: per browser, each build's mounts, then Chromium's extra runs. */
export function plannedRuns(
  builds: readonly SmokeBuild[],
  browsers: readonly BrowserName[],
): PlannedRun[] {
  return browsers.flatMap((browser) => {
    const runs: PlannedRun[] = builds.flatMap((b) =>
      b.mounts.map((mount) => ({ build: buildName(b), mount, browser, kind: "play" as const })),
    );
    if (browser !== "chromium") return runs;
    for (const b of builds)
      if (b.pwa) runs.push({ build: buildName(b), mount: "/", browser, kind: "offline" });
    if (builds.some((b) => buildName(b) === CONTEXT_LOSS_BUILD))
      runs.push({ build: CONTEXT_LOSS_BUILD, mount: "/", browser, kind: "context-loss" });
    return runs;
  });
}

/** The build the host run frames: it has a PWA, so the run shows a host keeps its worker off. */
export const HOST_BUILD = "tactics-web";
/** The stub page that frames a build with `?host=jams`, served from its own origin. */
export const HOST_STUB_FILE = "host-stub.html";

/** The host runs: `HOST_BUILD` framed by the stub, once in every browser. */
export function hostRuns(
  builds: readonly SmokeBuild[],
  browsers: readonly BrowserName[],
): PlannedRun[] {
  if (!builds.some((b) => buildName(b) === HOST_BUILD)) return [];
  return browsers.map((browser) => ({ build: HOST_BUILD, mount: "/", browser, kind: "host" }));
}

/** The build the live run frames: the platformer takes a version `now`, so the swap lands mid-run. */
export const LIVE_BUILD = "platformer-web";
/** The edit the live run's version makes to the release's start scene: a scene CLI op batch. */
export const LIVE_EDIT_FILE = join(REPO, "scripts/engine-smoke/fixtures/live/move-cheese.json");
/** The timing the stub's pointer asks for. */
export const LIVE_TIMING: SwapTiming = "now";
/** How long the frame may take to report the version applied: its own preparation deadline, and a beat for the report to cross. */
export const LIVE_APPLY_TIMEOUT_MS = LIVE_DEFAULTS.preloadTimeoutMs + 10_000;
/** How long the frame may take to offer its recording once asked. */
export const RECORDING_TIMEOUT_MS = 10_000;
/** How long the headless replay of the frame's recording may take. */
export const REPLAY_TIMEOUT_MS = 2 * 60_000;
/** One whole live run: load and play, the swap, the recording and its replay. */
export const LIVE_RUN_TIMEOUT_MS =
  RUN_TIMEOUT_MS + LIVE_APPLY_TIMEOUT_MS + RECORDING_TIMEOUT_MS + REPLAY_TIMEOUT_MS;
/** The page event asking the frame for its run's recording, which comes back as a `download`. */
export const RECORDING_REQUEST = { type: "recording.request" } as const;

/** The live runs: `LIVE_BUILD` framed by the stub with a live swap, once in every browser. */
export function liveRuns(
  builds: readonly SmokeBuild[],
  browsers: readonly BrowserName[],
): PlannedRun[] {
  if (!builds.some((b) => buildName(b) === LIVE_BUILD)) return [];
  return browsers.map((browser) => ({ build: LIVE_BUILD, mount: "/", browser, kind: "live" }));
}

/** Every run: each browser's plays, then its host run, then its live run. */
export function allRuns(
  builds: readonly SmokeBuild[],
  browsers: readonly BrowserName[],
): PlannedRun[] {
  return browsers.flatMap((b) => [
    ...plannedRuns(builds, [b]),
    ...hostRuns(builds, [b]),
    ...liveRuns(builds, [b]),
  ]);
}

/** How long a run of `kind` may take. */
export const runTimeoutMs = (kind: RunKind): number =>
  kind === "live" ? LIVE_RUN_TIMEOUT_MS : RUN_TIMEOUT_MS;

// ─── Requests ────────────────────────────────────────────

/** Browsers may ask for this on their own; it is never the page's request. */
const FAVICON = "/favicon.ico";

export type RequestScope = "page" | "local" | "outside-mount" | "off-origin";

/**
 * Where a request went: under the mount (`page`), nowhere on the network
 * (`data:`, `about:`, or a `blob:` of the page's own origin: `local`),
 * elsewhere on the server (`outside-mount`), or anywhere else (`off-origin`).
 */
export function requestScope(url: string, origin: string, mount: string): RequestScope {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "off-origin";
  }
  if (parsed.protocol === "data:" || parsed.protocol === "about:") return "local";
  if (parsed.protocol === "blob:") return parsed.origin === origin ? "local" : "off-origin";
  if (parsed.origin !== origin) return "off-origin";
  if (parsed.pathname.startsWith(mount)) return "page";
  return parsed.pathname === FAVICON ? "local" : "outside-mount";
}

export type RequestCheck = { offOrigin: string[]; outsideMount: string[] };

/** The requests outside the server's origin and outside the mount, each URL once in first-seen order. */
export function checkRequests(
  urls: readonly string[],
  origin: string,
  mount: string,
): RequestCheck {
  const offOrigin = new Set<string>();
  const outsideMount = new Set<string>();
  for (const url of urls) {
    const scope = requestScope(url, origin, mount);
    if (scope === "off-origin") offOrigin.add(url);
    if (scope === "outside-mount") outsideMount.add(url);
  }
  return { offOrigin: [...offOrigin], outsideMount: [...outsideMount] };
}

// ─── Pixels ──────────────────────────────────────────────

export type Image = { width: number; height: number; rgba: Uint8Array };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Channels per colour type: grey, RGB, grey+alpha, RGBA. Palette images aren't read. */
const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** An 8-bit, non-interlaced PNG (what a Playwright screenshot is) as RGBA. */
export function decodePng(png: Uint8Array): Image {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9] ?? -1;
      const interlace = body[12];
      channels = PNG_CHANNELS[colour] ?? 0;
      if (depth !== 8 || channels === 0 || interlace !== 0)
        throw new Error(
          `unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`,
        );
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (width === 0 || height === 0) throw new Error("PNG has no IHDR");
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG data is short");
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x]!;
      const left = x >= channels ? rows[out + x - channels]! : 0;
      const up = y > 0 ? rows[out - stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? rows[out - stride + x - channels]! : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, upLeft)
                  : -1;
      if (predicted < 0) throw new Error(`PNG row ${y} has filter ${filter}`);
      rows[out + x] = (value + predicted) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const px = rows.subarray(i * channels, i * channels + channels);
    const grey = channels <= 2;
    rgba[i * 4] = px[0]!;
    rgba[i * 4 + 1] = grey ? px[0]! : px[1]!;
    rgba[i * 4 + 2] = grey ? px[0]! : px[2]!;
    rgba[i * 4 + 3] = channels === 2 ? px[1]! : channels === 4 ? px[3]! : 255;
  }
  return { width, height, rgba };
}

/** The SHA-256 of an image's size and pixels: equal exactly when the two images are. */
export function pixelHash(img: Image): string {
  const size = Buffer.alloc(8);
  size.writeUInt32BE(img.width, 0);
  size.writeUInt32BE(img.height, 4);
  return createHash("sha256").update(size).update(img.rgba).digest("hex");
}

/** How many distinct RGB colours the image holds, counting up to `cap`. */
export function distinctColours(img: Image, cap = 64): number {
  const seen = new Set<number>();
  for (let i = 0; i < img.rgba.length && seen.size < cap; i += 4)
    seen.add((img.rgba[i]! << 16) | (img.rgba[i + 1]! << 8) | img.rgba[i + 2]!);
  return seen.size;
}

/** Why holding a key didn't show on the canvas, or null when the hash changed. */
export function judgeCanvasChange(before: string, after: string): string | null {
  return before === after
    ? `the canvas's pixel hash stayed ${before.slice(0, 12)}… while ArrowRight was held for ${HOLD_MS} ms`
    : null;
}

/** Why a canvas reads as not drawn (one flat colour), or null. */
export function judgeDrawn(colours: number): string | null {
  return colours < 2 ? "the canvas is one flat colour: nothing drew on it" : null;
}

// ─── Tactics ─────────────────────────────────────────────

/** A highlighted cell, and whether a click at its centre reaches the canvas (no HUD panel over it). */
export type CellTarget = { cell: string; clear: boolean };

const cellCoords = (cell: string): [number, number] => {
  const [x = Number.NaN, y = Number.NaN] = cell.split(",").map(Number);
  return [x, y];
};

/**
 * The reachable cell the smoke moves to: the farthest clear one from the
 * unit (Manhattan), ties broken by row then column; null when none is clear.
 */
export function pickReachCell(unitCell: string, reach: readonly CellTarget[]): string | null {
  const [ux, uy] = cellCoords(unitCell);
  const ranked = reach
    .filter((r) => r.clear && r.cell !== unitCell && cellCoords(r.cell).every(Number.isFinite))
    .map((r) => {
      const [x, y] = cellCoords(r.cell);
      return { cell: r.cell, x, y, d: Math.abs(x - ux) + Math.abs(y - uy) };
    })
    .sort((a, b) => b.d - a.d || a.y - b.y || a.x - b.x);
  return ranked[0]?.cell ?? null;
}

/**
 * What a click at a control's centre would land on: the control itself (or
 * one of its children), or the element named by `hit` (`canvas`, `div.x`),
 * or nothing on the page.
 */
export type ControlHit = { own: true } | { own: false; hit: string | null };

/** Why a click on the control `label` wouldn't reach it, or null when it would. */
export function judgeControlHit(label: string, hit: ControlHit): string | null {
  if (hit.own) return null;
  if (hit.hit === null) return `a click at ${label}'s centre lands on nothing on the page`;
  return `a click at ${label}'s centre lands on the ${hit.hit}, not ${label}: something over it takes the pointer, or ${label} passes pointer events through`;
}

// ─── Outcomes ────────────────────────────────────────────

export type PlayProbe =
  | { game: "platformer"; before: string; after: string; colours: number }
  | { game: "tactics"; unit: string; from: string; to: string; status: string };

export type ContextLossProbe = {
  /** `WEBGL_lose_context` was there to call. */
  extension: boolean;
  /** The host's `data-jams-render` on the root element went to "lost": the shell said `render:lost`. */
  lost: boolean;
  /** It left "lost" for "restored" or "rebuilt": the shell said `render:restored`. */
  restored: boolean;
  restoreMs: number | null;
  /** It says "rebuilt": the engine replaced the renderer, rather than Pixi restoring in place. */
  rebuilt: boolean;
  /** Distinct colours on the canvas after the restore. */
  colours: number;
};

/** What the root element's `data-jams-render` says about a restore: back at all, and on a new renderer. */
export function renderRestore(state: string | undefined): { restored: boolean; rebuilt: boolean } {
  return { restored: state === "restored" || state === "rebuilt", rebuilt: state === "rebuilt" };
}

/** One `live.state` report the stub heard, without its `type`. */
export type LiveStateSeen = Omit<LiveStateMessage, "issue"> & {
  issue?: Pick<SceneIssue, "code" | "message">;
};

/** One `download` the frame offered: its name, type and size. */
export type DownloadSeen = { name: string; contentType: string; bytes: number };

/** What the stub host page saw from the frame it hosted. */
export type HostProbe = {
  /** `jams:frame-ready` messages from the frame. */
  handshakes: number;
  /** The frame's `hello` params, or null when it sent none. */
  hello: { engine: string; release: string; game: string; features?: string[] } | null;
  /** Each `state` event's `jamsState`, in order. */
  states: string[];
  /** Each request's type, in order. */
  requests: string[];
  /** Each `live.state` report, in order. */
  live: LiveStateSeen[];
  /** Each `download` the frame offered, in order. */
  downloads: DownloadSeen[];
  /** Messages the stub couldn't read. */
  invalid: number;
};

/** Why the host run fails: the handshake, hello or the reported state went wrong. */
export function judgeHost(probe: HostProbe | undefined, release: string | null): string[] {
  if (!probe) return ["the host probe didn't run"];
  const reasons: string[] = [];
  if (probe.handshakes !== 1)
    reasons.push(`the frame posted jams:frame-ready ${probe.handshakes} times, not once`);
  if (!probe.hello) reasons.push("the frame never said hello over the host's port");
  else if (release !== null && probe.hello.release !== release)
    reasons.push(
      `the frame's hello names release ${probe.hello.release}, not the build's ${release}`,
    );
  if (probe.states.includes("error"))
    reasons.push('the frame reported jamsState "error" to the host');
  else if (probe.states.at(-1) !== "ready")
    reasons.push(
      `the frame's last reported jamsState is ${probe.states.at(-1) ?? "none"}, not "ready"`,
    );
  if (probe.invalid > 0)
    reasons.push(`the host couldn't read ${probe.invalid} of the frame's messages`);
  return reasons;
}

// ─── Live ────────────────────────────────────────────────

/** The snapshot the stub hands the frame: one pointer, `scene` at `version` with `LIVE_TIMING`. */
export function liveSnapshot(
  release: Sha256,
  scene: string,
  version: Sha256,
  since: string,
): LiveSnapshot {
  return {
    channel: "preview",
    rev: 1,
    release,
    scenes: [{ scene, version, number: 1, timing: LIVE_TIMING, since }],
    removed: [],
  };
}

/** A swap as the frame's recording holds it. */
export type RecordedSwapSeen = {
  tick: number;
  version: string | null;
  timing: string;
  strategy: string;
};

/** The recording the frame offered, as far as the judge reads it. */
export type RecordingSeen = {
  name: string;
  scene: string;
  ticks: number;
  end: string;
  sceneVersion: string | null;
  swaps: RecordedSwapSeen[];
};

/** What the headless replay of the frame's recording gave, or why it gave nothing. */
export type LiveReplay =
  | {
      matches: boolean;
      stale: boolean;
      divergence: string | null;
      /** The replay's own end digest. */
      end: string | null;
    }
  | { error: string };

/** What a live run saw beyond the host probe. */
export type LiveProbe = {
  scene: string;
  version: Sha256;
  /** Null when the frame offered none, or one that isn't a recording. */
  recording: RecordingSeen | null;
  /** Why the offered download isn't a recording, when it isn't. */
  recordingProblem?: string;
  /** Null when there was no recording to replay. */
  replay: LiveReplay | null;
};

/** `download` names a recording ends with. */
const RECORDING_SUFFIX = ".recording.json";

/** The first offered download that names a recording, or null. */
export function recordingDownload(downloads: readonly DownloadSeen[]): number | null {
  const at = downloads.findIndex((d) => d.name.endsWith(RECORDING_SUFFIX));
  return at < 0 ? null : at;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** What the judge needs from a recording's text, or why it isn't one. */
export function readRecording(
  name: string,
  text: string,
): { ok: true; recording: RecordingSeen } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, problem: `${name} isn't JSON: ${(err as Error).message}` };
  }
  if (
    !isRecord(raw) ||
    typeof raw.scene !== "string" ||
    typeof raw.ticks !== "number" ||
    typeof raw.end !== "string"
  )
    return { ok: false, problem: `${name} isn't a run recording (no scene, ticks or end)` };
  const swaps = Array.isArray(raw.swaps) ? raw.swaps.filter(isRecord) : [];
  return {
    ok: true,
    recording: {
      name,
      scene: raw.scene,
      ticks: raw.ticks,
      end: raw.end,
      sceneVersion: typeof raw.sceneVersion === "string" ? raw.sceneVersion : null,
      swaps: swaps.map((s) => ({
        tick: typeof s.tick === "number" ? s.tick : -1,
        version: typeof s.version === "string" ? s.version : null,
        timing: String(s.timing),
        strategy: String(s.strategy),
      })),
    },
  };
}

/** What `replay --json` printed, as the judge reads it. */
export function readReplay(stdout: string): LiveReplay {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { error: `replay --json printed no JSON: ${stdout.trim().slice(0, 200) || "nothing"}` };
  }
  if (!isRecord(data)) return { error: "replay --json printed no object" };
  if (data.blocked === true || data.ok === false) {
    const issues = Array.isArray(data.issues) ? data.issues.filter(isRecord) : [];
    const why =
      issues.map((i) => `${String(i.code)}: ${String(i.message)}`).join("; ") ||
      (typeof data.error === "string" ? data.error : "blocked");
    return { error: `the replay didn't run: ${why}` };
  }
  const replayed = isRecord(data.recording) ? data.recording : null;
  return {
    matches: data.matches === true,
    stale: data.stale === true,
    divergence: typeof data.divergence === "string" ? data.divergence : null,
    end: typeof replayed?.end === "string" ? replayed.end : null,
  };
}

/** Whether the frame asked for `live/<version>.json` under its own mount. */
export function fetchedVersion(
  requests: readonly string[],
  origin: string,
  mount: string,
  version: Sha256,
): boolean {
  const want = `${mount}${liveFiles.doc(version)}`;
  return requests.some((url) => {
    try {
      const u = new URL(url);
      return u.origin === origin && u.pathname === want;
    } catch {
      return false;
    }
  });
}

const issueText = (s: LiveStateSeen) => (s.issue ? ` (${s.issue.code}: ${s.issue.message})` : "");

/**
 * Why the live run fails: the frame didn't announce `live`, didn't fetch the
 * version from its own directory, refused or failed it, didn't report it
 * `staging`, `ready` and `applied` at `LIVE_TIMING` in that order, offered
 * no recording, or its recording doesn't hold the swap or doesn't replay
 * headless to the same end.
 */
export function judgeLive(
  probe: LiveProbe | undefined,
  host: HostProbe | undefined,
  requests: { urls: readonly string[]; origin: string; mount: string },
): string[] {
  if (!probe) return ["the live probe didn't run"];
  const reasons: string[] = [];
  const short = `${probe.scene}@${probe.version.slice(0, 12)}`;
  if (host?.hello && !host.hello.features?.includes("live"))
    reasons.push(`the frame's hello doesn't list the "live" feature`);
  if (!fetchedVersion(requests.urls, requests.origin, requests.mount, probe.version))
    reasons.push(
      `the frame never fetched ${requests.mount}${liveFiles.doc(probe.version)} from its own directory`,
    );
  const mine = (host?.live ?? []).filter(
    (s) => s.scene === probe.scene && s.version === probe.version,
  );
  const bad = mine.find((s) => s.status === "refused" || s.status === "failed");
  if (bad) reasons.push(`the frame reported ${short} ${bad.status}${issueText(bad)}`);
  const at = (status: string) => mine.findIndex((s) => s.status === status);
  const applied = mine[at("applied")];
  if (!applied) {
    const last = mine.at(-1);
    if (!bad)
      reasons.push(
        `the frame never reported ${short} applied; its last report was ${last ? `${last.status}${last.timing ? ` at ${last.timing}` : ""}${issueText(last)}` : "none"}`,
      );
  } else {
    if (applied.timing !== LIVE_TIMING)
      reasons.push(
        `the frame applied ${short} at ${applied.timing ?? "no timing"}, not ${LIVE_TIMING}`,
      );
    if (!(at("staging") >= 0 && at("staging") < at("ready") && at("ready") < at("applied")))
      reasons.push(
        `the frame reported ${short} ${mine.map((s) => s.status).join(", ")}, not staging, ready, then applied`,
      );
  }
  if (!applied) return reasons;
  if (!probe.recording) {
    reasons.push(
      probe.recordingProblem ??
        `the frame offered no recording through download within ${RECORDING_TIMEOUT_MS} ms of ${RECORDING_REQUEST.type}`,
    );
    return reasons;
  }
  const rec = probe.recording;
  if (rec.scene !== probe.scene)
    reasons.push(`${rec.name} records the scene ${rec.scene}, not ${probe.scene}`);
  const swap = rec.swaps.find((s) => s.version === probe.version);
  if (!swap) reasons.push(`${rec.name} holds no swap to ${short}`);
  else {
    if (swap.timing !== LIVE_TIMING)
      reasons.push(`${rec.name} records the swap at ${swap.timing}, not ${LIVE_TIMING}`);
    if (applied.tick !== undefined && swap.tick !== applied.tick)
      reasons.push(
        `${rec.name} records the swap before tick ${swap.tick}, the frame reported tick ${applied.tick}`,
      );
    if (applied.strategy !== undefined && swap.strategy !== applied.strategy)
      reasons.push(
        `${rec.name} records the swap as ${swap.strategy}, the frame reported ${applied.strategy}`,
      );
  }
  const r = probe.replay;
  if (!r) reasons.push(`${rec.name} wasn't replayed`);
  else if ("error" in r) reasons.push(r.error);
  else {
    if (!r.matches)
      reasons.push(
        `${rec.name} replays headless to another end${r.divergence ? `: ${r.divergence}` : ""} (recorded ${rec.end.slice(0, 12)}…, replayed ${r.end?.slice(0, 12) ?? "none"}…)`,
      );
    if (r.stale) reasons.push(`${rec.name} replays stale: the replayed run isn't the one recorded`);
  }
  return reasons;
}

export type RunOutcome = PlannedRun & {
  status: "pass" | "fail" | "skipped";
  reason?: string;
  ms?: number;
  /** Requests the browser made, the service worker's included. */
  requests?: number;
  offOrigin?: string[];
  outsideMount?: string[];
  /** Requests that failed or got a 4xx/5xx; recorded, not judged (a service worker's network-first fetch fails offline). */
  failed?: string[];
  /** Service worker registrations once the page is ready; judged for builds without a PWA. */
  serviceWorkers?: number;
  /** Offline: the reloaded page was controlled by the build's service worker. */
  controlled?: boolean;
  play?: PlayProbe;
  contextLoss?: ContextLossProbe;
  layout?: PageLayout;
  host?: HostProbe;
  live?: LiveProbe;
};

/** The page's box once ready, in CSS pixels. */
export type PageLayout = {
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  /** The game's canvas's client rect, or null when the page has none. */
  canvas: { top: number; left: number; width: number; height: number } | null;
};

/** Why the page's layout fails: it scrolls, or the canvas doesn't fill the window from its corner. */
export function judgeLayout(l: PageLayout): string | null {
  const problems: string[] = [];
  if (l.scrollHeight > l.innerHeight || l.scrollWidth > l.innerWidth)
    problems.push(
      `the page scrolls: ${l.scrollWidth}×${l.scrollHeight} in a ${l.innerWidth}×${l.innerHeight} window`,
    );
  const c = l.canvas;
  if (!c) problems.push("the page has no canvas");
  else if (
    Math.round(c.top) !== 0 ||
    Math.round(c.left) !== 0 ||
    Math.round(c.width) !== l.innerWidth ||
    Math.round(c.height) !== l.innerHeight
  )
    problems.push(
      `the canvas is ${Math.round(c.width)}×${Math.round(c.height)} at ${Math.round(c.left)},${Math.round(c.top)}, not the ${l.innerWidth}×${l.innerHeight} window`,
    );
  return problems.length ? problems.join("; ") : null;
}

/** What a finished run observed, before judging. */
export type RunObservation = {
  requests: readonly string[];
  failed: readonly string[];
  origin: string;
  mount: string;
  pwa: boolean;
  serviceWorkers: number;
  controlled?: boolean;
  play: PlayProbe;
  /** The play check's own verdict. */
  playReason: string | null;
  contextLoss?: ContextLossProbe;
  layout?: PageLayout;
  host?: HostProbe;
  /** The release the build printed: what a host run's hello must name. */
  release?: string | null;
  live?: LiveProbe;
};

/** Every reason a run fails, in a fixed order: requests, service worker, layout, context loss, host, live, play. */
export function judgeRun(kind: RunKind, o: RunObservation): string[] {
  const reasons: string[] = [];
  const { offOrigin, outsideMount } = checkRequests(o.requests, o.origin, o.mount);
  if (offOrigin.length) reasons.push(`requests outside ${o.origin}: ${offOrigin.join(", ")}`);
  if (outsideMount.length) reasons.push(`requests outside ${o.mount}: ${outsideMount.join(", ")}`);
  if (!o.pwa && o.serviceWorkers > 0)
    reasons.push(`${o.serviceWorkers} service worker(s) registered by a build without a PWA`);
  const hosted = kind === "host" || kind === "live";
  if (hosted && o.serviceWorkers > 0)
    reasons.push(`${o.serviceWorkers} service worker(s) registered in a frame with a host`);
  const layout = o.layout ? judgeLayout(o.layout) : null;
  if (layout) reasons.push(layout);
  if (kind === "offline" && o.controlled !== true)
    reasons.push("offline, the reloaded page isn't controlled by the build's service worker");
  if (kind === "context-loss") {
    const c = o.contextLoss;
    if (!c) reasons.push("the context-loss probe didn't run");
    else if (!c.extension) reasons.push("WEBGL_lose_context isn't available on the canvas");
    else {
      if (!c.lost)
        reasons.push('losing the context never set data-jams-render to "lost" (render:lost)');
      if (!c.restored)
        reasons.push(
          `data-jams-render didn't leave "lost" ${RESTORE_TIMEOUT_MS} ms after restoreContext() (no render:restored)`,
        );
      const flat = judgeDrawn(c.colours);
      if (flat) reasons.push(`after the restore, ${flat}`);
    }
  }
  if (hosted) reasons.push(...judgeHost(o.host, o.release ?? null));
  if (kind === "live")
    reasons.push(
      ...judgeLive(o.live, o.host, { urls: o.requests, origin: o.origin, mount: o.mount }),
    );
  if (o.playReason) reasons.push(o.playReason);
  return reasons;
}

/** The outcome of a run that finished: pass, or fail with every reason. */
export function runOutcome(planned: PlannedRun, o: RunObservation, ms: number): RunOutcome {
  const reasons = judgeRun(planned.kind, o);
  const { offOrigin, outsideMount } = checkRequests(o.requests, o.origin, o.mount);
  return {
    ...planned,
    status: reasons.length ? "fail" : "pass",
    ...(reasons.length ? { reason: reasons.join("; ") } : {}),
    ms,
    requests: o.requests.length,
    offOrigin,
    outsideMount,
    failed: [...new Set(o.failed)],
    serviceWorkers: o.serviceWorkers,
    ...(o.controlled !== undefined ? { controlled: o.controlled } : {}),
    play: o.play,
    ...(o.contextLoss ? { contextLoss: o.contextLoss } : {}),
    ...(o.layout ? { layout: o.layout } : {}),
    ...(o.host ? { host: o.host } : {}),
    ...(o.live ? { live: o.live } : {}),
  };
}

/** Every planned run in a browser that wouldn't launch: skipped locally when it isn't installed, else failed. */
export function launchFailures(
  runs: readonly PlannedRun[],
  message: string,
  ci: boolean,
): RunOutcome[] {
  return runs.map((run) => {
    const missing = isMissingBrowser(message);
    return {
      ...run,
      status: missing && !ci ? "skipped" : "fail",
      reason: missing
        ? `not installed; run \`${installCommand(run.browser)}\``
        : `couldn't launch: ${message.split("\n", 1)[0]}`,
    };
  });
}

export type BundleCheckOutcome = { ok: boolean; output: string };

export type BuildOutcome = {
  name: string;
  game: SmokeGame;
  target: SmokeBuild["target"];
  ok: boolean;
  reason?: string;
  release: string | null;
  ms: number;
  bundleCheck: BundleCheckOutcome | null;
};

export type ExportSmokeReport = {
  ok: boolean;
  ci: boolean;
  browsers: BrowserName[];
  builds: BuildOutcome[];
  runs: RunOutcome[];
  /** Chromium's context-loss run: true when Pixi restored the context in place, false when the engine rebuilt; null when it didn't run. */
  pixiRestoredInPlace: boolean | null;
  error?: string;
};

/**
 * Passes when nothing errored, every build built and passed its bundle
 * check, every planned run has an outcome, none failed, and at least one
 * ran.
 */
export function exportSmokeOk(
  r: Omit<ExportSmokeReport, "ok" | "pixiRestoredInPlace">,
  planned: readonly PlannedRun[],
): boolean {
  if (r.error !== undefined) return false;
  if (r.builds.length === 0) return false;
  if (r.builds.some((b) => !b.ok || !b.bundleCheck?.ok)) return false;
  if (r.runs.length !== planned.length) return false;
  if (r.runs.some((run) => run.status === "fail")) return false;
  return r.runs.some((run) => run.status === "pass");
}

export function exportSmokeReport(
  parts: Omit<ExportSmokeReport, "ok" | "pixiRestoredInPlace">,
  planned: readonly PlannedRun[],
): ExportSmokeReport {
  const loss = parts.runs.find((r) => r.kind === "context-loss" && r.contextLoss?.restored);
  return {
    ok: exportSmokeOk(parts, planned),
    ci: parts.ci,
    browsers: parts.browsers,
    builds: parts.builds,
    runs: parts.runs,
    pixiRestoredInPlace: loss?.contextLoss ? !loss.contextLoss.rebuilt : null,
    ...(parts.error !== undefined ? { error: parts.error } : {}),
  };
}

// ─── Building ────────────────────────────────────────────

/** `engine-bundle-check --export <out>`: no editor, editor UI, dev server or debug code in the build. */
function bundleCheck(out: string): BundleCheckOutcome {
  const res = spawnSync(
    process.execPath,
    [join(REPO, "scripts/engine-bundle-check.ts"), "--export", out],
    { cwd: REPO, encoding: "utf8", timeout: BUNDLE_CHECK_TIMEOUT_MS },
  );
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return {
    ok: res.status === 0,
    output: res.status === 0 ? output : describeFailure("engine-bundle-check --export", res),
  };
}

/** The live run's version: built from the fixture edit, checked against the release it goes live on. */
export type LiveFixture = {
  scene: string;
  id: Sha256;
  version: SceneVersion;
  /** `formatSceneVersion(version)`: what `live/<id>.json` serves. */
  versionText: string;
  /** The texts it carries, by hash. */
  texts: ReadonlyMap<Sha256, string>;
  /** The scene's file in the project, which the headless replay plays. */
  sceneFile: string;
};

/**
 * Builds the version of `manifest`'s start scene that the fixture edit
 * `edit` (a scene CLI op batch) makes, from the project's files as
 * `game build` read them, with `buildSceneVersion` checking it against the
 * release. Throws with every error it reports.
 */
export async function buildLiveFixture(
  manifest: ReleaseManifest,
  opts: { projectDir: string; cacheDir: string; edit?: string },
): Promise<LiveFixture> {
  const [{ discoverProjects }, { exportInputOf }, project, scene] = await Promise.all([
    import("../scene/projects"),
    import("../scene/tools/game-build"),
    import("@jams/engine/project"),
    import("@jams/engine/scene"),
  ]);
  const projects = await discoverProjects(opts.projectDir, [project.PROJECT_FILE], {
    cacheDirOf: (id) => join(opts.cacheDir, id),
  });
  const handle = projects.find((p) => p.file.id === manifest.project.id);
  if (!handle) throw new Error(`no project ${manifest.project.id} in ${opts.projectDir}`);
  const input = await exportInputOf(handle, manifest.build.target);
  if ("exitCode" in input) throw new Error(input.text);
  const id = manifest.flow.start;
  const entry = input.view.byId.get(id);
  const text = input.texts.get(id);
  if (!entry || text === undefined) throw new Error(`${handle.file.id} has no scene ${id}`);

  const edit = opts.edit ?? LIVE_EDIT_FILE;
  const parsed = scene.parseScene(text, input.registry);
  if (!parsed.ok)
    throw new Error(`${id} doesn't parse: ${parsed.issues.map((i) => i.message).join("; ")}`);
  const batch = JSON.parse(readFileSync(edit, "utf8")) as Parameters<typeof scene.applyOps>[1];
  const applied = scene.applyOps(parsed.def, batch, input.registry, { project: input.view });
  if (!applied.ok)
    throw new Error(`${edit}: op ${applied.failedAt} failed: ${applied.issue.message}`);
  const texts = new Map(input.texts);
  texts.set(id, scene.formatScene(applied.def).text);

  const built = await project.buildSceneVersion({
    view: input.view,
    texts,
    build: input.snapshot.build,
    game: input.game,
    registry: input.registry,
    scene: id,
    release: manifest,
  });
  const errors = built.issues.filter((i) => i.severity === "error");
  if (!built.ok || errors.length > 0)
    throw new Error(
      `the version of ${id} doesn't build: ${(errors.length ? errors : built.issues).map((i) => `${i.code}: ${i.message}`).join("; ")}`,
    );
  return {
    scene: id,
    id: built.id,
    version: built.version,
    versionText: project.formatSceneVersion(built.version),
    texts: built.texts,
    sceneFile: join(handle.dir, entry.path),
  };
}

/**
 * The files a live fixture writes: under the build, `live/<id>.json` and
 * `live/<sha256>.json` for each text it carries, as the site's overlay serves
 * them; in the replay's versions directory, `scene-version.json` and the
 * texts, as `game live build` writes them. Paths relative to each root.
 */
export function liveFixtureFiles(fixture: Pick<LiveFixture, "id" | "versionText" | "texts">): {
  build: Map<string, string>;
  versions: Map<string, string>;
} {
  const build = new Map([[liveFiles.doc(fixture.id), fixture.versionText]]);
  const versions = new Map([[SCENE_VERSION_FILE, fixture.versionText]]);
  for (const [sha, text] of fixture.texts) {
    build.set(liveFiles.doc(sha), text);
    versions.set(`${sha}.json`, text);
  }
  return { build, versions };
}

function writeFiles(root: string, files: ReadonlyMap<string, string>): void {
  for (const [path, text] of files) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
}

/**
 * `replay <scene> --run <recording> --versions <dir> --json` in its own
 * process, killed after `REPLAY_TIMEOUT_MS`.
 */
function replayHeadless(
  sceneFile: string,
  recordingFile: string,
  versionsDir: string,
): Promise<LiveReplay> {
  const args = [
    join(REPO, "scripts/scene/cli.ts"),
    "replay",
    sceneFile,
    "--run",
    recordingFile,
    "--versions",
    versionsDir,
    "--json",
  ];
  return new Promise((done) => {
    execFile(
      process.execPath,
      args,
      {
        cwd: REPO,
        encoding: "utf8",
        timeout: REPLAY_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err?.killed)
          return done({ error: `the headless replay didn't finish in ${REPLAY_TIMEOUT_MS} ms` });
        const read = readReplay(stdout);
        done(
          "error" in read && stderr.trim()
            ? { error: `${read.error}; ${stderr.trim().split("\n", 1)[0]}` }
            : read,
        );
      },
    );
  });
}

// ─── In the browser ──────────────────────────────────────

/** The page's box once ready: the window, what it scrolls over and the canvas's rect. */
function pageLayout(page: Frame): Promise<PageLayout> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const rect = document.querySelector("#game canvas")?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: doc.scrollWidth,
      scrollHeight: doc.scrollHeight,
      canvas: rect
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        : null,
    };
  });
}

/** Two frames and a beat, so what the canvas shows is what the game last drew. */
async function settle(page: Frame): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await page.waitForTimeout(250);
}

/** The game's canvas as it shows on the page, overlays and a rebuilt renderer's stand-in included. */
async function canvasImage(page: Frame): Promise<Image> {
  return decodePng(await page.locator("#game canvas").first().screenshot({ animations: "allow" }));
}

async function serviceWorkerCount(page: Frame): Promise<number> {
  return page.evaluate(async () =>
    "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  );
}

/** Waits for the page's service worker to reach `activated`, so the build is precached. */
async function waitActivated(page: Page): Promise<void> {
  const until = performance.now() + PAGE_TIMEOUT_MS;
  let state: string | null = null;
  while (performance.now() < until) {
    state = await page.evaluate(async () =>
      "serviceWorker" in navigator
        ? ((await navigator.serviceWorker.getRegistration())?.active?.state ?? null)
        : null,
    );
    if (state === "activated") return;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `the service worker isn't activated after ${PAGE_TIMEOUT_MS} ms (state: ${state ?? "none"})`,
  );
}

/**
 * Clicks the centre of `target`, a HUD cell, once it's laid out. The HUD
 * swaps a cell's element when its highlight changes, so a box read between
 * the locator resolving and the element going reads again until the page
 * timeout.
 */
async function clickCentre(page: Page, target: Locator, what: string): Promise<void> {
  const until = performance.now() + PAGE_TIMEOUT_MS;
  let box: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  while (!box) {
    const left = until - performance.now();
    if (left <= 0) throw new Error(`${what} has no box on the page after ${PAGE_TIMEOUT_MS} ms`);
    await target.waitFor({ state: "visible", timeout: left }).catch((cause: unknown) => {
      if (!(cause instanceof Error && cause.name === "TimeoutError")) throw cause;
      throw new Error(`${what} isn't shown on the page after ${PAGE_TIMEOUT_MS} ms`, { cause });
    });
    box = await target.boundingBox({ timeout: Math.max(1, until - performance.now()) });
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * The game is played in `frame`: the page's main frame, or the build's
 * iframe under the host stub. Mouse and keyboard go through `page`.
 */
async function playPlatformer(
  page: Page,
  frame: Frame,
): Promise<{ probe: PlayProbe; reason: string | null }> {
  await settle(frame);
  const before = await canvasImage(frame);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up("ArrowRight");
  await settle(frame);
  const after = await canvasImage(frame);
  const probe: PlayProbe = {
    game: "platformer",
    before: pixelHash(before),
    after: pixelHash(after),
    colours: distinctColours(after),
  };
  return {
    probe,
    reason: judgeCanvasChange(probe.before, probe.after) ?? judgeDrawn(probe.colours),
  };
}

/** The highlighted cells of `kind` and whether a click at each centre lands on the canvas. */
function highlighted(page: Frame, kind: string): Promise<CellTarget[]> {
  return page.locator(`[data-highlight="${kind}"][data-cell]`).evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        cell: (el as HTMLElement).dataset.cell ?? "",
        clear: hit instanceof HTMLCanvasElement,
      };
    }),
  );
}

const hudMode = (page: Frame, mode: string) =>
  page.waitForFunction(
    (want) => document.querySelector<HTMLElement>(".tactics-hud")?.dataset.mode === want,
    mode,
    { timeout: PAGE_TIMEOUT_MS },
  );

/** Where a click at `target`'s centre lands, read through the page's own hit test. */
function controlHit(target: Locator): Promise<ControlHit> {
  return target.evaluate((el): ControlHit => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    if (hit && el.contains(hit)) return { own: true };
    if (!hit) return { own: false, hit: null };
    const cls = typeof hit.className === "string" ? hit.className.split(/\s+/)[0] : "";
    return { own: false, hit: `${hit.tagName.toLowerCase()}${cls ? `.${cls}` : ""}` };
  });
}

/** Clicks `target` once it's visible, failing at once with the reason when the click wouldn't reach it. */
async function clickControl(target: Locator, label: string): Promise<void> {
  await target.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const reason = judgeControlHit(label, await controlHit(target));
  if (reason) throw new Error(reason);
  await target.click();
}

/**
 * Moves the pointer onto the HUD's order menu, off the canvas. The board
 * cursor follows the pointer, and Chromium fires a move at the pointer's
 * last spot (where Start was) when the layout under it changes, which can
 * carry the cursor off the first unit while the level settles.
 */
async function parkPointer(page: Page, frame: Frame): Promise<void> {
  const menu = frame.locator(".tactics-hud-menu").first();
  await menu.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const clear = await menu.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!hit && el.contains(hit);
  });
  const box = await menu.boundingBox();
  if (!clear || !box)
    throw new Error("the HUD's order menu doesn't take the pointer at its centre");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Puts the cursor back on the first ready unit with the HUD's own keys
 * (next unit, then cancel), so a pointer move before the pointer was parked
 * can't leave it elsewhere. Next unit is ignored until the side can take
 * orders, so it's pressed until the HUD selects.
 */
async function cursorToFirstUnit(page: Page, frame: Frame): Promise<void> {
  const until = performance.now() + PAGE_TIMEOUT_MS;
  for (;;) {
    await page.keyboard.press("KeyQ");
    const selected = await frame
      .waitForFunction(
        () => document.querySelector<HTMLElement>(".tactics-hud")?.dataset.mode === "selected",
        undefined,
        { timeout: 1000 },
      )
      .then(() => true)
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "TimeoutError") return false;
        throw cause;
      });
    if (selected) break;
    if (performance.now() >= until)
      throw new Error(`the HUD selects no unit on next-unit after ${PAGE_TIMEOUT_MS} ms`);
  }
  await page.keyboard.press("Escape");
  await hudMode(frame, "idle");
}

async function playTactics(
  page: Page,
  frame: Frame,
): Promise<{ probe: PlayProbe; reason: string | null }> {
  await clickControl(frame.getByRole("button", { name: "Start", exact: true }), "Start");
  await parkPointer(page, frame);
  const cursor = frame.locator('[data-highlight="cursor"][data-cell]').first();
  await cursor.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  await hudMode(frame, "idle");
  await cursorToFirstUnit(page, frame);
  const [unitCell] = await highlighted(frame, "cursor");
  if (!unitCell) throw new Error("the HUD shows no cursor cell after Start");
  if (!unitCell.clear) throw new Error(`a HUD panel covers the first unit's cell ${unitCell.cell}`);
  await clickCentre(
    page,
    frame.locator(`[data-highlight="cursor"][data-cell="${unitCell.cell}"]`).first(),
    `the cursor on the first unit's cell ${unitCell.cell}`,
  );
  await hudMode(frame, "selected");
  const card = frame.locator(".tactics-hud-card");
  const unit = (await card.getAttribute("data-unit")) ?? "";
  const to = pickReachCell(unitCell.cell, await highlighted(frame, "reach"));
  if (!to) throw new Error(`no clear reachable cell for ${unit || "the unit"} at ${unitCell.cell}`);
  await clickCentre(
    page,
    frame.locator(`[data-highlight="reach"][data-cell="${to}"]`).first(),
    `the reachable cell ${to}`,
  );
  await hudMode(frame, "target");
  await clickCentre(
    page,
    frame.locator(`[data-highlight="target"][data-cell="${to}"]`).first(),
    `the target cell ${to}`,
  );
  const status = await frame
    .waitForFunction(
      (id) => {
        const el = document.querySelector<HTMLElement>(".tactics-hud-card");
        if (!el || el.hidden || el.dataset.unit !== id) return null;
        const dt = [...el.querySelectorAll("dt")].find((d) => d.textContent === "Status");
        const value = dt?.nextElementSibling?.textContent ?? null;
        return value === "Moved" || value === "Done" ? value : null;
      },
      unit,
      { timeout: PAGE_TIMEOUT_MS },
    )
    .then((h) => h.jsonValue() as Promise<string>);
  return { probe: { game: "tactics", unit, from: unitCell.cell, to, status }, reason: null };
}

const play = (page: Page, frame: Frame, game: SmokeGame) =>
  game === "tactics" ? playTactics(page, frame) : playPlatformer(page, frame);

type LoseHandle = { loseContext(): void; restoreContext(): void };

async function loseAndRestore(page: Page): Promise<ContextLossProbe> {
  await settle(page.mainFrame());
  const extension = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#game canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? null;
    const ext = gl?.getExtension("WEBGL_lose_context") ?? null;
    (window as unknown as { __exportSmokeLose?: LoseHandle | null }).__exportSmokeLose = ext;
    ext?.loseContext();
    return ext !== null;
  });
  const none: ContextLossProbe = {
    extension,
    lost: false,
    restored: false,
    restoreMs: null,
    rebuilt: false,
    colours: 0,
  };
  if (!extension) return none;
  const lost = await page
    .waitForFunction(() => document.documentElement.dataset.jamsRender === "lost", undefined, {
      timeout: 5000,
    })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(RESTORE_AFTER_MS);
  const started = performance.now();
  await page.evaluate(() =>
    (window as unknown as { __exportSmokeLose: LoseHandle }).__exportSmokeLose.restoreContext(),
  );
  const back = await page
    .waitForFunction(() => document.documentElement.dataset.jamsRender !== "lost", undefined, {
      timeout: RESTORE_TIMEOUT_MS,
    })
    .then(() => page.evaluate(() => document.documentElement.dataset.jamsRender))
    .catch(() => undefined);
  const { restored, rebuilt } = renderRestore(back);
  const restoreMs = restored ? Math.round(performance.now() - started) : null;
  await settle(page.mainFrame());
  return {
    ...none,
    lost,
    restored,
    restoreMs,
    rebuilt,
    colours: distinctColours(await canvasImage(page.mainFrame())),
  };
}

type Served = { build: SmokeBuild; mount: string; server: StaticServer; release: string | null };

/** The stub's page URL framing `frame`. */
const stubUrl = (stub: StaticServer, frame: string) =>
  `${stub.url}${HOST_STUB_FILE}?frame=${encodeURIComponent(frame)}`;

/** Opens the stub framing the build and hands back the build's frame once it is attached. */
async function openHosted(page: Page, stub: StaticServer, build: string): Promise<Frame> {
  await page.goto(stubUrl(stub, build));
  const frame = await (await page.waitForSelector("iframe#frame")).contentFrame();
  if (!frame) throw new Error("the host stub's iframe has no frame");
  return frame;
}

/** What the stub recorded, without its `send` or the downloads' contents. */
function hostProbe(page: Page): Promise<HostProbe> {
  return page.evaluate(() => {
    const r = (window as unknown as { __hostStub?: HostProbe }).__hostStub;
    return r
      ? {
          handshakes: r.handshakes,
          hello: r.hello,
          states: [...r.states],
          requests: [...r.requests],
          live: r.live.map((s) => ({ ...s })),
          downloads: r.downloads.map((d) => ({
            name: d.name,
            contentType: d.contentType,
            bytes: d.bytes,
          })),
          invalid: r.invalid,
        }
      : {
          handshakes: 0,
          hello: null,
          states: [],
          requests: [],
          live: [],
          downloads: [],
          invalid: 0,
        };
  });
}

/** Has the stub post `message` to the frame over its port. */
async function sendToFrame(page: Page, message: unknown): Promise<void> {
  const sent = await page.evaluate((m) => {
    const stub = (window as unknown as { __hostStub?: { send(m: unknown): boolean } }).__hostStub;
    return stub?.send(m) ?? false;
  }, message);
  if (!sent) throw new Error("the host stub has no port to the frame yet");
}

/**
 * Waits until the frame reports `version` of `scene` applied, refused or
 * failed, or `LIVE_APPLY_TIMEOUT_MS` passes; the judge reads what came.
 */
async function waitLiveSettled(page: Page, scene: string, version: Sha256): Promise<void> {
  await page
    .waitForFunction(
      ([sc, v]) => {
        const r = (window as unknown as { __hostStub?: HostProbe }).__hostStub;
        return (r?.live ?? []).some(
          (s) =>
            s.scene === sc &&
            s.version === v &&
            (s.status === "applied" || s.status === "refused" || s.status === "failed"),
        );
      },
      [scene, version] as const,
      { timeout: LIVE_APPLY_TIMEOUT_MS },
    )
    .catch((cause: unknown) => {
      if (!(cause instanceof Error && cause.name === "TimeoutError")) throw cause;
    });
}

/** The text of the first recording the frame offers within `RECORDING_TIMEOUT_MS`, or null. */
async function offeredRecording(page: Page): Promise<{ name: string; text: string } | null> {
  type Stub = { downloads: (DownloadSeen & { text: string | null })[] };
  const handle = await page
    .waitForFunction(
      (suffix) => {
        const r = (window as unknown as { __hostStub?: Stub }).__hostStub;
        const d = r?.downloads.find((x) => x.name.endsWith(suffix));
        return d ? { name: d.name, text: d.text ?? "" } : null;
      },
      RECORDING_SUFFIX,
      { timeout: RECORDING_TIMEOUT_MS },
    )
    .catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === "TimeoutError") return null;
      throw cause;
    });
  return handle ? ((await handle.jsonValue()) as { name: string; text: string }) : null;
}

/** What the live run's swap needs: the version, where its replay reads it, and the release it goes live on. */
type LiveTarget = { fixture: LiveFixture; versionsDir: string; release: Sha256; tmp: string };

/**
 * The live swap in the hosted frame: the stub sends the snapshot, the
 * frame reports the version applied, the platformer is played on it, the
 * stub asks for the run's recording and it is replayed headless.
 */
async function swapLive(
  page: Page,
  frame: Frame,
  game: SmokeGame,
  live: LiveTarget,
  label: string,
): Promise<{ probe: LiveProbe; played: Awaited<ReturnType<typeof play>> }> {
  const { fixture } = live;
  await sendToFrame(page, {
    type: "live.update",
    live: liveSnapshot(live.release, fixture.scene, fixture.id, new Date().toISOString()),
  });
  await waitLiveSettled(page, fixture.scene, fixture.id);
  const played = await play(page, frame, game);
  const probe: LiveProbe = {
    scene: fixture.scene,
    version: fixture.id,
    recording: null,
    replay: null,
  };
  const applied = (await hostProbe(page)).live.some(
    (s) => s.scene === fixture.scene && s.version === fixture.id && s.status === "applied",
  );
  if (!applied) return { probe, played };
  await sendToFrame(page, RECORDING_REQUEST);
  const offered = await offeredRecording(page);
  if (!offered) return { probe, played };
  const read = readRecording(offered.name, offered.text);
  if (!read.ok) return { probe: { ...probe, recordingProblem: read.problem }, played };
  const file = join(live.tmp, `${label.replace(/[^a-z0-9-]+/gi, "-")}${RECORDING_SUFFIX}`);
  writeFileSync(file, offered.text);
  const replay = await replayHeadless(fixture.sceneFile, file, live.versionsDir);
  return { probe: { ...probe, recording: read.recording, replay }, played };
}

async function runOne(
  browser: Browser,
  planned: PlannedRun,
  served: Served,
  stub: StaticServer | null,
  live: LiveTarget | null = null,
): Promise<RunOutcome> {
  const started = performance.now();
  const context: BrowserContext = await browser.newContext({ serviceWorkers: "allow" });
  const requests: string[] = [];
  const failed: string[] = [];
  // The stub page is the run's own parent, not a request the build made.
  const own = (url: string) =>
    stub !== null &&
    (url.startsWith(`${stub.url}${HOST_STUB_FILE}`) || url === `${stub.origin}/favicon.ico`);
  context.on("request", (r) => {
    if (!own(r.url())) requests.push(r.url());
  });
  context.on("requestfailed", (r) =>
    failed.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`),
  );
  context.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.url()} (${r.status()})`);
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const errors = pageErrors(page);
    const work = async (): Promise<RunObservation> => {
      let frame = page.mainFrame();
      const hosted = planned.kind === "host" || planned.kind === "live";
      if (planned.kind === "live" && !live) throw new Error("the live version wasn't built");
      if (hosted) {
        if (!stub) throw new Error("no host stub is served");
        frame = await openHosted(page, stub, served.server.url);
      } else {
        const query = planned.kind === "context-loss" ? "?renderer=webgl" : "";
        await page.goto(`${served.server.url}${query}`);
      }
      await waitReady(frame);
      const layout = await pageLayout(frame);
      let controlled: boolean | undefined;
      if (planned.kind === "offline") {
        await waitActivated(page);
        await context.setOffline(true);
        await page.reload();
        await waitReady(frame);
        controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
      }
      const contextLoss = planned.kind === "context-loss" ? await loseAndRestore(page) : undefined;
      const serviceWorkers = await serviceWorkerCount(frame);
      const swapped = live
        ? await swapLive(
            page,
            frame,
            served.build.game,
            live,
            `${planned.browser}-${planned.build}`,
          )
        : null;
      const played = swapped ? swapped.played : await play(page, frame, served.build.game);
      const host = hosted ? await hostProbe(page) : undefined;
      return {
        requests,
        failed,
        origin: served.server.origin,
        mount: served.server.mount,
        pwa: served.build.pwa,
        serviceWorkers,
        ...(controlled !== undefined ? { controlled } : {}),
        play: played.probe,
        playReason: played.reason,
        ...(contextLoss ? { contextLoss } : {}),
        layout,
        ...(host ? { host, release: served.release } : {}),
        ...(swapped ? { live: swapped.probe } : {}),
      };
    };
    const observed = await withTimeout(
      Promise.race([work(), errors]),
      runTimeoutMs(planned.kind),
      `${planned.browser} ${planned.kind} ${planned.build} at ${planned.mount}`,
    );
    return runOutcome(planned, observed, Math.round(performance.now() - started));
  } catch (err) {
    const { offOrigin, outsideMount } = checkRequests(
      requests,
      served.server.origin,
      served.server.mount,
    );
    return {
      ...planned,
      status: "fail",
      reason: err instanceof Error ? err.message : String(err),
      ms: Math.round(performance.now() - started),
      requests: requests.length,
      offOrigin,
      outsideMount,
      failed: [...new Set(failed)],
    };
  } finally {
    await closeWithin(context.close(), `${planned.browser}'s context`);
  }
}

// ─── The runner ──────────────────────────────────────────

/**
 * Builds the live fixture's version against the release in `out` and
 * writes its files: under `out/live/`, where the frame fetches them, and in
 * a versions directory for the headless replay.
 */
async function prepareLive(
  out: string,
  game: SmokeGame,
  release: string | null,
  tmp: string,
): Promise<LiveTarget> {
  const { parseReleaseManifest, RELEASE_FILE } = await import("@jams/engine/project");
  const parsed = parseReleaseManifest(readFileSync(join(out, RELEASE_FILE), "utf8"));
  if (!parsed.ok)
    throw new Error(
      `${RELEASE_FILE} doesn't read: ${parsed.issues.map((i) => i.message).join("; ")}`,
    );
  if (release === null) throw new Error("the build printed no release id");
  const fixture = await buildLiveFixture(parsed.manifest, {
    projectDir: join(REPO, "src/games", game),
    cacheDir: join(tmp, "live-cache"),
  });
  const files = liveFixtureFiles(fixture);
  const versionsDir = join(tmp, "live-versions");
  writeFiles(out, files.build);
  writeFiles(versionsDir, files.versions);
  return { fixture, versionsDir, release, tmp };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { browsers: { type: "string" }, out: { type: "string" } },
  });
  const browsers = parseBrowsers(values.browsers);
  const reportFile = values.out ? resolve(values.out) : join(REPO, "engine-export-smoke.json");
  const ci = process.env.CI === "true";
  const playwright = await import("playwright");
  const types: Record<BrowserName, BrowserType> = {
    chromium: playwright.chromium,
    firefox: playwright.firefox,
    webkit: playwright.webkit,
  };

  const tmp = mkdtempSync(join(tmpdir(), "jams-engine-export-smoke-"));
  const servers: StaticServer[] = [];
  const open = new Set<Browser>();
  const cleanup = async () => {
    await Promise.all([...open].map((b) => closeWithin(b.close(), b.browserType().name())));
    open.clear();
    await Promise.allSettled(servers.splice(0).map((s) => s.close()));
    rmSync(tmp, { recursive: true, force: true });
  };
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.once(signal, () => {
      console.error(`\n${signal}: stopping the static servers`);
      void cleanup().finally(() => process.exit(code));
    });
  }

  const planned = allRuns(SMOKE_BUILDS, browsers);
  const builds: BuildOutcome[] = [];
  const runs: RunOutcome[] = [];
  let error: string | undefined;
  let stub: StaticServer | null = null;
  let live: LiveTarget | null = null;
  let liveError = "";
  try {
    const stubDir = join(tmp, "host-stub");
    mkdirSync(stubDir);
    copyFileSync(join(REPO, "scripts/engine-smoke", HOST_STUB_FILE), join(stubDir, HOST_STUB_FILE));
    stub = await serveStatic({ dir: stubDir });
    servers.push(stub);
    const served = new Map<string, Served>();
    for (const b of SMOKE_BUILDS) {
      const name = buildName(b);
      const out = join(tmp, name);
      const started = performance.now();
      const built = buildOne(b, out);
      const check = built.reason ? null : bundleCheck(out);
      const outcome: BuildOutcome = {
        name,
        game: b.game,
        target: b.target,
        ok: !built.reason,
        ...(built.reason ? { reason: built.reason } : {}),
        release: built.release,
        ms: Math.round(performance.now() - started),
        bundleCheck: check,
      };
      builds.push(outcome);
      const checked = check ? (check.ok ? "bundle check passed" : "bundle check failed") : "";
      console.log(
        `${name}: ${outcome.ok ? `built (release ${built.release ?? "?"}), ${checked}` : `build failed: ${built.reason}`}`,
      );
      if (!outcome.ok) throw new Error(`${name} didn't build`);
      if (name === LIVE_BUILD && planned.some((p) => p.kind === "live")) {
        try {
          live = await prepareLive(out, b.game, built.release, tmp);
          console.log(`${name}: live version ${live.fixture.scene}@${live.fixture.id} built`);
        } catch (err) {
          liveError = err instanceof Error ? err.message : String(err);
          console.log(`${name}: the live version didn't build: ${liveError}`);
        }
      }
      for (const mount of b.mounts) {
        const server = await serveStatic({ dir: out, mount });
        servers.push(server);
        served.set(`${name} ${mount}`, { build: b, mount, server, release: built.release });
        console.log(`serving ${name} at ${server.url}`);
      }
    }

    for (const name of browsers) {
      const mine = planned.filter((p) => p.browser === name);
      let browser: Browser;
      try {
        browser = await types[name].launch({ headless: true });
      } catch (err) {
        runs.push(...launchFailures(mine, err instanceof Error ? err.message : String(err), ci));
        console.log(`${name}: ${runs.at(-1)?.status} — ${runs.at(-1)?.reason}`);
        continue;
      }
      open.add(browser);
      try {
        for (const p of mine) {
          const target = served.get(`${p.build} ${p.mount}`);
          if (!target) throw new Error(`nothing serves ${p.build} at ${p.mount}`);
          const hosted = p.kind === "host" || p.kind === "live";
          const outcome =
            p.kind === "live" && !live
              ? {
                  ...p,
                  status: "fail" as const,
                  reason: `the live version wasn't built: ${liveError}`,
                }
              : await runOne(
                  browser,
                  p,
                  target,
                  hosted ? stub : null,
                  p.kind === "live" ? live : null,
                );
          runs.push(outcome);
          const extra = outcome.contextLoss
            ? `; ${outcome.contextLoss.rebuilt ? "rebuilt" : "restored in place"}`
            : "";
          const detail = outcome.status === "pass" ? `${outcome.ms} ms${extra}` : outcome.reason;
          console.log(`${name} ${p.kind} ${p.build} at ${p.mount}: ${outcome.status} — ${detail}`);
        }
      } finally {
        open.delete(browser);
        await closeWithin(browser.close(), name);
      }
    }
  } catch (err) {
    error = err instanceof Error ? (err.stack ?? err.message) : String(err);
  } finally {
    await cleanup();
  }

  const report = exportSmokeReport(
    { ci, browsers, builds, runs, ...(error !== undefined ? { error } : {}) },
    planned,
  );
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  if (error) console.error(`\nengine export smoke failed:\n${error}`);
  if (!report.ok) {
    if (!error) console.error("\nengine export smoke failed");
    return 1;
  }
  const skipped = [...new Set(runs.filter((r) => r.status === "skipped").map((r) => r.browser))];
  console.log(
    `engine export smoke passed${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}`,
  );
  return 0;
}

if (import.meta.main) process.exitCode = await main();

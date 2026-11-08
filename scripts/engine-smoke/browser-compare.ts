/**
 * The browser smoke's verdicts, kept free of Playwright and Vite so the
 * runner's rules (a digest must equal Node's, the sprite's pixel must be
 * drawn and the empty one blank, a page must answer in time, a missing
 * browser is never a pass) are unit-tested without a browser.
 */
import type { EngineSmokeResult } from "./browser/main";
import { INSIDE_COLOUR, SMOKE_BACKGROUND } from "./browser/sink";

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];

export const PAGE_TIMEOUT_MS = 60_000;

/** One pixel as the renderer's extract reads it, 0–255 per channel. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** The page's render run: which renderer drew, and the two pixels it read. */
export type RenderProbe = { renderer: string; inside: Rgba; outside: Rgba };

/** How far a channel may stray from the colour expected of it. */
export const PIXEL_TOLERANCE = 8;

const rgbOf = (hex: number): [number, number, number] => [
  (hex >> 16) & 0xff,
  (hex >> 8) & 0xff,
  hex & 0xff,
];

const near = (px: Rgba, hex: number) =>
  rgbOf(hex).every((c, i) => Math.abs((px[i] ?? -1) - c) <= PIXEL_TOLERANCE);

const show = (px: Rgba) => `rgba(${px.join(", ")})`;
const hexOf = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/**
 * Why the render run failed, or null when it passed: the pixel inside the
 * sprite must be opaque, the sprite frame's colour and not the background;
 * the one outside every sprite must be the background.
 */
export function judgeRender(render: RenderProbe | undefined): string | null {
  if (!render) return "the page ran no render";
  const { inside, outside } = render;
  if (inside[3] < 255 - PIXEL_TOLERANCE)
    return `the sprite's pixel isn't opaque: ${show(inside)} on ${render.renderer}`;
  if (near(inside, SMOKE_BACKGROUND))
    return `the sprite's pixel is blank (the background, ${show(inside)}) on ${render.renderer}`;
  if (!near(inside, INSIDE_COLOUR))
    return `the sprite's pixel is ${show(inside)}, not crate-0's ${hexOf(INSIDE_COLOUR)}, on ${render.renderer}`;
  if (!near(outside, SMOKE_BACKGROUND))
    return `the empty pixel is ${show(outside)}, not the background ${hexOf(SMOKE_BACKGROUND)}, on ${render.renderer}`;
  return null;
}

export type BrowserOutcome = {
  browser: BrowserName;
  status: "pass" | "fail" | "skipped";
  digest?: string;
  userAgent?: string;
  render?: RenderProbe;
  reason?: string;
  ms?: number;
};

export class SmokeTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms / 1000} s`);
    this.name = "SmokeTimeoutError";
  }
}

/** Rejects with a `SmokeTimeoutError` when `work` hasn't settled within `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmokeTimeoutError(label, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function parseBrowsers(arg: string | undefined): BrowserName[] {
  if (!arg) return [...BROWSERS];
  const names = arg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = names.filter((n) => !(BROWSERS as readonly string[]).includes(n));
  if (unknown.length || names.length === 0) {
    throw new Error(`--browsers takes a list of ${BROWSERS.join(", ")}; got ${arg}`);
  }
  return [...new Set(names)] as BrowserName[];
}

/** The page's answer against the digest the same run gave in-process. */
export function judgeResult(
  browser: BrowserName,
  result: EngineSmokeResult | undefined,
  expected: string,
): BrowserOutcome {
  if (!result) return { browser, status: "fail", reason: "the page set no window.__engineSmoke" };
  if (!result.ok) return { browser, status: "fail", reason: `the page failed: ${result.error}` };
  const seen = {
    browser,
    digest: result.digest,
    userAgent: result.userAgent,
    ...(result.render ? { render: result.render } : {}),
  };
  if (result.flavour !== "rapier2d-compat" || result.ticks !== 120) {
    return {
      ...seen,
      status: "fail",
      reason: `the page ran ${result.ticks} ticks on ${result.flavour}, not 120 on rapier2d-compat`,
    };
  }
  if (result.digest !== expected) {
    return {
      ...seen,
      status: "fail",
      reason: `digest ${result.digest} differs from the in-process run's ${expected}`,
    };
  }
  const drawn = judgeRender(result.render);
  if (drawn) return { ...seen, status: "fail", reason: drawn };
  return { ...seen, status: "pass" };
}

/** Playwright's launch error when the browser build it pins isn't installed. */
export function isMissingBrowser(message: string): boolean {
  return /Executable doesn't exist|playwright install/i.test(message);
}

export function installCommand(browser: BrowserName): string {
  return `vp exec playwright install ${browser}`;
}

/** A browser that couldn't launch: skipped locally when it isn't installed, a failure in CI or for any other reason. */
export function judgeLaunchFailure(
  browser: BrowserName,
  message: string,
  ci: boolean,
): BrowserOutcome {
  if (!isMissingBrowser(message)) {
    return { browser, status: "fail", reason: `couldn't launch: ${firstLine(message)}` };
  }
  const reason = `not installed; run \`${installCommand(browser)}\``;
  return ci ? { browser, status: "fail", reason } : { browser, status: "skipped", reason };
}

/** The run passes when nothing failed and at least one browser actually ran. */
export function overallOk(outcomes: readonly BrowserOutcome[]): boolean {
  return !outcomes.some((o) => o.status === "fail") && outcomes.some((o) => o.status === "pass");
}

function firstLine(message: string): string {
  return message.split("\n").find((l) => l.trim()) ?? message;
}

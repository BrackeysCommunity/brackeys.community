/**
 * The browser smoke's verdicts, kept free of Playwright and Vite so the
 * runner's rules (a digest must equal Node's, a page must answer in time, a
 * missing browser is never a pass) are unit-tested without a browser.
 */
import type { EngineSmokeResult } from "./browser/main";

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];

export const PAGE_TIMEOUT_MS = 30_000;

export type BrowserOutcome = {
  browser: BrowserName;
  status: "pass" | "fail" | "skipped";
  digest?: string;
  userAgent?: string;
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
  const seen = { browser, digest: result.digest, userAgent: result.userAgent };
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

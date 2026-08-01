import { config } from "./config.ts";

const MAX_ATTEMPTS = 5;

/**
 * Non-2xx response from itch. Carries the numeric status so callers can
 * branch on it (`err instanceof HttpStatusError && err.status === 404`)
 * instead of matching on message wording.
 */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`GET ${url} failed with status ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export function isNotFound(err: unknown): boolean {
  return err instanceof HttpStatusError && err.status === 404;
}

// ── Global politeness gate ───────────────────────────────────────────────────
// All itch.io requests (HTML pages and entries.json alike) flow through one
// pacer: at most one request per MIN_REQUEST_INTERVAL_MS across every worker,
// plus a shared cooldown once itch starts rate limiting. Without this, the
// per-request retry backoff slows only the failing request while the worker
// pool keeps feeding fresh first-attempts at full speed — on a 3,500-entry
// jam that sustained ~8 req/s and tripped itch's limiter hard.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Pacer = {
  /** Resolves when the caller may issue its request. */
  acquire(): Promise<void>;
  /** Pauses the whole pool; null falls back to the configured cooldown. */
  reportRateLimit(retryAfterSeconds: number | null): void;
};

type PacerOptions = {
  minIntervalMs: number;
  cooldownMs: number;
  // Injectable for tests; default to real time.
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function createPacer(opts: PacerOptions): Pacer {
  const now = opts.now ?? Date.now;
  const doSleep = opts.sleep ?? sleep;
  let nextSlotAt = 0;
  let cooldownUntil = 0;

  return {
    async acquire() {
      for (;;) {
        const t = now();
        const at = Math.max(t, nextSlotAt, cooldownUntil);
        if (at <= t) {
          nextSlotAt = t + opts.minIntervalMs;
          return;
        }
        await doSleep(at - t);
      }
    },
    reportRateLimit(retryAfterSeconds) {
      const waitMs = retryAfterSeconds ? retryAfterSeconds * 1000 : opts.cooldownMs;
      const until = now() + waitMs;
      if (until > cooldownUntil) {
        cooldownUntil = until;
        console.warn(
          `[http] rate limited — pausing all requests for ${Math.round(waitMs / 1000)}s`,
        );
      }
    },
  };
}

const pacer = createPacer({
  minIntervalMs: config.MIN_REQUEST_INTERVAL_MS,
  cooldownMs: config.RATE_LIMIT_COOLDOWN_MS,
});

/**
 * Only the delta-seconds form is handled; the HTTP-date form (rare, and itch
 * hasn't been seen sending it) parses to NaN and falls back to the configured
 * cooldown. Capped at 10 minutes so a bogus header can't stall the pool.
 */
export function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const secs = Number.parseInt(raw, 10);
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs, 600) : null;
}

/**
 * Issues a paced request through the global gate. Used by fetchHtml below and
 * by the entries.json fetcher so every itch.io call shares one rate budget.
 */
export async function pacedFetch(url: string, init: RequestInit): Promise<Response> {
  await pacer.acquire();
  const res = await fetch(url, init);
  if (res.status === 429 || res.status === 503) {
    pacer.reportRateLimit(parseRetryAfter(res));
  }
  return res;
}

/**
 * Fetches a URL with a plain HTTP request and returns the HTML.
 *
 * Every page the scraper reads is fully server-rendered by itch.io and served
 * without a JS challenge — even to our self-identifying bot user agent — so no
 * headless browser is involved (see docs/research/itch-scraper-browserless-deep-dive.md).
 *
 * Retries transient failures with a short exponential backoff. Rate-limit
 * waiting is owned entirely by the global gate: a 429/503 arms the pool-wide
 * cooldown, so the retry only needs to re-enter `pacedFetch` and block there.
 */
export async function fetchHtml(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchHtmlOnce(url);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isTransient(err)) throw err;
      const delay = 1_000 * 2 ** (attempt - 1);
      console.warn(
        `[http] ${url} attempt ${attempt}/${MAX_ATTEMPTS} failed (${describe(err)}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function fetchHtmlOnce(url: string): Promise<string> {
  const res = await pacedFetch(url, {
    headers: {
      "user-agent": config.USER_AGENT,
      accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw new HttpStatusError(res.status, url);
  }
  return await res.text();
}

// itch.io rate limiting, Cloudflare/origin 5xx blips (521 = origin down, seen
// during itch outages) — all worth retrying.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504, 521]);

function describe(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.name;
  return String(err);
}

export function isTransient(err: unknown): boolean {
  if (err instanceof HttpStatusError) return TRANSIENT_STATUSES.has(err.status);
  // Plain network flakes surface as non-HTTP errors.
  const msg = describe(err).toLowerCase();
  return (
    msg.includes("socket") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("network")
  );
}

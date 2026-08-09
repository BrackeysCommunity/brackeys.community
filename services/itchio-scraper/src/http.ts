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
  /** Pauses the whole pool; null falls back to the escalating cooldown. */
  reportRateLimit(retryAfterSeconds: number | null): void;
  /** Any non-throttled response — ends the current rate-limit streak. */
  reportSuccess(): void;
};

type PacerOptions = {
  minIntervalMs: number;
  cooldownMs: number;
  // Injectable for tests; default to real time / real randomness.
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

// itch's limiter scores short per-IP bursts, and an isolated 429 usually
// clears within seconds — so the first strike takes a short jittered pause
// instead of the full cooldown. Consecutive strikes escalate by doubling from
// the configured cooldown: continuing to hit the limiter while throttled
// worsens the IP's standing with it, which is the opposite of what a retry
// wants.
const FIRST_STRIKE_MIN_MS = 10_000;
const FIRST_STRIKE_JITTER_MS = 20_000;
const MAX_COOLDOWN_MS = 600_000;

export function createPacer(opts: PacerOptions): Pacer {
  const now = opts.now ?? Date.now;
  const doSleep = opts.sleep ?? sleep;
  const random = opts.random ?? Math.random;
  let nextSlotAt = 0;
  let cooldownUntil = 0;
  // Rate-limit reports since the last non-throttled response.
  let strikes = 0;

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
      strikes += 1;
      const waitMs =
        retryAfterSeconds != null
          ? retryAfterSeconds * 1000
          : strikes === 1
            ? FIRST_STRIKE_MIN_MS + random() * FIRST_STRIKE_JITTER_MS
            : Math.min(opts.cooldownMs * 2 ** (strikes - 2), MAX_COOLDOWN_MS);
      const until = now() + waitMs;
      if (until > cooldownUntil) {
        cooldownUntil = until;
        console.warn(
          `[http] rate limited (strike ${strikes}) — pausing all requests for ${Math.round(waitMs / 1000)}s`,
        );
      }
    },
    reportSuccess() {
      strikes = 0;
    },
  };
}

const pacer = createPacer({
  minIntervalMs: config.MIN_REQUEST_INTERVAL_MS,
  cooldownMs: config.RATE_LIMIT_COOLDOWN_MS,
});

// ── Cookie jar ───────────────────────────────────────────────────────────────
// itch sets an `itchio_token` session cookie on the first response; carrying
// it back makes the run look like one returning client instead of a stream of
// cookieless requests — the signature of the AI crawlers itch's limiter is
// tuned against. In-process only: each cron run starts cold and warms up on
// its first response.

const cookieJar = new Map<string, string>();

/** Test hook — the jar is module state shared by every pacedFetch call. */
export function resetCookieJar(): void {
  cookieJar.clear();
}

function storeCookies(res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0];
    const eq = pair?.indexOf("=") ?? -1;
    if (!pair || eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // An empty value is how a cookie gets cleared.
    if (value) cookieJar.set(name, value);
    else cookieJar.delete(name);
  }
}

function withCookies(init: RequestInit): RequestInit {
  if (cookieJar.size === 0) return init;
  const headers = new Headers(init.headers);
  if (!headers.has("cookie")) {
    headers.set(
      "cookie",
      [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  return { ...init, headers };
}

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
 *
 * The request timeout is passed as a duration, not a pre-armed signal, and the
 * signal is created *after* the gate releases. Arming it at the call site made
 * the clock run while the caller sat in the pacer: once a 429 armed the 60s
 * pool cooldown, every queued request's 45s timer expired before its fetch was
 * ever issued, so the whole pool failed with `TimeoutError` without a packet
 * leaving the process — and burned its retry budget doing it.
 */
export async function pacedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  await pacer.acquire();
  const res = await fetch(url, { ...withCookies(init), signal: AbortSignal.timeout(timeoutMs) });
  storeCookies(res);
  if (res.status === 429 || res.status === 503) {
    pacer.reportRateLimit(parseRetryAfter(res));
  } else {
    pacer.reportSuccess();
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
  const res = await pacedFetch(
    url,
    {
      headers: {
        "user-agent": config.USER_AGENT,
        accept: "text/html",
      },
      redirect: "follow",
    },
    45_000,
  );
  if (!res.ok) {
    throw new HttpStatusError(res.status, url);
  }
  return await res.text();
}

// itch.io rate limiting, Cloudflare/origin 5xx blips (521 = origin down, seen
// during itch outages) — all worth retrying.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504, 521]);

/**
 * First line of an error's message. Callers log this instead of the raw error:
 * Bun prints a DOMException's 25 static error-code constants (`NAMESPACE_ERR`,
 * `TIMEOUT_ERR`, …) when handed the object, which drowns the logs during a
 * timeout storm.
 */
export function describeError(err: unknown): string {
  const head = describe(err);
  // Wrapper errors bury the real failure in `cause` — drizzle's
  // DrizzleQueryError puts the whole SQL statement in `message` and the actual
  // Postgres error (unique violation, overflow) underneath. Logging only the
  // first line turned a diagnosable failure into a wall of parameter lists.
  const cause = err instanceof Error ? err.cause : undefined;
  if (cause !== undefined) {
    const detail = describe(cause);
    if (detail && detail !== head) return `${head} — caused by: ${detail}`;
  }
  return head;
}

/** First line only. Kept message-only so isTransient can't match on a cause. */
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

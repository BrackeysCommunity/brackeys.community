import { config } from "./config.ts";

const MAX_ATTEMPTS = 5;

// ── Global politeness gate ───────────────────────────────────────────────────
// All itch.io requests (HTML pages and entries.json alike) flow through one
// pacer: at most one request per MIN_REQUEST_INTERVAL_MS across every worker,
// plus a shared cooldown once itch starts rate limiting. Without this, the
// per-request retry backoff slows only the failing request while the worker
// pool keeps feeding fresh first-attempts at full speed — on a 3,500-entry
// jam that sustained ~8 req/s and tripped itch's limiter hard.

let nextSlotAt = 0;
let cooldownUntil = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquireRequestSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    const at = Math.max(now, nextSlotAt, cooldownUntil);
    if (at <= now) {
      nextSlotAt = now + config.MIN_REQUEST_INTERVAL_MS;
      return;
    }
    await sleep(at - now);
  }
}

function reportRateLimit(retryAfterSeconds: number | null): void {
  const waitMs = retryAfterSeconds ? retryAfterSeconds * 1000 : config.RATE_LIMIT_COOLDOWN_MS;
  const until = Date.now() + waitMs;
  if (until > cooldownUntil) {
    cooldownUntil = until;
    console.warn(`[http] rate limited — pausing all requests for ${Math.round(waitMs / 1000)}s`);
  }
}

function parseRetryAfter(res: Response): number | null {
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
  await acquireRequestSlot();
  const res = await fetch(url, init);
  if (res.status === 429 || res.status === 503) {
    reportRateLimit(parseRetryAfter(res));
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
 * Retries transient failures with exponential backoff; 429/503 additionally
 * trigger the global cooldown so the whole pool pauses, not just this caller.
 */
export async function fetchHtml(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchHtmlOnce(url);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isTransient(err)) throw err;
      const delay = backoffFor(err, attempt);
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
    throw new Error(`GET ${url} failed with status ${res.status}`);
  }
  return await res.text();
}

function backoffFor(err: unknown, attempt: number): number {
  const base = isRateLimit(err) ? 15_000 : 1_000;
  return base * 2 ** (attempt - 1);
}

function isRateLimit(err: unknown): boolean {
  const msg = describe(err).toLowerCase();
  return msg.includes("status 429") || msg.includes("status 503");
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.name;
  return String(err);
}

function isTransient(err: unknown): boolean {
  const msg = describe(err).toLowerCase();
  // itch.io rate limiting, Cloudflare/origin 5xx blips (521 = origin down,
  // seen during itch outages), and plain network flakes — all worth retrying.
  return (
    msg.includes("status 429") ||
    msg.includes("status 500") ||
    msg.includes("status 502") ||
    msg.includes("status 503") ||
    msg.includes("status 504") ||
    msg.includes("status 521") ||
    msg.includes("socket") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("network")
  );
}

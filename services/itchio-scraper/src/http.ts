import { config } from "./config.ts";

const MAX_ATTEMPTS = 5;

/**
 * Fetches a URL with a plain HTTP request and returns the HTML.
 *
 * Every page the scraper reads is fully server-rendered by itch.io and served
 * without a JS challenge — even to our self-identifying bot user agent — so no
 * headless browser is involved (see docs/research/itch-scraper-browserless-deep-dive.md).
 *
 * Retries transient failures with exponential backoff: itch.io 429s and
 * Cloudflare 503s need much longer cooldowns than a network flake, so they
 * start at 15s and climb aggressively; everything else starts at 1s.
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
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function fetchHtmlOnce(url: string): Promise<string> {
  const res = await fetch(url, {
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

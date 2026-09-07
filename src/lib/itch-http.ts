/**
 * The itch-facing HTTP client the crawler and the media-scan worker share:
 * every request rides a per-host pacer (see itch-pacer.ts), carries the
 * session cookie itch hands out, and classifies failures the same way.
 *
 * Built by a factory rather than module state because each service brings
 * its own user agent and its own pacers. Import-graph neutral — relative
 * imports only; services COPY this file into their images.
 */
import type { Pacer } from "./itch-pacer";

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

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The pacer budgets itch traffic divides into. The HTML site and every
 * `<user>.itch.io` game page share one limiter; the image CDN and the
 * authenticated API each have their own.
 */
export type ItchHost = "itch.io" | "img.itch.zone" | "api.itch.io";

export function itchHostKey(url: string | URL): ItchHost {
  const hostname = (typeof url === "string" ? new URL(url) : url).hostname;
  if (hostname === "img.itch.zone") return "img.itch.zone";
  if (hostname === "api.itch.io") return "api.itch.io";
  return "itch.io";
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

export type ItchHttpOptions = {
  userAgent: string;
  /** The pacer a request rides, by host budget. */
  pacerFor: (host: ItchHost) => Pacer;
  fetch?: typeof fetch;
};

export type ItchHttp = {
  /**
   * Issues a paced request. The request timeout is passed as a duration, not
   * a pre-armed signal, and the signal is created *after* the gate releases.
   * Arming it at the call site made the clock run while the caller sat in the
   * pacer: once a 429 armed the pool cooldown, every queued request's timer
   * expired before its fetch was ever issued.
   */
  pacedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response>;
  /**
   * Fetches a URL and returns the HTML. Retries transient failures with a
   * short exponential backoff; rate-limit waiting is owned entirely by the
   * pacer, so the retry only needs to re-enter `pacedFetch` and block there.
   */
  fetchHtml(url: string): Promise<string>;
  /** Test hook — the jar is shared by every request through this client. */
  resetCookieJar(): void;
};

export function createItchHttp(opts: ItchHttpOptions): ItchHttp {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  // itch sets an `itchio_token` session cookie on the first response; carrying
  // it back makes the process look like one returning client instead of a
  // stream of cookieless requests — the signature of the AI crawlers itch's
  // limiter is tuned against. In-process only, warmed on the first response.
  const cookieJar = new Map<string, string>();

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

  async function pacedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const pacer = opts.pacerFor(itchHostKey(url));
    await pacer.acquire();
    const res = await doFetch(url, {
      ...withCookies(init),
      signal: AbortSignal.timeout(timeoutMs),
    });
    storeCookies(res);
    if (res.status === 429 || res.status === 503) {
      pacer.reportRateLimit(parseRetryAfter(res));
    } else {
      pacer.reportSuccess();
    }
    return res;
  }

  async function fetchHtmlOnce(url: string): Promise<string> {
    const res = await pacedFetch(
      url,
      {
        headers: {
          "user-agent": opts.userAgent,
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

  async function fetchHtml(url: string): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await fetchHtmlOnce(url);
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_ATTEMPTS || !isTransient(err)) throw err;
        const delay = 1_000 * 2 ** (attempt - 1);
        console.warn(
          `[http] ${url} attempt ${attempt}/${MAX_ATTEMPTS} failed (${describeError(err)}), retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  return {
    pacedFetch,
    fetchHtml,
    resetCookieJar: () => cookieJar.clear(),
  };
}

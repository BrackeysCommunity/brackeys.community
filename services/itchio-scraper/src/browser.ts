import puppeteer from "puppeteer-core";

import { config } from "./config.ts";

const MAX_ATTEMPTS = 5;

/**
 * Fetches a URL through Browserless and returns the rendered HTML.
 *
 * Each call opens its own Browserless websocket session, fetches one page,
 * and disconnects. Sharing a single browser across a long sweep (1000+
 * rate pages) gets the session killed by Browserless's per-session TTL
 * mid-run; per-call sessions are slightly slower but bulletproof.
 *
 * Retries on transient Browserless failures (handshake rejected because the
 * server is at its concurrent-session cap, socket closed before we got a
 * response, etc.) with exponential backoff.
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
        `[browser] ${url} attempt ${attempt}/${MAX_ATTEMPTS} failed (${describe(err)}), retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function backoffFor(err: unknown, attempt: number): number {
  // itch.io 429s need much longer cooldowns than a puppeteer socket flake —
  // start at 15s and climb aggressively so we stop hammering.
  const base = isRateLimit(err) ? 15_000 : 1_000;
  return base * 2 ** (attempt - 1);
}

function isRateLimit(err: unknown): boolean {
  const msg = describe(err).toLowerCase();
  return msg.includes("status 429") || msg.includes("status 503");
}

async function fetchHtmlOnce(url: string): Promise<string> {
  const browser = await puppeteer.connect({
    browserWSEndpoint: config.BROWSERLESS_WS_ENDPOINT,
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(config.USER_AGENT);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const type = req.resourceType();
        if (type === "image" || type === "media" || type === "font") {
          req.abort();
        } else {
          req.continue();
        }
      });
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      if (!response || !response.ok()) {
        throw new Error(`GET ${url} failed with status ${response?.status() ?? "no response"}`);
      }
      return await page.content();
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.disconnect().catch(() => {});
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0] ?? err.name;
  return String(err);
}

function isTransient(err: unknown): boolean {
  const msg = describe(err).toLowerCase();
  // Browserless session-cap / queue rejections, torn-down websockets,
  // itch.io rate limiting, and network flakes — all worth retrying.
  return (
    msg.includes("status 429") ||
    msg.includes("status 500") ||
    msg.includes("status 502") ||
    msg.includes("status 503") ||
    msg.includes("status 504") ||
    msg.includes("101 status code") ||
    msg.includes("websocket") ||
    msg.includes("connection closed") ||
    msg.includes("frame was detached") ||
    msg.includes("target closed") ||
    msg.includes("socket hang up") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("timeout")
  );
}

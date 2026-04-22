import puppeteer from "puppeteer-core";

import { config } from "./config.ts";

/**
 * Fetches a URL through Browserless and returns the rendered HTML.
 *
 * Each call opens its own Browserless websocket session, fetches one page,
 * and disconnects. Sharing a single browser across a long sweep (1000+
 * rate pages) gets the session killed by Browserless's per-session TTL
 * mid-run; per-call sessions are slightly slower but bulletproof.
 */
export async function fetchHtml(url: string): Promise<string> {
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

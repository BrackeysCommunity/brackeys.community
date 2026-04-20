import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { config } from "./config.ts";

export async function connectBrowser(): Promise<Browser> {
  return puppeteer.connect({
    browserWSEndpoint: config.BROWSERLESS_WS_ENDPOINT,
    defaultViewport: { width: 1280, height: 800 },
  });
}

export async function withPage<T>(
  browser: Browser,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(config.USER_AGENT);
    // Drop heavy/irrelevant resources to keep scraping fast.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "media" || type === "font") {
        req.abort();
      } else {
        req.continue();
      }
    });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function fetchHtml(browser: Browser, url: string): Promise<string> {
  return withPage(browser, async (page) => {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!response || !response.ok()) {
      throw new Error(
        `GET ${url} failed with status ${response?.status() ?? "no response"}`,
      );
    }
    return page.content();
  });
}

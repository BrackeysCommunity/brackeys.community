import type { Browser } from "puppeteer-core";
import { connectBrowser } from "./browser.ts";
import { config } from "./config.ts";
import { pool } from "./db/client.ts";
import { syncJam } from "./jobs/sync-jam.ts";

async function runScrape() {
  console.log(
    `[scrape] starting run for ${config.ITCH_JAM_SLUGS.length} jam(s): ${config.ITCH_JAM_SLUGS.join(", ")}`,
  );
  const started = Date.now();
  let browser: Browser | null = null;
  let hadFailure = false;
  try {
    browser = await connectBrowser();
    for (const slug of config.ITCH_JAM_SLUGS) {
      try {
        await syncJam(browser, slug);
      } catch (err) {
        hadFailure = true;
        console.error(`[scrape] failed to sync jam ${slug}`, err);
      }
    }
  } finally {
    // puppeteer.connect() uses disconnect() — we never want to close the
    // shared Browserless browser.
    if (browser) await browser.disconnect().catch(() => {});
  }
  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[scrape] finished run in ${elapsed}s`);
  if (hadFailure) {
    throw new Error("one or more jams failed to sync");
  }
}

async function main() {
  try {
    await runScrape();
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[boot] fatal", err);
  process.exit(1);
});

import * as cheerio from "cheerio";

import { fetchHtml } from "../http.ts";

// Politeness gap between listing-page fetches. Plain fetch is fast enough
// that walking a listing back-to-back would burst several requests a second.
const PAGE_DELAY_MS = 300;

type ListPage = { slugs: string[]; hasNext: boolean };

function parseListPage(html: string): ListPage {
  const $ = cheerio.load(html);
  const slugs: string[] = [];
  $(".jam_grid_widget .jam").each((_, el) => {
    const href = $(el).find('a[href^="/jam/"]').first().attr("href");
    const match = href?.match(/^\/jam\/([^/?#]+)/);
    if (match?.[1]) slugs.push(match[1]);
  });
  // The "next" pager link is `<a class="next_page button" href="?page=N+1">`.
  const hasNext = $("a.next_page").length > 0;
  return { slugs, hasNext };
}

/**
 * Walks every page of a `.jam_grid_widget` listing until itch stops
 * rendering a "next" button. The same parser handles /jams/upcoming,
 * /jams/in-progress, and /search?q=…&type=jams.
 */
async function listJamSlugs(baseUrl: string): Promise<string[]> {
  const seen = new Set<string>();
  let page = 1;
  for (;;) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = page === 1 ? baseUrl : `${baseUrl}${sep}page=${page}`;
    const html = await fetchHtml(url);
    const { slugs, hasNext } = parseListPage(html);
    if (slugs.length === 0) break;
    for (const slug of slugs) seen.add(slug);
    if (!hasNext) break;
    page += 1;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }
  return [...seen];
}

export function discoverUpcomingSlugs(): Promise<string[]> {
  return listJamSlugs("https://itch.io/jams/upcoming");
}

export function discoverInProgressSlugs(): Promise<string[]> {
  return listJamSlugs("https://itch.io/jams/in-progress");
}

export function discoverBrackeysSearchSlugs(): Promise<string[]> {
  return listJamSlugs("https://itch.io/search?q=brackeys&type=jams");
}

type DatedListPage = {
  entries: Array<{ slug: string; endedAt: Date | null }>;
  hasNext: boolean;
};

function parseDatedListPage(html: string): DatedListPage {
  const $ = cheerio.load(html);
  const entries: Array<{ slug: string; endedAt: Date | null }> = [];
  $(".jam_grid_widget .jam").each((_, el) => {
    const href = $(el).find('a[href^="/jam/"]').first().attr("href");
    const slug = href?.match(/^\/jam\/([^/?#]+)/)?.[1];
    if (!slug) return;
    // Cells render `Ended <span class="date_countdown" title="2026-08-01 04:00:01">`
    // with a UTC-naive timestamp in the title attribute.
    const title = $(el).find(".date_countdown").first().attr("title");
    const endedAt = title ? new Date(`${title.replace(" ", "T")}Z`) : null;
    entries.push({ slug, endedAt: Number.isNaN(endedAt?.getTime()) ? null : endedAt });
  });
  return { entries, hasNext: $("a.next_page").length > 0 };
}

/**
 * Walks /jams/past/sort-date (end date descending) and returns every jam that
 * ended within the lookback window. This catches jams that were created and
 * finished entirely between successful runs — /jams/upcoming never saw them,
 * so without this walk they'd be lost forever (as happened in the June 2026
 * outage).
 */
export async function discoverRecentlyEndedSlugs(lookbackDays: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);
  const seen = new Set<string>();
  let page = 1;
  for (;;) {
    const url =
      page === 1
        ? "https://itch.io/jams/past/sort-date"
        : `https://itch.io/jams/past/sort-date?page=${page}`;
    const html = await fetchHtml(url);
    const { entries, hasNext } = parseDatedListPage(html);
    if (entries.length === 0) break;
    let pastCutoff = false;
    for (const { slug, endedAt } of entries) {
      if (endedAt && endedAt < cutoff) {
        pastCutoff = true;
        continue;
      }
      seen.add(slug);
    }
    if (pastCutoff || !hasNext) break;
    page += 1;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }
  return [...seen];
}

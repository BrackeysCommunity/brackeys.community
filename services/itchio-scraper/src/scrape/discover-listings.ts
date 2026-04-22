import * as cheerio from "cheerio";

import { fetchHtml } from "../browser.ts";

/**
 * Parses the `.jam` grid shared by /jams/upcoming and /search?type=jams.
 * Both use the same `.jam_grid_widget .jam` cell with the first `<a
 * href="/jam/{slug}">` pointing at the jam. We only ever look at page 1.
 */
async function listJamSlugs(url: string): Promise<string[]> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const slugs = new Set<string>();
  $(".jam_grid_widget .jam").each((_, el) => {
    const href = $(el).find('a[href^="/jam/"]').first().attr("href");
    const match = href?.match(/^\/jam\/([^/?#]+)/);
    if (match?.[1]) slugs.add(match[1]);
  });
  return [...slugs];
}

export function discoverUpcomingSlugs(): Promise<string[]> {
  return listJamSlugs("https://itch.io/jams/upcoming");
}

export function discoverBrackeysSearchSlugs(): Promise<string[]> {
  return listJamSlugs("https://itch.io/search?q=brackeys&type=jams");
}

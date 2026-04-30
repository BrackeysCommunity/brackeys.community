import * as cheerio from "cheerio";

import { fetchHtml } from "../browser.ts";

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
 * rendering a "next" button. The same parser handles both /jams/upcoming
 * and /search?q=…&type=jams.
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
  }
  return [...seen];
}

export function discoverUpcomingSlugs(): Promise<string[]> {
  return listJamSlugs("https://itch.io/jams/upcoming");
}

export function discoverBrackeysSearchSlugs(): Promise<string[]> {
  return listJamSlugs("https://itch.io/search?q=brackeys&type=jams");
}

import * as cheerio from "cheerio";

import { fetchHtml } from "../http.ts";
import type { ScrapedEntryResult } from "./rate-page.ts";
import { parseResultRows } from "./rate-page.ts";

// Politeness gap between result-page fetches, matching the listing walks.
const PAGE_DELAY_MS = 300;

// itch renders 20 games per results page. GMTK Jam 2022 (6,013 entries) is
// 300 pages — the cap is a runaway guard, not a real limit.
const MAX_PAGES = 2_000;

export type ScrapedGameResults = {
  gameId: number;
  gameTitle: string;
  results: ScrapedEntryResult[];
};

export type ResultsPage = {
  games: ScrapedGameResults[];
  hasNext: boolean;
};

/**
 * Parses one `/jam/{slug}/results` page.
 *
 * Each ranked submission is a `.game_rank` container holding the cover link, a
 * `.game_summary` block with the title and a `/jam/{slug}/rate/{gameId}`
 * permalink, and a `.ranking_results_table` — byte-for-byte the same criterion
 * table the individual rate page renders (verified against rate pages at rank
 * ~4,000 of a 6,013-entry jam). Note the table is a *sibling* of
 * `.game_summary`, not a child, so both are read off the `.game_rank` parent.
 */
export function parseResultsPage(html: string): ResultsPage {
  const $ = cheerio.load(html);
  const games: ScrapedGameResults[] = [];

  $(".game_rank").each((_, el) => {
    const block = $(el);
    const href = block.find('a[href*="/rate/"]').first().attr("href");
    const gameId = href?.match(/\/rate\/(\d+)/)?.[1];
    if (!gameId) return;

    const table = block.find(".ranking_results_table").first();
    if (table.length === 0) return;

    games.push({
      gameId: Number.parseInt(gameId, 10),
      gameTitle: block.find(".game_summary h2").first().text().trim(),
      results: parseResultRows($, table.find("tbody tr")),
    });
  });

  return { games, hasNext: $("a.next_page").length > 0 };
}

/**
 * Walks every page of a jam's results listing and returns per-criterion
 * rankings keyed by game id.
 *
 * This replaces one `/rate/{gameId}` fetch per entry with one fetch per 20
 * entries — the difference between ~250k requests and ~13k across the
 * historical backlog. Throws (rather than returning partial data) if any page
 * fails, because callers use "absent from this map" to mean "did not rank",
 * which is only sound when the whole walk succeeded.
 *
 * A jam whose host never published rankings 404s here; callers fall back to
 * the per-entry path.
 */
export async function scrapeJamResults(slug: string): Promise<Map<number, ScrapedGameResults>> {
  const byGameId = new Map<number, ScrapedGameResults>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      page === 1
        ? `https://itch.io/jam/${slug}/results`
        : `https://itch.io/jam/${slug}/results?page=${page}`;
    const { games, hasNext } = parseResultsPage(await fetchHtml(url));
    if (games.length === 0) break;
    for (const game of games) byGameId.set(game.gameId, game);
    if (!hasNext) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  return byGameId;
}

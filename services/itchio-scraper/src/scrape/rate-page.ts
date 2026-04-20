import * as cheerio from "cheerio";
import type { Browser } from "puppeteer-core";
import { fetchHtml } from "../browser.ts";

export type ScrapedEntryResult = {
  criterion: string;
  rank: number;
  score: string;
  rawScore: string;
};

export type ScrapedRatePage = {
  gameId: number;
  gameTitle: string;
  results: ScrapedEntryResult[];
};

function parseRank(text: string): number | null {
  const m = text.match(/#?\s*(\d+)/)?.[1];
  return m ? Number.parseInt(m, 10) : null;
}

function parseNumeric(text: string): string | null {
  return text.match(/-?\d+(?:\.\d+)?/)?.[0] ?? null;
}

export async function scrapeRatePage(
  browser: Browser,
  slug: string,
  gameId: number,
): Promise<ScrapedRatePage> {
  const url = `https://itch.io/jam/${slug}/rate/${gameId}`;
  const html = await fetchHtml(browser, url);
  const $ = cheerio.load(html);

  const results: ScrapedEntryResult[] = [];
  $(".jam_game_results.criteria_results .ranking_results_table tbody tr").each(
    (_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 4) return;
      const criterion = cells.eq(0).text().trim();
      const rank = parseRank(cells.eq(1).text());
      const score = parseNumeric(cells.eq(2).text());
      const rawScore = parseNumeric(cells.eq(3).text());
      if (criterion && rank != null && score && rawScore) {
        results.push({ criterion, rank, score, rawScore });
      }
    },
  );

  return {
    gameId,
    gameTitle: $(".jam_game_header h1").first().text().trim(),
    results,
  };
}

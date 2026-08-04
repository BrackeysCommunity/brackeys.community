import * as cheerio from "cheerio";

import { fetchHtml } from "../http.ts";

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

/**
 * Reads criterion rows out of a `.ranking_results_table` body. Shared by the
 * per-entry rate page and the bulk results listing, which render the identical
 * table.
 *
 * Rows without a parseable rank/score are skipped — some jams carry a "Top
 * Marks" criterion whose score renders as `n/a`.
 */
export function parseResultRows(
  $: cheerio.CheerioAPI,
  rows: ReturnType<cheerio.CheerioAPI>,
): ScrapedEntryResult[] {
  const results: ScrapedEntryResult[] = [];
  // Criterion names are not unique on itch: a host can define their own
  // criterion called "Overall" alongside the one itch computes, and both render
  // (seen on indie-city-allstars-2026). jam_entry_results is keyed by
  // (entry_id, criterion), so keeping both fails the whole insert and the entry
  // never gets marked fetched. First occurrence wins — itch renders its own
  // rows in rank order, so this is stable across runs.
  const seen = new Set<string>();
  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;
    const criterion = cells.eq(0).text().trim();
    const rank = parseRank(cells.eq(1).text());
    const score = parseNumeric(cells.eq(2).text());
    const rawScore = parseNumeric(cells.eq(3).text());
    if (criterion && rank != null && score && rawScore && !seen.has(criterion)) {
      seen.add(criterion);
      results.push({ criterion, rank, score, rawScore });
    }
  });
  return results;
}

export async function scrapeRatePage(slug: string, gameId: number): Promise<ScrapedRatePage> {
  const url = `https://itch.io/jam/${slug}/rate/${gameId}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // An entry that drew too few ratings to rank renders a real rate page with
  // no results table, and callers treat that empty result set as final. Confirm
  // this actually *is* a rate page first — otherwise a soft error served with a
  // 200 (itch serves an HTML "429 Too Many Requests" body) would silently mark
  // the entry permanently unranked.
  if ($(".jam_game_header").length === 0 && $(".jam_game_results").length === 0) {
    throw new Error(`GET ${url} returned no rate-page markup (${html.length} bytes)`);
  }

  return {
    gameId,
    gameTitle: $(".jam_game_header h1").first().text().trim(),
    results: parseResultRows(
      $,
      $(".jam_game_results.criteria_results .ranking_results_table tbody tr"),
    ),
  };
}

import { config } from "../config.ts";
import { HttpStatusError, pacedFetch } from "../http.ts";
import type { ScrapedEntryResult } from "./rate-page.ts";
import type { ScrapedGameResults } from "./results-page.ts";

type RawCriterion = {
  name?: string;
  rank?: number;
  score?: number;
  raw_score?: number;
};

type RawResult = {
  id: number;
  title?: string;
  rank?: number;
  score?: number;
  raw_score?: number;
  criteria?: RawCriterion[];
};

type RawResponse = {
  generated_on?: number;
  results?: RawResult[];
};

/** Matches the 3-decimal rendering of the HTML tables the DB rows came from. */
function formatScore(n: number): string {
  return n.toFixed(3);
}

/**
 * The top-level rank/score is itch's computed overall ranking — the row the
 * HTML tables label "Overall" — and `criteria` holds the per-criterion rows.
 * Overall is emitted first so it wins the (entry_id, criterion) dedupe over a
 * host-defined criterion that is also named "Overall" (same edge case
 * parseResultRows handles).
 */
export function mapRawResult(raw: RawResult): ScrapedEntryResult[] {
  const rows: RawCriterion[] = [
    { name: "Overall", rank: raw.rank, score: raw.score, raw_score: raw.raw_score },
    ...(raw.criteria ?? []),
  ];

  const results: ScrapedEntryResult[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // Unrankable criteria ("Top Marks") carry no usable numbers — skip them,
    // like the HTML parser skips their `n/a` cells.
    if (
      !row.name ||
      typeof row.rank !== "number" ||
      typeof row.score !== "number" ||
      typeof row.raw_score !== "number" ||
      seen.has(row.name)
    ) {
      continue;
    }
    seen.add(row.name);
    results.push({
      criterion: row.name,
      rank: row.rank,
      score: formatScore(row.score),
      rawScore: formatScore(row.raw_score),
    });
  }
  return results;
}

export function mapResultsResponse(json: RawResponse): Map<number, ScrapedGameResults> {
  const byGameId = new Map<number, ScrapedGameResults>();
  for (const raw of json.results ?? []) {
    if (typeof raw.id !== "number") continue;
    byGameId.set(raw.id, {
      gameId: raw.id,
      gameTitle: raw.title ?? "",
      results: mapRawResult(raw),
    });
  }
  return byGameId;
}

/**
 * Fetches a jam's complete published rankings in ONE request via the same
 * "secret" JSON family as entries.json (announced by itch for custom tools,
 * but with no format-stability guarantee — callers must keep the HTML walks
 * as fallbacks). Unlike `/results?page=N` there is no pagination: the full
 * ranked set comes back regardless of size, so absence from the map safely
 * means "did not rank".
 *
 * Returns null on 404 — rankings not published (same signal as the HTML
 * results page) or the endpoint itself retired.
 */
export async function fetchJamResultsJson(
  jamId: number,
): Promise<Map<number, ScrapedGameResults> | null> {
  const url = `https://itch.io/jam/${jamId}/results.json`;
  const res = await pacedFetch(
    url,
    {
      headers: {
        "user-agent": config.USER_AGENT,
        accept: "application/json",
      },
    },
    60_000,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpStatusError(res.status, url);
  return mapResultsResponse((await res.json()) as RawResponse);
}

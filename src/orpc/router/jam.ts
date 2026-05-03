import { os } from "@orpc/server";
import { and, asc, desc, gt, isNull, lte, or, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { itchJams } from "@/db/schema";
import type { JamEntry } from "@/lib/jam-store";

// Feb 22, 2026 at 5:00 AM CST = 11:00 AM UTC
const JAM_DEADLINE = new Date("2026-02-22T11:00:00Z");

export const getJamData = os.input(z.object({})).handler(async () => {
  const [htmlRes, entriesRes] = await Promise.all([
    fetch("https://itch.io/jam/brackeys-15/feed", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }),
    fetch("https://itch.io/jam/402922/entries.json", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }),
  ]);

  const isDeadlinePassed = Date.now() >= JAM_DEADLINE.getTime();
  let joinedCount = "0";
  let submissionCount = "0";
  let ratingCount = "0";

  if (htmlRes.ok) {
    const html = await htmlRes.text();
    const statMatches = [...html.matchAll(/class="stat_value"[^>]*>([^<]+)</g)];
    if (isDeadlinePassed) {
      // After the jam ends itch swaps the stats: [0] = entries, [1] = ratings
      submissionCount = statMatches[0]?.[1]?.trim() ?? "0";
      ratingCount = statMatches[1]?.[1]?.trim() ?? "0";
    } else {
      joinedCount = statMatches[0]?.[1]?.trim() ?? "0";
      submissionCount = statMatches[1]?.[1]?.trim() ?? "0";
    }
  }

  let submissions: JamEntry[] = [];

  if (entriesRes.ok) {
    const raw = (await entriesRes.json()) as unknown;
    const arr: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string, unknown>)?.jam_games)
        ? ((raw as Record<string, unknown>).jam_games as unknown[])
        : [];

    submissions = arr
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const game = (item.game ?? {}) as Record<string, unknown>;
        const user = (game.user ?? {}) as Record<string, unknown>;
        const str = (v: unknown): string =>
          typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

        return {
          id: Number(item.id ?? 0),
          created_at: str(item.created_at),
          rating_count: Number(item.rating_count ?? 0),
          url: str(item.url),
          coolness: Number(item.coolness ?? 0),
          game: {
            id: Number(game.id ?? 0),
            title: str(game.title),
            url: str(game.url),
            cover: str(game.cover),
            cover_color: game.cover_color != null ? str(game.cover_color) : undefined,
            short_text: game.short_text != null ? str(game.short_text) : null,
            platforms: Array.isArray(game.platforms)
              ? (game.platforms as unknown[]).map((p) => str(p))
              : [],
            user: {
              id: Number(user.id ?? 0),
              name: str(user.name),
              url: str(user.url),
            },
          },
        } satisfies JamEntry;
      });
  }

  return { joinedCount, submissionCount, ratingCount, submissions };
});

/**
 * Filtering uses date comparisons rather than the `status` column because the
 * scraper's status snapshot lags reality (and itch's own status field is
 * occasionally stale).
 */
export const listJams = os
  .input(
    z.object({
      filter: z.enum(["live", "upcoming", "active", "all"]).default("active"),
      sortBy: z.enum(["soonest", "popularity"]).default("soonest"),
      limit: z.number().min(1).max(100).default(20),
    }),
  )
  .handler(async ({ input }) => {
    const now = new Date();

    const isLive = and(
      lte(itchJams.startsAt, now),
      or(gt(itchJams.endsAt, now), isNull(itchJams.endsAt)),
    );
    const isUpcoming = gt(itchJams.startsAt, now);

    const where = (() => {
      switch (input.filter) {
        case "live":
          return isLive;
        case "upcoming":
          return isUpcoming;
        case "active":
          return or(isLive, isUpcoming);
        case "all":
          return undefined;
      }
    })();

    // For "soonest" we sort by upcoming-first (asc startsAt) which naturally
    // surfaces live jams (already started) ahead of true upcoming. For
    // "popularity" we order by joinedCount desc (most-joined first), with
    // entriesCount as a tiebreaker for jams that haven't been scraped for
    // joined-count yet.
    const orderBy =
      input.sortBy === "popularity"
        ? [
            desc(sql`COALESCE(${itchJams.joinedCount}, 0)`),
            desc(sql`COALESCE(${itchJams.entriesCount}, 0)`),
            asc(itchJams.endsAt),
          ]
        : [asc(itchJams.startsAt), desc(itchJams.scrapedAt)];

    const jams = await db
      .select()
      .from(itchJams)
      .where(where)
      .orderBy(...orderBy)
      .limit(input.limit);

    return { jams };
  });

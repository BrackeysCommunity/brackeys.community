import { os } from "@orpc/server";
import * as z from "zod";
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
        return {
          id: Number(item.id ?? 0),
          created_at: String(item.created_at ?? ""),
          rating_count: Number(item.rating_count ?? 0),
          url: String(item.url ?? ""),
          coolness: Number(item.coolness ?? 0),
          game: {
            id: Number(game.id ?? 0),
            title: String(game.title ?? ""),
            url: String(game.url ?? ""),
            cover: String(game.cover ?? ""),
            cover_color: game.cover_color ? String(game.cover_color) : undefined,
            short_text: game.short_text != null ? String(game.short_text) : null,
            platforms: Array.isArray(game.platforms)
              ? (game.platforms as unknown[]).map(String)
              : [],
            user: {
              id: Number(user.id ?? 0),
              name: String(user.name ?? ""),
              url: String(user.url ?? ""),
            },
          },
        } satisfies JamEntry;
      });
  }

  return { joinedCount, submissionCount, ratingCount, submissions };
});

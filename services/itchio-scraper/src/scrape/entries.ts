import { config } from "../config.ts";
import type { ItchJamContributor } from "../../../../src/db/schema.ts";

export type ItchEntry = {
  entryId: number;
  gameId: number;
  rateUrl: string;
  ratingCount: number;
  coolness: number;
  submittedAt: Date | null;
  gameTitle: string;
  gameShortText: string | null;
  gameUrl: string;
  gameCoverUrl: string | null;
  gameCoverColor: string | null;
  gamePlatforms: string[];
  authorId: number | null;
  authorName: string | null;
  authorUrl: string | null;
  contributors: ItchJamContributor[];
};

type RawEntry = {
  id: number;
  rating_count?: number;
  coolness?: number;
  url: string;
  created_at?: string;
  contributors?: Array<{ name: string; url: string }>;
  game: {
    id: number;
    title: string;
    short_text?: string;
    url: string;
    cover?: string;
    cover_color?: string;
    platforms?: string[];
    user?: { id: number; name: string; url: string };
  };
};

type RawResponse = {
  generated_on?: number;
  jam_games?: RawEntry[];
};

export async function fetchJamEntries(jamId: number): Promise<ItchEntry[]> {
  const url = `https://itch.io/jam/${jamId}/entries.json`;
  const res = await fetch(url, {
    headers: {
      "user-agent": config.USER_AGENT,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as RawResponse;
  const games = json.jam_games ?? [];
  return games.map((g) => ({
    entryId: g.id,
    gameId: g.game.id,
    rateUrl: g.url,
    ratingCount: g.rating_count ?? 0,
    coolness: g.coolness ?? 0,
    submittedAt: g.created_at
      ? new Date(`${g.created_at.replace(" ", "T")}Z`)
      : null,
    gameTitle: g.game.title,
    gameShortText: g.game.short_text ?? null,
    gameUrl: g.game.url,
    gameCoverUrl: g.game.cover ?? null,
    gameCoverColor: g.game.cover_color ?? null,
    gamePlatforms: g.game.platforms ?? [],
    authorId: g.game.user?.id ?? null,
    authorName: g.game.user?.name ?? null,
    authorUrl: g.game.user?.url ?? null,
    contributors: (g.contributors ?? []).map((c) => ({
      name: c.name,
      url: c.url,
    })),
  }));
}

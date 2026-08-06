const ITCHIO_API_BASE = "https://api.itch.io";

export interface ItchIoUser {
  id: number;
  username: string;
  display_name: string;
  url: string;
  cover_url: string;
  gamer: boolean;
  developer: boolean;
  press_user: boolean;
}

export interface ItchIoGame {
  id: number;
  title: string;
  short_text: string;
  url: string;
  cover_url: string;
  /** itch's embed type: default | html | flash | java | unity. `html` is the
   * "playable in browser" signal the project page's CTA reads. */
  type: string;
  /** Raw provider kind: game | asset | tool | soundtrack | game_mod | … The
   * API has always returned it; we only started storing it with the canonical
   * project row, so it's optional here for the rows that predate that. */
  classification?: string;
  /** released | in_development | on_hold | canceled | prototype. */
  release_status?: string;
  published: boolean;
  published_at: string;
  created_at: string;
  downloads_count: number;
  views_count: number;
  purchases_count: number;
  min_price: number;
  p_windows: boolean;
  p_linux: boolean;
  p_osx: boolean;
  p_android: boolean;
}

async function itchApiFetch<T>(endpoint: string, accessToken: string): Promise<T> {
  const res = await fetch(`${ITCHIO_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`itch.io API error (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

export async function validateToken(accessToken: string): Promise<ItchIoUser> {
  const data = await itchApiFetch<{ user: ItchIoUser }>("/profile", accessToken);
  return data.user;
}

export async function fetchGames(accessToken: string): Promise<ItchIoGame[]> {
  const data = await itchApiFetch<{ games: ItchIoGame[] }>("/profile/games", accessToken);
  return data.games ?? [];
}

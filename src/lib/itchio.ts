/**
 * Shared itch.io API client, used by the app (router, library sync) and by
 * the itchio-library-sync cron service — which imports this file relatively
 * and is copied into its Docker image, so it must stay dependency-free: no
 * `@/` aliases, no env access, nothing outside this module.
 */

const ITCHIO_API_BASE = "https://api.itch.io";
const DEFAULT_USER_AGENT = "brackeys-web/1.0 (+https://brackeys.community)";
const DEFAULT_TIMEOUT_MS = 15_000;

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
  short_text?: string;
  url?: string;
  cover_url?: string;
  /** itch's embed type: default | html | flash | java | unity. `html` is the
   * "playable in browser" signal the project page's CTA reads. */
  type?: string;
  /** Raw provider kind: game | asset | tool | soundtrack | game_mod | … */
  classification?: string;
  /** released | in_development | on_hold | canceled | prototype. */
  release_status?: string;
  published: boolean;
  published_at?: string;
  created_at?: string;
  /** Platform and capability flags as itch actually sends them
   * (`p_windows`, `p_osx`, `can_be_bought`, …) — the `p_*` boolean fields
   * this type used to declare never existed on the wire. */
  traits?: string[];
  min_price?: number;
  downloads_count?: number;
  views_count?: number;
  purchases_count?: number;
}

export interface ItchIoCredentialsInfo {
  type: "key" | "jwt";
  scopes: string[];
  expires_at?: string;
}

/** Non-2xx response from itch. Network and timeout failures are deliberately
 * NOT wrapped in this — callers distinguish "itch said no" (status in hand)
 * from "couldn't reach itch" (whatever fetch threw). */
export class ItchApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`itch.io API error (${status}): ${body}`);
    this.status = status;
    this.body = body;
  }
}

export interface ItchApiOptions {
  /** The cron sweep passes its own configured UA; the app default follows
   * the "identify yourself" convention itch asks of API consumers. */
  userAgent?: string;
  timeoutMs?: number;
}

export async function itchApiFetch<T>(
  endpoint: string,
  accessToken: string,
  opts?: ItchApiOptions,
): Promise<T> {
  const res = await fetch(`${ITCHIO_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": opts?.userAgent ?? DEFAULT_USER_AGENT,
    },
    signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ItchApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

export async function validateToken(
  accessToken: string,
  opts?: ItchApiOptions,
): Promise<ItchIoUser> {
  const data = await itchApiFetch<{ user: ItchIoUser }>("/profile", accessToken, opts);
  return data.user;
}

export async function fetchGames(
  accessToken: string,
  opts?: ItchApiOptions,
): Promise<ItchIoGame[]> {
  const data = await itchApiFetch<{ games?: ItchIoGame[] }>("/profile/games", accessToken, opts);
  return data.games ?? [];
}

/** What itch actually granted for this token — the requested scopes are not
 * guaranteed. `type` is "jwt" only for app-manifest tokens, which can't come
 * out of our web flow. */
export async function fetchCredentialsInfo(
  accessToken: string,
  opts?: ItchApiOptions,
): Promise<ItchIoCredentialsInfo> {
  const data = await itchApiFetch<Partial<ItchIoCredentialsInfo>>(
    "/credentials/info",
    accessToken,
    opts,
  );
  return {
    type: data.type === "jwt" ? "jwt" : "key",
    scopes: data.scopes ?? [],
    ...(data.expires_at ? { expires_at: data.expires_at } : {}),
  };
}

/** User-facing copy for a failed itch call, split by what actually went
 * wrong instead of collapsing everything into "invalid token". */
export function describeItchError(err: unknown): string {
  if (err instanceof ItchApiError) {
    if (err.status === 401 || err.status === 403) {
      return "itch.io rejected the token — please re-link your account.";
    }
    if (err.status === 429 || err.status >= 500) {
      return "itch.io is having trouble right now — try again in a few minutes.";
    }
  }
  return "Couldn't reach itch.io — check your connection and try again.";
}

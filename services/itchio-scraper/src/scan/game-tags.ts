import { config } from "../config.ts";
import { HttpStatusError, pacedFetch } from "../http.ts";

/**
 * Creator-set tag signal. Every itch game serves a public
 * `<game-url>/data.json` carrying its full user tag list — the only
 * machine-readable surface for a creator's own adult marking (entries.json
 * exposes no such field, and the rate page carries no content gate; see
 * docs/plans/22). It even stays readable for Restricted games, whose pages
 * 404 anonymously.
 *
 * Self-reported, so a hit is near-certain and complements the cover
 * classifier from the other side: the classifier catches unmarked NSFW,
 * the tags catch NSFW the cover alone doesn't show.
 */

/**
 * Tag slugs that count as the creator marking the upload adult. Exact
 * slugs, not substrings — itch tags are lowercase slugs, and precision is
 * the whole value of a self-reported signal. Every entry here was observed
 * on gated games (Strawberry Jam corpus); extend against real tags, not
 * guesses.
 */
const NSFW_TAG_SLUGS = new Set(["adult", "nsfw", "erotic", "eroge", "hentai", "porn"]);

/** The subset of a game's tags that mark it adult, in page order. */
export function matchNsfwTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => NSFW_TAG_SLUGS.has(tag.toLowerCase()));
}

/**
 * Tag list out of a data.json payload. `[]` is a verdict ("checked, none");
 * null means the payload wasn't a game (itch serves `{"errors": …}` bodies)
 * and nothing can be concluded.
 */
export function parseGameTags(payload: unknown): string[] | null {
  if (payload == null || typeof payload !== "object") return null;
  const { tags, errors } = payload as { tags?: unknown; errors?: unknown };
  if (Array.isArray(errors)) return null;
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === "string");
}

/**
 * Fetches a game's tags through the shared pacer. Null when the game is
 * gone (404 — deleted games, like their covers) or the body isn't a game
 * payload; other HTTP failures throw so the entry stays due and is retried
 * next tick.
 */
export async function fetchGameTags(gameUrl: string): Promise<string[] | null> {
  const url = `${gameUrl.replace(/\/+$/, "")}/data.json`;
  const res = await pacedFetch(
    url,
    {
      headers: {
        "user-agent": config.USER_AGENT,
        accept: "application/json",
      },
      redirect: "follow",
    },
    45_000,
  );
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new HttpStatusError(res.status, url);
  try {
    return parseGameTags(await res.json());
  } catch {
    return null;
  }
}

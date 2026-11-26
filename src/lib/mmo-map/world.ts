import { env } from "@/env";

export const WORLD_TIMEOUT_MS = 5000;

/** The map exists only where the site knows a world to read it from. */
export function mapEnabled(): boolean {
  return Boolean(env.MMO_WORLD_URL);
}

/**
 * One read of the world's map paths, with the map token and nothing of the
 * browser's: no cookie, no header and no parameter the caller did not pick.
 * Throws when the world is unset, down or slower than the timeout.
 */
export async function worldFetch(
  path: string,
  params: Record<string, string> = {},
): Promise<Response> {
  const base = env.MMO_WORLD_URL;
  if (!base) throw new Error("MMO_WORLD_URL is not set");
  const query = new URLSearchParams(params).toString();
  const url = `${base.replace(/\/+$/, "")}${path}${query ? `?${query}` : ""}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (env.MMO_MAP_TOKEN) headers.authorization = `Bearer ${env.MMO_MAP_TOKEN}`;
  return fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(WORLD_TIMEOUT_MS),
  });
}

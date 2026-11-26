import { env } from "@/env";

export const WORLD_TIMEOUT_MS = 5000;

/** The map exists only where the site knows a world to read it from. */
export function mapEnabled(): boolean {
  return Boolean(env.MMO_WORLD_URL);
}

/**
 * The one way the site reaches the world: nothing of the browser's (no
 * cookie, no header, no parameter the caller did not pick), no redirect
 * followed, and a timeout. Throws when the world is unset, down or slow.
 */
function worldRequest(
  path: string,
  token: string | undefined,
  init: RequestInit,
): Promise<Response> {
  const base = env.MMO_WORLD_URL;
  if (!base) throw new Error("MMO_WORLD_URL is not set");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${base.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(WORLD_TIMEOUT_MS),
  });
}

/** One read of the world's map paths, with the map token. */
export async function worldFetch(
  path: string,
  params: Record<string, string> = {},
): Promise<Response> {
  const query = new URLSearchParams(params).toString();
  return worldRequest(`${path}${query ? `?${query}` : ""}`, env.MMO_MAP_TOKEN, {});
}

/** One JSON write to the world, with the token the path asks for. */
export async function worldPost(path: string, token: string, body: unknown): Promise<Response> {
  return worldRequest(path, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

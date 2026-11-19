import * as api from "./api.ts";

/**
 * The world service as the bot reaches it. Every write names the
 * interaction that caused it, so a retried or double-pressed button
 * writes once (GDD 17.5).
 */
export interface World {
  act(req: api.ActionRequest): Promise<Acted>;
  player(discordId: string): Promise<string>;
  options(characterId: string): Promise<api.Options>;
  sheet(characterId: string): Promise<api.Sheet>;
  here(characterId: string): Promise<api.Here>;
  map(characterId: string, radius?: number): Promise<api.MapView>;
  appraise(req: api.AppraiseRequest): Promise<WorldReply<api.Appraisal>>;
  recipes(characterId: string): Promise<api.Recipes>;
  recap(characterId: string): Promise<api.Recap>;
  npc(characterId: string, npc: string): Promise<WorldReply<api.Conversation>>;
  lexicon(): Promise<api.Lexicon>;
  media(key: string): Promise<Uint8Array>;
}

export type WorldReply<T> = { ok: true; reply: T } | { ok: false; refusal: api.Refusal };
export type Acted = WorldReply<api.ActionReply>;

export class WorldUnavailableError extends Error {}

export class WorldRequestError extends Error {
  constructor(
    readonly status: number,
    readonly refusal: api.Refusal,
  ) {
    super(refusal.message ?? `World request failed (${status})`);
  }
}

/** The HTTP client over the world service's API. */
export function httpWorld(base: string, token: string, fetcher: typeof fetch = fetch): World {
  const root = base.replace(/\/+$/, "");
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetcher(root + path, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new WorldUnavailableError(`world service unreachable: ${String(e)}`);
    }
    if (res.status >= 500) throw new WorldUnavailableError(`world service ${res.status}`);
    return res;
  }
  const read = async <T>(method: string, path: string, body?: unknown): Promise<WorldReply<T>> => {
    const res = await send(method, path, body);
    return res.ok
      ? { ok: true, reply: (await res.json()) as T }
      : { ok: false, refusal: (await res.json()) as api.Refusal };
  };
  const get = async <T>(path: string): Promise<T> => {
    const res = await send("GET", path);
    if (!res.ok) throw new WorldRequestError(res.status, (await res.json()) as api.Refusal);
    return (await res.json()) as T;
  };
  const q = (params: Record<string, string | number | undefined>) =>
    "?" +
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
  return {
    act: (req) => read("POST", api.PathActions, req),
    async player(discordId) {
      return (await get<api.Player>(api.PathPlayer + q({ discordId }))).characterId;
    },
    options: (id) => get(api.PathOptions + q({ characterId: id })),
    sheet: (id) => get(api.PathSheet + q({ characterId: id })),
    here: (id) => get(api.PathHere + q({ characterId: id })),
    map: (id, radius) => get(api.PathMap + q({ characterId: id, radius })),
    appraise: (req) => read("POST", api.PathAppraise, req),
    recipes: (id) => get(api.PathRecipes + q({ characterId: id })),
    recap: (id) => get(api.PathRecap + q({ characterId: id })),
    npc: (id, npc) => read("GET", api.PathNPC + q({ characterId: id, npc })),
    lexicon: () => get(api.PathLexicon),
    async media(key) {
      const res = await send("GET", `${api.PathMedia}${encodeURIComponent(key)}.png`);
      if (!res.ok) throw new WorldRequestError(res.status, (await res.json()) as api.Refusal);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

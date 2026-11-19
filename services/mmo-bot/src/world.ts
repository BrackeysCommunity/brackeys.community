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
  appraise(req: api.AppraiseRequest): Promise<api.Appraisal | api.Refusal>;
  recipes(characterId: string): Promise<api.Recipes>;
  recap(characterId: string): Promise<api.Recap>;
  npc(characterId: string, npc: string): Promise<api.Conversation | api.Refusal>;
  lexicon(): Promise<api.Lexicon>;
  media(key: string): Promise<Uint8Array>;
}

/** A write's answer: what it did, or the rules' refusal. */
export type Acted = { ok: true; reply: api.ActionReply } | { ok: false; refusal: api.Refusal };

export class WorldUnavailableError extends Error {}

export function isRefusal(x: unknown): x is api.Refusal {
  return typeof x === "object" && x !== null && "code" in x && "message" in x && !("kind" in x);
}

/** The HTTP client over the world service's API. */
export function httpWorld(base: string, token: string, fetcher: typeof fetch = fetch): World {
  const root = base.replace(/\/+$/, "");
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: T }> {
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
    return { status: res.status, json: (await res.json()) as T };
  }
  const get = async <T>(path: string): Promise<T> => {
    const { status, json } = await call<T | api.Refusal>("GET", path);
    if (status >= 400) throw new Error(`world ${path}: ${(json as api.Refusal).code}`);
    return json as T;
  };
  const q = (params: Record<string, string | number | undefined>) =>
    "?" +
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
  return {
    async act(req) {
      const { status, json } = await call<api.ActionReply | api.Refusal>(
        "POST",
        api.PathActions,
        req,
      );
      return status >= 400
        ? { ok: false, refusal: json as api.Refusal }
        : { ok: true, reply: json as api.ActionReply };
    },
    async player(discordId) {
      return (await get<api.Player>(api.PathPlayer + q({ discordId }))).characterId;
    },
    options: (id) => get(api.PathOptions + q({ characterId: id })),
    sheet: (id) => get(api.PathSheet + q({ characterId: id })),
    here: (id) => get(api.PathHere + q({ characterId: id })),
    map: (id, radius) => get(api.PathMap + q({ characterId: id, radius })),
    async appraise(req) {
      return (await call<api.Appraisal | api.Refusal>("POST", api.PathAppraise, req)).json;
    },
    recipes: (id) => get(api.PathRecipes + q({ characterId: id })),
    recap: (id) => get(api.PathRecap + q({ characterId: id })),
    async npc(id, npc) {
      return (
        await call<api.Conversation | api.Refusal>("GET", api.PathNPC + q({ characterId: id, npc }))
      ).json;
    },
    lexicon: () => get(api.PathLexicon),
    async media(key) {
      let res: Response;
      try {
        res = await fetcher(`${root}${api.PathMedia}${key}.png`, {
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        throw new WorldUnavailableError(`world media unreachable: ${String(e)}`);
      }
      if (!res.ok) throw new Error(`world media ${key}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

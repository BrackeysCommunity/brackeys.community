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
  /** Since you left; with a promotion, only that promotion's line while the character may still name it. */
  recap(characterId: string, promotion?: string): Promise<api.Recap>;
  /** A conversation; with dossier, also what the NPC brings to it (GDD 4.18). */
  npc(
    characterId: string,
    npc: string,
    opts?: { dossier?: boolean },
  ): Promise<WorldReply<api.Conversation>>;
  lexicon(): Promise<api.Lexicon>;
  media(key: string): Promise<Uint8Array>;
  market(characterId: string, material?: string): Promise<WorldReply<api.Market>>;
  history(characterId: string, material: string): Promise<WorldReply<api.History>>;
  routeRisk(characterId: string, to: api.Hex): Promise<WorldReply<api.RouteRisk>>;
  /** The market forum; with a server, as that server reads it. */
  forum(server?: string): Promise<api.Forum>;
  goals(characterId: string): Promise<WorldReply<api.Goals>>;
  /** The goals board; with a server, as that server reads it, without other servers' staged contests. */
  board(server?: string): Promise<api.Board>;
  guild(characterId: string): Promise<api.Guild>;
  classes(characterId: string): Promise<api.Classes>;
  party(characterId: string): Promise<PartyRead>;
  /** Every open party, and those ended lately: the bot's own read, for the threads. */
  parties(): Promise<api.Parties>;
  hunts(): Promise<api.HuntBoard>;
  /** A closed world day's chronicle; day omitted is the last one closed. With no character, server picks whose places come first. */
  chronicle(
    characterId: string | undefined,
    day?: number,
    server?: string,
  ): Promise<WorldReply<api.Chronicle>>;
  /** A fact and its causes; with no character, the public view of them, as server reads it when one is named. */
  chronicleFact(
    characterId: string | undefined,
    id: number,
    server?: string,
  ): Promise<WorldReply<api.FactCauses>>;
  /** The arcs open and lately ended; with no character, only those everyone may see, and a server's own staged arcs when one is named. */
  arcs(characterId: string, server?: string): Promise<api.Arcs>;
  /** The events channel's facts after a fact id: the bot's own read; with a server, as that server sees them. */
  storyEvents(after: number, server?: string): Promise<api.StoryEvents>;
  /** The promotions after a fact id, each with its record: the bot's own read, for the chronicle channel; with a server, masked as that server reads them. */
  storyPromotions(after: number, server?: string): Promise<api.StoryEvents>;
  /** A server's house; with a character and its member's flags, as that server's staff or admins see it. */
  house?(
    server: string,
    character?: string,
    flags?: { admin?: boolean; staff?: boolean },
  ): Promise<WorldReply<api.House>>;
  /** A page of a server's public log after a row id: the bot's own read. */
  houseLog?(server: string, after: number): Promise<api.HouseLog>;
}

/**
 * A character's party read. It may also carry the live hunt in the
 * viewer's reach, with the options a press offers; without it a hunt is
 * pressed in the Activity.
 */
export type PartyRead = api.PartyState & { hunt?: api.HuntView };

/** A hunt's card in the game channel; banner is its tile's picture, where the world gives one. */
export type HuntPost = api.HuntCard & { banner?: string };

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
    recap: (id, promotion) => get(api.PathRecap + q({ characterId: id, promotion })),
    npc: (id, npc, opts) =>
      read(
        "GET",
        api.PathNPC + q({ characterId: id, npc, dossier: opts?.dossier ? 1 : undefined }),
      ),
    lexicon: () => get(api.PathLexicon),
    market: (id, material) => read("GET", api.PathMarket + q({ characterId: id, material })),
    history: (id, material) => read("GET", api.PathHistory + q({ characterId: id, material })),
    routeRisk: (id, to) => read("GET", api.PathRisk + q({ characterId: id, q: to.q, r: to.r })),
    forum: (server) => get(api.PathForum + q({ server })),
    goals: (id) => read("GET", api.PathGoals + q({ characterId: id })),
    board: (server) => get(api.PathBoard + q({ server })),
    guild: (id) => get(api.PathGuild + q({ characterId: id })),
    classes: (id) => get(api.PathClasses + q({ characterId: id })),
    party: (id) => get(api.PathParty + q({ characterId: id })),
    parties: () => get(api.PathParties),
    hunts: () => get(api.PathHunts),
    chronicle: (id, day, server) =>
      read("GET", api.PathChronicle + q({ characterId: id || undefined, day, server })),
    chronicleFact: (id, fact, server) =>
      read("GET", api.PathChronicleFact + q({ characterId: id || undefined, id: fact, server })),
    arcs: (id, server) => get(api.PathArcs + q({ characterId: id || undefined, server })),
    storyEvents: (after, server) => get(api.PathStoryEvents + q({ after, server })),
    storyPromotions: (after, server) => get(api.PathStoryPromotions + q({ after, server })),
    house: (server, character, flags) =>
      read(
        "GET",
        api.PathHouse +
          q({
            server,
            character: character || undefined,
            admin: flags?.admin ? 1 : undefined,
            staff: flags?.staff ? 1 : undefined,
          }),
      ),
    houseLog: (server, after) => get(api.PathHouseLog + q({ server, after })),
    async media(key) {
      const res = await send("GET", `${api.PathMedia}${encodeURIComponent(key)}.png`);
      if (!res.ok) throw new WorldRequestError(res.status, (await res.json()) as api.Refusal);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

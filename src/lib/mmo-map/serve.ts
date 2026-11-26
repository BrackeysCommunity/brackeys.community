import { DISCORD_SNOWFLAKE } from "@/lib/discord-snowflake";

import {
  CodeBadJSON,
  CodeNotFound,
  LevelArea,
  LevelTile,
  ViewerAnonymous,
  ViewerPlayer,
} from "../../../packages/mmo-api/src/index.ts";
import { MAP_EDGE, noStoreHeaders } from "./cache";
import { clientKey, mapLimit, type MapBucket } from "./limits";
import { mapEnabled, worldFetch } from "./world";

const JSON_TYPE = "application/json; charset=utf-8";

/** Statuses whose refusal the browser can act on; anything else is the world failing. */
const PASSED_THROUGH = new Set([400, 404, 429, 503]);

export const REV_PATTERN = /^[0-9a-f]{16}$/;
export const CHUNK_COORD = /^-?\d{1,6}$/;
export const CHUNK_LEVELS: ReadonlySet<string> = new Set([LevelArea, LevelTile]);
const MAX_CHUNKS_PARAM = 2048;

export function refusal(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: noStoreHeaders() });
}

export const notFound = () => refusal(404, CodeNotFound, "There is no map here.");
export const badRequest = (message: string) => refusal(400, CodeBadJSON, message);
const worldDown = () => refusal(502, "unavailable", "The world is not answering.");

interface Read {
  path: string;
  params?: Record<string, string>;
  bucket: MapBucket;
  key: string;
  /** The 200's cache-control; the route rule restates it in production. */
  edge: string;
  /** A content-addressed route's rev: a body with another rev is not cached. */
  rev?: string;
}

/** Asks the world, and answers with its body and the map's cache headers. */
export async function readWorld(read: Read): Promise<Response> {
  const limited = await mapLimit(read.bucket, read.key);
  if (limited) return limited;

  let reply: Response;
  let text: string;
  try {
    reply = await worldFetch(read.path, read.params);
    text = await reply.text();
  } catch {
    return worldDown();
  }

  if (reply.status !== 200) {
    if (!PASSED_THROUGH.has(reply.status)) return worldDown();
    const headers: Record<string, string> = { ...noStoreHeaders(), "content-type": JSON_TYPE };
    const retryAfter = reply.headers.get("retry-after");
    if (reply.status === 429) headers["retry-after"] = retryAfter ?? "1";
    return new Response(text, { status: reply.status, headers });
  }

  const headers: Record<string, string> = {
    "content-type": JSON_TYPE,
    "cache-control": read.edge,
  };
  if (read.edge === MAP_EDGE.overlay) headers["cdn-cache-control"] = MAP_EDGE.none;
  if (read.rev !== undefined) {
    let rev: unknown;
    try {
      rev = (JSON.parse(text) as { rev?: unknown } | null)?.rev;
    } catch {
      return worldDown();
    }
    if (rev !== read.rev) Object.assign(headers, noStoreHeaders());
  }
  return new Response(text, { status: 200, headers });
}

type Params = Record<string, string>;

/** A public read: the same answer for everyone, built with no identity. */
export async function publicRead(
  request: Request,
  path: string,
  edge: string,
  options: { params?: Params; rev?: string } = {},
): Promise<Response> {
  if (!mapEnabled()) return notFound();
  if (options.rev !== undefined && !REV_PATTERN.test(options.rev)) {
    return badRequest("A rev is 16 hex characters.");
  }
  return readWorld({
    path,
    params: options.params,
    bucket: "mmo-map-read",
    key: clientKey(request),
    edge,
    rev: options.rev,
  });
}

/** The focus route's one parameter: a Discord server id, or none for the world's home. */
export function focusParams(request: Request): Params | Response {
  const server = new URL(request.url).searchParams.get("server");
  if (server === null || server === "") return {};
  if (!DISCORD_SNOWFLAKE.test(server)) return badRequest("server is a Discord server id.");
  return { server };
}

/** The overlay's query, cut to the two keys the world reads from a browser. */
export function overlayParams(request: Request): Params | Response {
  const query = new URL(request.url).searchParams;
  const params: Params = {};
  const chunks = query.get("chunks");
  const scope = query.get("scope");
  if (chunks !== null) {
    if (chunks.length > MAX_CHUNKS_PARAM) return badRequest("Too many chunks.");
    params.chunks = chunks;
  }
  if (scope !== null) params.scope = scope;
  return params;
}

/**
 * A signed-in visitor with no Discord link is a player, not anonymous: the
 * world, asked with no Discord id, cannot tell the two apart.
 */
export async function asPlayer(response: Response): Promise<Response> {
  if (response.status !== 200) return response;
  const body = (await response.json()) as { viewer?: string };
  if (body.viewer === ViewerAnonymous) body.viewer = ViewerPlayer;
  return new Response(JSON.stringify(body), { status: 200, headers: response.headers });
}
